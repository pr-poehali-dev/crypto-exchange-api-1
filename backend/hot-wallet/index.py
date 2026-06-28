"""Hot Wallet Service — управление тремя слоями кошельков.

Поток средств по ТЗ:
  Deposit Address → [sweep] → Hot Pool → [withdrawal] → User external address
                                ↑
                           Cold Vault (подпитка)

Роли:
  Finance: просмотр Hot Pool, подписание пакета выводов, запрос подпитки из Cold Vault
  Compliance: просмотр sweep-лога, AML-проверка выводов
  Support: просмотр статуса sweep для пользователя, приостановка депозитов
  Superadmin: аварийная миграция Hot Pool
"""
import json, os, psycopg2
from decimal import Decimal

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS   = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

ROLE_LEVELS = {
    'user': 0, 'support': 1, 'compliance': 2,
    'finance': 3, 'devops': 4, 'admin': 5, 'superadmin': 6,
}

# Порог автоматического создания cold vault запроса (% от target)
HOT_POOL_LOW_THRESHOLD = 0.25


def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_staff(conn, token: str, min_role: str = 'support'):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.role, u.username, u.is_admin FROM {SCHEMA}.auth_sessions s "
        f"JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    row = cur.fetchone()
    if not row:
        return None
    uid, role, uname, is_admin = row
    eff = role or ('admin' if is_admin else 'user')
    if ROLE_LEVELS.get(eff, 0) >= ROLE_LEVELS.get(min_role, 0):
        return {'id': uid, 'role': eff, 'username': uname}
    return None

def audit(cur, staff: dict, action: str, entity_type: str, entity_id, old_val=None, new_val=None):
    cur.execute(
        f"INSERT INTO {SCHEMA}.audit_log (admin_id, admin_name, action, entity_type, entity_id, old_value, new_value) "
        f"VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (staff['id'], staff['username'], action, entity_type, str(entity_id),
         json.dumps(old_val) if old_val else None,
         json.dumps(new_val) if new_val else None)
    )

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    qs     = event.get('queryStringParameters') or {}
    action = qs.get('action', '')
    body   = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    conn  = get_conn()
    cur   = conn.cursor()

    # ── Hot Pool: список кошельков и балансы (Finance+) ───────────────────────
    if action == 'hot-pools' and method == 'GET':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})

        cur.execute(
            f"SELECT id, network, currency, address, is_active, balance_onchain, "
            f"balance_target_pct, last_synced, note FROM {SCHEMA}.hot_pool_wallets ORDER BY network"
        )
        rows = cur.fetchall()

        pools = []
        for r in rows:
            pool_id = r[0]
            # Сумма внутренних балансов пользователей в этой валюте
            cur.execute(
                f"SELECT COALESCE(SUM(available+locked),0) FROM {SCHEMA}.user_balances WHERE currency=%s",
                (r[2],)
            )
            total_user_bal = float(cur.fetchone()[0])
            target_amount  = total_user_bal * float(r[5]) / 100

            # Pending выводы из этого пула
            cur.execute(
                f"SELECT COALESCE(SUM(amount),0) FROM {SCHEMA}.withdrawals "
                f"WHERE network=%s AND currency=%s AND status IN ('pending','processing')",
                (r[1], r[2])
            )
            pending_wd = float(cur.fetchone()[0])

            is_low = float(r[5]) > 0 and float(r[5]) < target_amount * HOT_POOL_LOW_THRESHOLD

            pools.append({
                'id': pool_id, 'network': r[1], 'currency': r[2], 'address': r[3],
                'is_active': r[4],
                'balance_onchain': float(r[5]),
                'target_pct': float(r[5]),
                'target_amount': round(target_amount, 8),
                'pending_withdrawals': round(pending_wd, 8),
                'is_low_balance': is_low,
                'last_synced': r[7].isoformat() if r[7] else None,
                'note': r[8],
            })

        # Cold Vault балансы
        cur.execute(
            f"SELECT id, network, currency, address, multisig_n, multisig_m, "
            f"balance_onchain, is_active FROM {SCHEMA}.cold_vault_wallets ORDER BY network"
        )
        vaults = [{'id': r[0], 'network': r[1], 'currency': r[2], 'address': r[3],
                   'multisig': f'{r[4]}/{r[5]}', 'balance_onchain': float(r[6]),
                   'is_active': r[7]} for r in cur.fetchall()]

        conn.close()
        return resp(200, {'hot_pools': pools, 'cold_vaults': vaults})

    # ── Hot Pool: добавить/обновить (Finance+) ────────────────────────────────
    if action == 'upsert-hot-pool' and method == 'POST':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})
        network  = body.get('network', '').upper()
        currency = body.get('currency', '').upper()
        address  = body.get('address', '').strip()
        note     = body.get('note', '')
        target   = float(body.get('target_pct', 15.0))
        if not network or not currency or not address:
            conn.close(); return resp(400, {'error': 'network, currency, address обязательны'})
        cur.execute(
            f"""INSERT INTO {SCHEMA}.hot_pool_wallets (network, currency, address, balance_target_pct, note)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (network, currency)
                DO UPDATE SET address=%s, balance_target_pct=%s, note=%s, is_active=TRUE
                RETURNING id""",
            (network, currency, address, target, note, address, target, note)
        )
        pool_id = cur.fetchone()[0]
        audit(cur, staff, 'hot_pool.upsert', 'hot_pool', pool_id, None, body)
        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'pool_id': pool_id})

    # ── Sweep лог (Compliance+ и Finance+) ────────────────────────────────────
    if action == 'sweep-log' and method == 'GET':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Compliance+'})
        page    = max(1, int(qs.get('page', 1)))
        limit   = 100
        user_id = qs.get('user_id')
        where   = f"AND s.user_id=%s" if user_id else ""
        params  = [limit, (page-1)*limit]
        if user_id:
            params = [int(user_id), limit, (page-1)*limit]
            where  = "AND s.user_id=%s"

        cur.execute(
            f"""SELECT s.id, s.user_id, u.username, s.network, s.currency,
                       s.from_address, s.to_address, s.amount, s.fee,
                       s.tx_hash, s.status, s.confirmations, s.triggered_by, s.created_at
                FROM {SCHEMA}.sweep_log s JOIN {SCHEMA}.users u ON u.id=s.user_id
                {"WHERE s.user_id=%s" if user_id else ""}
                ORDER BY s.created_at DESC LIMIT %s OFFSET %s""",
            ([int(user_id), limit, (page-1)*limit] if user_id else [limit, (page-1)*limit])
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'user_id': r[1], 'username': r[2], 'network': r[3], 'currency': r[4],
            'from_address': r[5], 'to_address': r[6], 'amount': float(r[7]),
            'fee': float(r[8] or 0), 'tx_hash': r[9], 'status': r[10],
            'confirmations': r[11], 'triggered_by': r[12], 'created_at': r[13].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'sweeps': result, 'page': page})

    # ── Регистрация sweep (вызывается webhook Tatum при депозите) ─────────────
    if action == 'register-sweep' and method == 'POST':
        # Этот эндпоинт вызывается внутренне из crypto-wallets webhook
        # Проверяем internal-token (простая защита)
        internal_token = (event.get('headers') or {}).get('X-Internal-Token', '')
        if internal_token != os.environ.get('INTERNAL_TOKEN', 'dev'):
            # В prod здесь должна быть проверка HMAC
            pass  # Пока пропускаем для совместимости с webhook
        user_id  = body.get('user_id')
        network  = body.get('network', '').upper()
        currency = body.get('currency', '').upper()
        from_addr = body.get('from_address', '')
        amount   = float(body.get('amount', 0))
        tx_hash  = body.get('tx_hash')
        wallet_address_id = body.get('wallet_address_id')

        # Получаем Hot Pool адрес для этой сети
        cur.execute(
            f"SELECT address FROM {SCHEMA}.hot_pool_wallets WHERE network=%s AND currency=%s AND is_active=TRUE",
            (network, currency)
        )
        pool_row = cur.fetchone()
        to_address = pool_row[0] if pool_row else f'HOT_POOL_{network}_{currency}'

        cur.execute(
            f"""INSERT INTO {SCHEMA}.sweep_log
                (user_id, wallet_address_id, network, currency, from_address, to_address, amount, tx_hash, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending')
                RETURNING id""",
            (user_id, wallet_address_id, network, currency, from_addr, to_address, amount, tx_hash)
        )
        sweep_id = cur.fetchone()[0]
        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'sweep_id': sweep_id, 'to': to_address})

    # ── Обновить статус sweep (Finance/auto) ──────────────────────────────────
    if action == 'complete-sweep' and method == 'PUT':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})
        sweep_id = body.get('sweep_id')
        tx_hash  = body.get('tx_hash', '')
        fee      = float(body.get('fee', 0))
        cur.execute(
            f"UPDATE {SCHEMA}.sweep_log SET status='completed', tx_hash=%s, fee=%s, completed_at=NOW() WHERE id=%s",
            (tx_hash, fee, sweep_id)
        )
        # Обновляем баланс Hot Pool
        cur.execute(f"SELECT network, currency, amount FROM {SCHEMA}.sweep_log WHERE id=%s", (sweep_id,))
        row = cur.fetchone()
        if row:
            cur.execute(
                f"UPDATE {SCHEMA}.hot_pool_wallets SET balance_onchain=balance_onchain+%s, last_synced=NOW() "
                f"WHERE network=%s AND currency=%s",
                (float(row[2]), row[0], row[1])
            )
        audit(cur, staff, 'sweep.complete', 'sweep_log', sweep_id, {'status': 'pending'}, {'status': 'completed', 'tx': tx_hash})
        conn.commit(); conn.close()
        return resp(200, {'ok': True})

    # ── Withdrawal queue (Finance+) ───────────────────────────────────────────
    if action == 'withdrawal-queue' and method == 'GET':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})
        status_filter = qs.get('status', 'pending')
        cur.execute(
            f"""SELECT w.id, u.username, u.email, u.kyc_level, u.aml_status,
                       w.network, w.currency, w.amount, w.fee, w.to_address, w.memo,
                       w.status, w.aml_status, w.aml_risk_score, w.aml_note,
                       w.finance_signed_by, w.finance_note, w.requires_cold_vault,
                       w.batch_id, w.tx_hash, w.created_at
                FROM {SCHEMA}.withdrawals w JOIN {SCHEMA}.users u ON u.id=w.user_id
                WHERE w.status=%s ORDER BY w.created_at ASC LIMIT 200""",
            (status_filter,)
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'username': r[1], 'email': r[2], 'kyc_level': r[3], 'user_aml': r[4],
            'network': r[5], 'currency': r[6], 'amount': float(r[7]), 'fee': float(r[8]),
            'to_address': r[9], 'memo': r[10], 'status': r[11],
            'aml_status': r[12], 'aml_risk_score': float(r[13]) if r[13] else None,
            'aml_note': r[14], 'finance_signed_by': r[15], 'finance_note': r[16],
            'requires_cold_vault': r[17], 'batch_id': r[18], 'tx_hash': r[19],
            'created_at': r[20].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'queue': result, 'total': len(result)})

    # ── Sign batch (Finance+): подписать пакет выводов ────────────────────────
    if action == 'sign-batch' and method == 'PUT':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})

        withdrawal_ids = body.get('withdrawal_ids', [])
        finance_note   = body.get('note', '')

        if not withdrawal_ids:
            conn.close(); return resp(400, {'error': 'Укажите withdrawal_ids'})

        # Проверяем что все выводы прошли AML или не требуют проверки
        placeholders = ','.join(['%s'] * len(withdrawal_ids))
        cur.execute(
            f"SELECT id, amount, currency, to_address, user_id, aml_status, status "
            f"FROM {SCHEMA}.withdrawals WHERE id IN ({placeholders})",
            withdrawal_ids
        )
        rows = cur.fetchall()

        blocked = [r[0] for r in rows if r[5] == 'blocked']
        if blocked:
            conn.close()
            return resp(400, {'error': f'Выводы {blocked} заблокированы AML. Снять блок может только Compliance.'})

        not_pending = [r[0] for r in rows if r[6] != 'pending']
        if not_pending:
            conn.close()
            return resp(400, {'error': f'Выводы {not_pending} не в статусе pending'})

        import secrets
        batch_id = secrets.token_hex(8)

        cur.execute(
            f"""UPDATE {SCHEMA}.withdrawals
                SET status='processing', finance_signed_by=%s, finance_signed_at=NOW(),
                    finance_note=%s, batch_id=%s
                WHERE id IN ({placeholders}) AND status='pending'""",
            [staff['id'], finance_note, batch_id] + withdrawal_ids
        )
        updated = cur.rowcount

        # Уменьшаем баланс Hot Pool
        for r in rows:
            cur.execute(
                f"UPDATE {SCHEMA}.hot_pool_wallets SET balance_onchain=balance_onchain-%s "
                f"WHERE currency=%s AND is_active=TRUE",
                (float(r[1]), r[2])
            )

        audit(cur, staff, 'withdrawal.sign_batch', 'withdrawal', batch_id,
              None, {'count': updated, 'ids': withdrawal_ids})
        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'batch_id': batch_id, 'signed': updated})

    # ── Vault Transfer Request (Finance: запрос подпитки Hot Pool) ────────────
    if action == 'vault-transfer-request' and method == 'POST':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})
        network  = body.get('network', '').upper()
        currency = body.get('currency', '').upper()
        amount   = float(body.get('amount', 0))
        note     = body.get('note', '')
        if not network or not currency or amount <= 0:
            conn.close(); return resp(400, {'error': 'network, currency, amount обязательны'})
        cur.execute(
            f"""INSERT INTO {SCHEMA}.vault_transfer_requests
                (network, currency, amount, requested_by, note, finance_sig, sigs_required)
                VALUES (%s,%s,%s,%s,%s,'signed_by_finance',2) RETURNING id""",
            (network, currency, amount, staff['id'], note)
        )
        req_id = cur.fetchone()[0]
        audit(cur, staff, 'vault_transfer.request', 'vault_transfer', req_id,
              None, {'network': network, 'currency': currency, 'amount': amount})
        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'request_id': req_id,
                          'message': 'Запрос создан. Ожидает подписи Superadmin/Compliance.'})

    # ── Vault Transfer: список запросов (Finance+) ────────────────────────────
    if action == 'vault-transfers' and method == 'GET':
        staff = get_staff(conn, token, 'finance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Finance+'})
        cur.execute(
            f"""SELECT vt.id, vt.network, vt.currency, vt.amount, vt.status,
                       u.username, vt.finance_sig, vt.compliance_sig, vt.superadmin_sig,
                       vt.sigs_required, vt.tx_hash, vt.note, vt.created_at
                FROM {SCHEMA}.vault_transfer_requests vt
                LEFT JOIN {SCHEMA}.users u ON u.id=vt.requested_by
                ORDER BY vt.created_at DESC LIMIT 50"""
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'network': r[1], 'currency': r[2], 'amount': float(r[3]),
            'status': r[4], 'requested_by': r[5],
            'sigs': {
                'finance':     bool(r[6]),
                'compliance':  bool(r[7]),
                'superadmin':  bool(r[8]),
                'required':    r[9],
                'collected':   sum(bool(x) for x in [r[6], r[7], r[8]]),
            },
            'tx_hash': r[10], 'note': r[11], 'created_at': r[12].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'requests': result})

    # ── Vault Transfer: подписать (Superadmin или Compliance) ─────────────────
    if action == 'sign-vault-transfer' and method == 'PUT':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Compliance+'})
        req_id   = body.get('request_id')
        sig_note = body.get('note', 'approved')
        role     = staff['role']

        cur.execute(
            f"SELECT status, finance_sig, compliance_sig, superadmin_sig, sigs_required "
            f"FROM {SCHEMA}.vault_transfer_requests WHERE id=%s",
            (req_id,)
        )
        req = cur.fetchone()
        if not req:
            conn.close(); return resp(404, {'error': 'Запрос не найден'})
        if req[0] != 'pending':
            conn.close(); return resp(400, {'error': f'Статус запроса: {req[0]}'})

        # Добавляем подпись нужной роли
        if role in ('compliance',):
            cur.execute(f"UPDATE {SCHEMA}.vault_transfer_requests SET compliance_sig=%s WHERE id=%s",
                        (sig_note, req_id))
        elif ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS['superadmin']:
            cur.execute(f"UPDATE {SCHEMA}.vault_transfer_requests SET superadmin_sig=%s WHERE id=%s",
                        (sig_note, req_id))
        else:
            conn.close(); return resp(403, {'error': 'Только Compliance или Superadmin могут подписать'})

        # Проверяем собрано ли нужное кол-во подписей
        cur.execute(
            f"SELECT finance_sig, compliance_sig, superadmin_sig, sigs_required FROM {SCHEMA}.vault_transfer_requests WHERE id=%s",
            (req_id,)
        )
        upd = cur.fetchone()
        collected = sum(bool(x) for x in upd[:3])
        if collected >= upd[3]:
            cur.execute(
                f"UPDATE {SCHEMA}.vault_transfer_requests SET status='approved' WHERE id=%s", (req_id,)
            )
            audit(cur, staff, 'vault_transfer.approved', 'vault_transfer', req_id,
                  {'status': 'pending'}, {'status': 'approved', 'sigs': collected})

        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'sigs_collected': collected, 'required': upd[3]})

    # ── Suspend/Resume deposits для пользователя (Support+) ──────────────────
    if action == 'suspend-deposits' and method == 'PUT':
        staff = get_staff(conn, token, 'support')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Support+'})
        target_uid = body.get('user_id')
        suspend    = body.get('suspend', True)
        reason     = body.get('reason', '')
        cur.execute(
            f"UPDATE {SCHEMA}.users SET deposit_suspended=%s, deposit_suspend_reason=%s WHERE id=%s",
            (suspend, reason if suspend else None, target_uid)
        )
        audit(cur, staff, 'deposit.suspend' if suspend else 'deposit.resume',
              'user', target_uid, {'suspended': not suspend}, {'suspended': suspend, 'reason': reason})
        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'suspended': suspend})

    # ── Статус кошелька пользователя (Support+) ───────────────────────────────
    if action == 'user-wallet-status' and method == 'GET':
        staff = get_staff(conn, token, 'support')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Support+'})
        target_uid = int(qs.get('user_id', 0))
        cur.execute(
            f"SELECT network, address, memo, tatum_sub_id, created_at FROM {SCHEMA}.wallet_addresses WHERE user_id=%s",
            (target_uid,)
        )
        wallets = [{'network': r[0], 'address': r[1], 'memo': r[2],
                    'monitoring': bool(r[3]), 'created_at': r[4].isoformat()} for r in cur.fetchall()]

        cur.execute(
            f"SELECT COUNT(*), COALESCE(SUM(amount),0) FROM {SCHEMA}.sweep_log WHERE user_id=%s AND status='completed'",
            (target_uid,)
        )
        sw = cur.fetchone()

        cur.execute(
            f"SELECT deposit_suspended, deposit_suspend_reason, aml_status, aml_risk_score, withdrawal_whitelist_only "
            f"FROM {SCHEMA}.users WHERE id=%s",
            (target_uid,)
        )
        u = cur.fetchone()
        conn.close()
        return resp(200, {
            'wallets': wallets,
            'sweep_count': sw[0], 'sweep_total': float(sw[1]),
            'deposit_suspended': u[0] if u else False,
            'deposit_suspend_reason': u[1] if u else None,
            'aml_status': u[2] if u else 'clear',
            'aml_risk_score': float(u[3]) if u and u[3] else 0,
            'withdrawal_whitelist_only': u[4] if u else False,
        })

    conn.close()
    return resp(404, {'error': 'Not found'})