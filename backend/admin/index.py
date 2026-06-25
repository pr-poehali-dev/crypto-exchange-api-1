"""
Административная панель: ролевая модель, KYC-модерация, заморозка аккаунтов,
очередь выводов, аудит-лог, управление торговыми парами.
Роли: user < support < compliance < finance < devops < admin < superadmin
"""
import json, os, psycopg2
from datetime import datetime

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

ROLE_LEVELS = {
    'user': 0, 'support': 1, 'compliance': 2,
    'finance': 3, 'devops': 4, 'admin': 5, 'superadmin': 6
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_admin(conn, token: str, min_role: str = 'support'):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.role, u.username FROM {SCHEMA}.auth_sessions s "
        f"JOIN {SCHEMA}.users u ON u.id=s.user_id "
        f"WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    row = cur.fetchone()
    if not row:
        return None
    uid, role, uname = row
    # Обратная совместимость: is_admin=true → role admin
    if role == 'user':
        cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id=%s", (uid,))
        ia = cur.fetchone()
        if ia and ia[0]:
            role = 'admin'
    if ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS.get(min_role, 0):
        return {'id': uid, 'role': role, 'username': uname}
    return None

def audit(cur, admin: dict, action: str, entity_type: str, entity_id, old_val=None, new_val=None, ip=''):
    cur.execute(
        f"INSERT INTO {SCHEMA}.audit_log (admin_id, admin_name, action, entity_type, entity_id, old_value, new_value, ip_address) "
        f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (admin['id'], admin['username'], action, entity_type, str(entity_id),
         json.dumps(old_val) if old_val else None,
         json.dumps(new_val) if new_val else None, ip)
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
    ip = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp', '')
    token = (event.get('headers') or {}).get('X-Auth-Token', '')

    conn = get_conn()
    cur  = conn.cursor()

    # ── Дашборд (support+) ───────────────────────────────────────────────────
    if action == 'stats':
        admin = get_admin(conn, token, 'support')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users")
        total_users = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users WHERE created_at > NOW()-INTERVAL '24 hours'")
        new_users_24h = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.deposits WHERE status='pending'")
        pending_deposits = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.withdrawals WHERE status='pending'")
        pending_withdrawals = cur.fetchone()[0]
        cur.execute(f"SELECT COALESCE(SUM(available),0) FROM {SCHEMA}.user_balances WHERE currency='USDT'")
        total_usdt = float(cur.fetchone()[0])
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.kyc_submissions WHERE status='pending'")
        pending_kyc = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.orders WHERE status='open'")
        open_orders = cur.fetchone()[0]
        cur.execute(
            f"SELECT COALESCE(SUM(total),0) FROM {SCHEMA}.trades WHERE created_at > NOW()-INTERVAL '24 hours'"
        )
        volume_24h = float(cur.fetchone()[0])
        conn.close()
        return resp(200, {
            'total_users': total_users, 'new_users_24h': new_users_24h,
            'pending_deposits': pending_deposits, 'pending_withdrawals': pending_withdrawals,
            'total_usdt': total_usdt, 'pending_kyc': pending_kyc,
            'open_orders': open_orders, 'volume_24h': volume_24h,
        })

    # ── Пользователи (support+) ──────────────────────────────────────────────
    if action == 'users':
        admin = get_admin(conn, token, 'support')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        search = qs.get('q', '')
        page   = max(1, int(qs.get('page', 1)))
        limit  = 50
        offset = (page - 1) * limit
        where  = ""
        params = []
        if search:
            where = "WHERE u.email ILIKE %s OR u.username ILIKE %s OR CAST(u.id AS TEXT)=%s"
            params = [f'%{search}%', f'%{search}%', search]
        cur.execute(
            f"""SELECT u.id, u.email, u.username, u.is_admin, u.role, u.is_verified,
                       u.kyc_status, u.kyc_level, u.is_frozen, u.created_at, u.last_login,
                       COALESCE(SUM(b.available) FILTER (WHERE b.currency='USDT'),0) as usdt_bal
                FROM {SCHEMA}.users u
                LEFT JOIN {SCHEMA}.user_balances b ON b.user_id=u.id
                {where} GROUP BY u.id ORDER BY u.created_at DESC LIMIT %s OFFSET %s""",
            params + [limit, offset]
        )
        rows = cur.fetchall()
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users {where}", params)
        total = cur.fetchone()[0]
        result = [{
            'id': r[0], 'email': r[1], 'username': r[2], 'is_admin': r[3],
            'role': r[4] or 'user', 'is_verified': r[5],
            'kyc_status': r[6], 'kyc_level': r[7] or 0,
            'is_frozen': r[8] or False,
            'created_at': r[9].isoformat(),
            'last_login': r[10].isoformat() if r[10] else None,
            'usdt_balance': float(r[11]),
        } for r in rows]
        conn.close()
        return resp(200, {'users': result, 'total': total, 'page': page})

    # GET ?action=user-detail&user_id=X — карточка пользователя
    if action == 'user-detail' and method == 'GET':
        admin = get_admin(conn, token, 'support')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        target_id = int(qs.get('user_id', 0))
        cur.execute(
            f"SELECT id, email, username, role, kyc_status, kyc_level, is_frozen, freeze_reason, "
            f"full_name, birth_date, created_at, last_login FROM {SCHEMA}.users WHERE id=%s",
            (target_id,)
        )
        u = cur.fetchone()
        if not u:
            conn.close()
            return resp(404, {'error': 'Пользователь не найден'})
        # Балансы
        cur.execute(f"SELECT currency, available, locked FROM {SCHEMA}.user_balances WHERE user_id=%s", (target_id,))
        balances = [{'currency': r[0], 'available': float(r[1]), 'locked': float(r[2])} for r in cur.fetchall()]
        # Последние транзакции
        cur.execute(
            f"SELECT type, currency, amount, fee, status, note, created_at FROM {SCHEMA}.transactions WHERE user_id=%s ORDER BY created_at DESC LIMIT 20",
            (target_id,)
        )
        txs = [{'type': r[0], 'currency': r[1], 'amount': float(r[2]), 'fee': float(r[3] or 0),
                'status': r[4], 'note': r[5], 'created_at': r[6].isoformat()} for r in cur.fetchall()]
        # Сессии
        cur.execute(
            f"SELECT ip_address, user_agent, created_at, last_seen FROM {SCHEMA}.auth_sessions WHERE user_id=%s ORDER BY created_at DESC LIMIT 10",
            (target_id,)
        )
        sessions = [{'ip': r[0], 'ua': r[1], 'created': r[2].isoformat() if r[2] else None, 'last_seen': r[3].isoformat() if r[3] else None} for r in cur.fetchall()]
        conn.close()
        return resp(200, {
            'user': {
                'id': u[0], 'email': u[1], 'username': u[2], 'role': u[3],
                'kyc_status': u[4], 'kyc_level': u[5] or 0,
                'is_frozen': u[6] or False, 'freeze_reason': u[7],
                'full_name': u[8], 'birth_date': u[9].isoformat() if u[9] else None,
                'created_at': u[10].isoformat(), 'last_login': u[11].isoformat() if u[11] else None,
            },
            'balances': balances, 'transactions': txs, 'sessions': sessions,
        })

    # PUT ?action=freeze — заморозить/разморозить аккаунт
    if action == 'freeze' and method == 'PUT':
        admin = get_admin(conn, token, 'compliance')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        target_id = body.get('user_id')
        freeze    = body.get('freeze', True)
        reason    = body.get('reason', '')
        cur.execute(f"SELECT is_frozen FROM {SCHEMA}.users WHERE id=%s", (target_id,))
        u = cur.fetchone()
        if not u:
            conn.close()
            return resp(404, {'error': 'Пользователь не найден'})
        cur.execute(
            f"UPDATE {SCHEMA}.users SET is_frozen=%s, freeze_reason=%s WHERE id=%s",
            (freeze, reason if freeze else None, target_id)
        )
        audit(cur, admin, 'user.freeze' if freeze else 'user.unfreeze', 'user', target_id,
              {'is_frozen': not freeze}, {'is_frozen': freeze, 'reason': reason}, ip)
        if freeze:
            cur.execute(
                f"INSERT INTO {SCHEMA}.notifications (user_id, type, title, body) VALUES (%s,'account_frozen','Аккаунт заморожен',%s)",
                (target_id, f'Причина: {reason}')
            )
        conn.commit()
        conn.close()
        return resp(200, {'ok': True, 'frozen': freeze})

    # PUT ?action=set-role — изменить роль (superadmin only)
    if action == 'set-role' and method == 'PUT':
        admin = get_admin(conn, token, 'superadmin')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа. Требуется superadmin'})
        target_id = body.get('user_id')
        new_role  = body.get('role', 'user')
        if new_role not in ROLE_LEVELS:
            conn.close()
            return resp(400, {'error': f'Неверная роль: {new_role}'})
        cur.execute(f"SELECT role FROM {SCHEMA}.users WHERE id=%s", (target_id,))
        u = cur.fetchone()
        if not u:
            conn.close()
            return resp(404, {'error': 'Пользователь не найден'})
        cur.execute(
            f"UPDATE {SCHEMA}.users SET role=%s, is_admin=%s WHERE id=%s",
            (new_role, new_role in ('admin', 'superadmin'), target_id)
        )
        audit(cur, admin, 'user.set_role', 'user', target_id, {'role': u[0]}, {'role': new_role}, ip)
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # PUT ?action=balance — корректировка баланса (finance+)
    if action == 'balance' and method == 'PUT':
        admin = get_admin(conn, token, 'finance')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        target_id = body.get('user_id')
        currency  = body.get('currency', 'USDT')
        amount    = float(body.get('amount', 0))
        operation = body.get('operation', 'set')
        if operation == 'set':
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_balances (user_id, currency, available) VALUES (%s,%s,%s) "
                f"ON CONFLICT (user_id, currency) DO UPDATE SET available=%s",
                (target_id, currency, amount, amount)
            )
        elif operation == 'add':
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_balances (user_id, currency, available) VALUES (%s,%s,%s) "
                f"ON CONFLICT (user_id, currency) DO UPDATE SET available={SCHEMA}.user_balances.available+EXCLUDED.available",
                (target_id, currency, amount)
            )
        cur.execute(
            f"INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, note) VALUES (%s,'admin_adjustment',%s,%s,%s)",
            (target_id, currency, amount, f'Корректировка: {operation} {amount} {currency} (admin: {admin["username"]})')
        )
        audit(cur, admin, 'balance.adjust', 'user', target_id, None, {'currency': currency, 'amount': amount, 'op': operation}, ip)
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # GET ?action=withdrawals — очередь выводов (finance+)
    if action == 'withdrawals' and method == 'GET':
        admin = get_admin(conn, token, 'finance')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        status_filter = qs.get('status', 'pending')
        cur.execute(
            f"""SELECT w.id, w.user_id, u.username, u.email, u.kyc_level,
                       w.network, w.currency, w.amount, w.fee, w.to_address,
                       w.memo, w.status, w.tx_hash, w.created_at
                FROM {SCHEMA}.withdrawals w JOIN {SCHEMA}.users u ON u.id=w.user_id
                WHERE w.status=%s ORDER BY w.created_at ASC""",
            (status_filter,)
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'user_id': r[1], 'username': r[2], 'email': r[3], 'kyc_level': r[4],
            'network': r[5], 'currency': r[6], 'amount': float(r[7]), 'fee': float(r[8]),
            'to_address': r[9], 'memo': r[10], 'status': r[11], 'tx_hash': r[12],
            'created_at': r[13].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'withdrawals': result})

    # PUT ?action=approve-withdrawal (finance+)
    if action == 'approve-withdrawal' and method == 'PUT':
        admin = get_admin(conn, token, 'finance')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        wid = body.get('withdrawal_id')
        tx  = body.get('tx_hash', '')
        cur.execute(
            f"UPDATE {SCHEMA}.withdrawals SET status='completed', tx_hash=%s, updated_at=NOW() WHERE id=%s AND status='pending' RETURNING user_id, currency, amount",
            (tx, wid)
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return resp(404, {'error': 'Заявка не найдена'})
        audit(cur, admin, 'withdrawal.approve', 'withdrawal', wid, {'status': 'pending'}, {'status': 'completed', 'tx': tx}, ip)
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # PUT ?action=reject-withdrawal (finance+)
    if action == 'reject-withdrawal' and method == 'PUT':
        admin = get_admin(conn, token, 'finance')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        wid  = body.get('withdrawal_id')
        note = body.get('note', '')
        cur.execute(
            f"UPDATE {SCHEMA}.withdrawals SET status='rejected', admin_note=%s, updated_at=NOW() WHERE id=%s AND status='pending' RETURNING user_id, currency, amount, fee",
            (note, wid)
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return resp(404, {'error': 'Заявка не найдена'})
        uid, curr, amt, fee = row
        # Вернуть средства
        cur.execute(
            f"UPDATE {SCHEMA}.user_balances SET available=available+%s WHERE user_id=%s AND currency=%s",
            (float(amt) + float(fee), uid, curr)
        )
        cur.execute(
            f"INSERT INTO {SCHEMA}.notifications (user_id, type, title, body) VALUES (%s,'withdrawal_rejected','Вывод отклонён',%s)",
            (uid, f'Причина: {note}. Средства возвращены на баланс.')
        )
        audit(cur, admin, 'withdrawal.reject', 'withdrawal', wid, {'status': 'pending'}, {'status': 'rejected', 'note': note}, ip)
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # GET ?action=transactions — история транзакций (finance+)
    if action == 'transactions' and method == 'GET':
        admin = get_admin(conn, token, 'finance')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        cur.execute(
            f"""SELECT t.id, u.username, t.type, t.currency, t.amount, t.fee, t.status, t.note, t.created_at
                FROM {SCHEMA}.transactions t JOIN {SCHEMA}.users u ON u.id=t.user_id
                ORDER BY t.created_at DESC LIMIT 200"""
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'username': r[1], 'type': r[2], 'currency': r[3],
                   'amount': float(r[4]), 'fee': float(r[5] or 0), 'status': r[6],
                   'note': r[7], 'created_at': r[8].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'transactions': result})

    # GET ?action=audit-log — лог аудита (admin+)
    if action == 'audit-log' and method == 'GET':
        admin = get_admin(conn, token, 'admin')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        page = max(1, int(qs.get('page', 1)))
        cur.execute(
            f"SELECT id, admin_name, action, entity_type, entity_id, old_value, new_value, ip_address, created_at "
            f"FROM {SCHEMA}.audit_log ORDER BY created_at DESC LIMIT 100 OFFSET %s",
            ((page - 1) * 100,)
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'admin': r[1], 'action': r[2], 'entity_type': r[3], 'entity_id': r[4],
            'old': r[5], 'new': r[6], 'ip': r[7], 'created_at': r[8].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'log': result})

    # GET ?action=orders — все открытые ордера (admin+)
    if action == 'orders' and method == 'GET':
        admin = get_admin(conn, token, 'admin')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        cur.execute(
            f"""SELECT o.id, u.username, o.symbol, o.side, o.type, o.status,
                       o.price, o.qty, o.filled_qty, o.created_at
                FROM {SCHEMA}.orders o JOIN {SCHEMA}.users u ON u.id=o.user_id
                WHERE o.status IN ('open','partial') ORDER BY o.created_at DESC LIMIT 200"""
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'username': r[1], 'symbol': r[2], 'side': r[3],
                   'type': r[4], 'status': r[5], 'price': float(r[6]) if r[6] else None,
                   'qty': float(r[7]), 'filled_qty': float(r[8]), 'created_at': r[9].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'orders': result})

    # ── Торговые пары (admin+) ───────────────────────────────────────────────
    if action == 'pairs' and method == 'GET':
        admin = get_admin(conn, token, 'admin')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        cur.execute(
            f"SELECT id, symbol, base, quote, is_active, maker_fee, taker_fee, min_qty, tick_size, last_price, volume_24h FROM {SCHEMA}.trading_pairs ORDER BY symbol"
        )
        rows = cur.fetchall()
        pairs = [{'id': r[0], 'symbol': r[1], 'base': r[2], 'quote': r[3], 'is_active': r[4],
                  'maker_fee': float(r[5]), 'taker_fee': float(r[6]), 'min_qty': float(r[7]),
                  'tick_size': float(r[8]), 'last_price': float(r[9]), 'volume_24h': float(r[10])} for r in rows]
        conn.close()
        return resp(200, {'pairs': pairs})

    if action == 'update-pair' and method == 'PUT':
        admin = get_admin(conn, token, 'admin')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        pair_id    = body.get('pair_id')
        is_active  = body.get('is_active')
        maker_fee  = body.get('maker_fee')
        taker_fee  = body.get('taker_fee')
        fields, vals = [], []
        if is_active is not None:
            fields.append('is_active=%s'); vals.append(is_active)
        if maker_fee is not None:
            fields.append('maker_fee=%s'); vals.append(float(maker_fee))
        if taker_fee is not None:
            fields.append('taker_fee=%s'); vals.append(float(taker_fee))
        if not fields:
            conn.close()
            return resp(400, {'error': 'Нет полей для обновления'})
        vals.append(pair_id)
        cur.execute(f"UPDATE {SCHEMA}.trading_pairs SET {', '.join(fields)} WHERE id=%s", vals)
        audit(cur, admin, 'pair.update', 'trading_pair', pair_id, None, body, ip)
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # PUT ?action=toggle-admin (superadmin only — совместимость)
    if action == 'toggle-admin' and method == 'PUT':
        admin = get_admin(conn, token, 'superadmin')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        target_id = body.get('user_id')
        cur.execute(f"SELECT is_admin, role FROM {SCHEMA}.users WHERE id=%s", (target_id,))
        u = cur.fetchone()
        if not u:
            conn.close()
            return resp(404, {'error': 'Пользователь не найден'})
        new_admin = not u[0]
        new_role  = 'admin' if new_admin else 'user'
        cur.execute(f"UPDATE {SCHEMA}.users SET is_admin=%s, role=%s WHERE id=%s", (new_admin, new_role, target_id))
        audit(cur, admin, 'user.toggle_admin', 'user', target_id, {'is_admin': u[0]}, {'is_admin': new_admin}, ip)
        conn.commit()
        conn.close()
        return resp(200, {'ok': True, 'is_admin': new_admin})

    # GET ?action=notifications — уведомления (admin+)
    if action == 'notifications' and method == 'GET':
        admin = get_admin(conn, token, 'support')
        if not admin:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})
        cur.execute(
            f"SELECT n.id, u.username, n.type, n.title, n.body, n.is_read, n.created_at "
            f"FROM {SCHEMA}.notifications n JOIN {SCHEMA}.users u ON u.id=n.user_id "
            f"ORDER BY n.created_at DESC LIMIT 100"
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'username': r[1], 'type': r[2], 'title': r[3],
                   'body': r[4], 'is_read': r[5], 'created_at': r[6].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'notifications': result})

    conn.close()
    return resp(404, {'error': 'Not found'})
