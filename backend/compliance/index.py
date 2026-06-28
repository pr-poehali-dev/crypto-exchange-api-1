"""
Compliance Service — AML флаги, whitelist адресов, проверка риск-скора.

Права строго по ТЗ:
  Compliance: всё ниже — freeze, AML flag, whitelist approve
  Finance: НЕ имеет доступа к этому сервису (разделение обязанностей SoD)
  Support: только view_aml_status (без деталей расследования — anti-tipping-off)
"""
import json, os, psycopg2

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


def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_staff(conn, token: str, min_role: str = 'compliance'):
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

    # ── AML: установить флаг на адрес (Compliance only) ──────────────────────
    if action == 'flag-address' and method == 'POST':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance может устанавливать AML-флаги'})
        address    = body.get('address', '').strip()
        network    = body.get('network', '').upper()
        flag_type  = body.get('flag_type', 'watchlist')  # blacklist/whitelist/watchlist
        risk_score = float(body.get('risk_score', 0))
        reason     = body.get('reason', '')
        source     = body.get('source', 'manual')
        if not address or not network:
            conn.close(); return resp(400, {'error': 'address и network обязательны'})
        if flag_type not in ('blacklist', 'whitelist', 'watchlist'):
            conn.close(); return resp(400, {'error': 'flag_type: blacklist/whitelist/watchlist'})
        cur.execute(
            f"""INSERT INTO {SCHEMA}.compliance_address_flags
                (address, network, flag_type, risk_score, reason, source, flagged_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (address, network, flag_type)
                DO UPDATE SET risk_score=%s, reason=%s, source=%s, flagged_by=%s
                RETURNING id""",
            (address, network, flag_type, risk_score, reason, source, staff['id'],
             risk_score, reason, source, staff['id'])
        )
        flag_id = cur.fetchone()[0]

        # Если blacklist — автоматически блокируем все pending выводы на этот адрес
        if flag_type == 'blacklist':
            cur.execute(
                f"UPDATE {SCHEMA}.withdrawals SET aml_status='blocked', aml_note=%s, aml_reviewed_by=%s, aml_reviewed_at=NOW() "
                f"WHERE to_address=%s AND status='pending' AND aml_status!='blocked'",
                (f'Адрес в чёрном списке: {reason}', staff['id'], address)
            )
            blocked_count = cur.rowcount
        else:
            blocked_count = 0

        audit(cur, staff, f'aml.flag.{flag_type}', 'address', address,
              None, {'flag_type': flag_type, 'risk_score': risk_score, 'reason': reason})
        conn.commit(); conn.close()
        return resp(200, {'ok': True, 'flag_id': flag_id, 'blocked_withdrawals': blocked_count})

    # ── AML: список флагов (Compliance+) ──────────────────────────────────────
    if action == 'address-flags' and method == 'GET':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance+'})
        flag_type = qs.get('flag_type', '')
        where = "WHERE flag_type=%s" if flag_type else ""
        params = [flag_type] if flag_type else []
        cur.execute(
            f"SELECT id, address, network, flag_type, risk_score, reason, source, created_at "
            f"FROM {SCHEMA}.compliance_address_flags {where} ORDER BY created_at DESC LIMIT 200",
            params
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'address': r[1], 'network': r[2], 'flag_type': r[3],
                   'risk_score': float(r[4]), 'reason': r[5], 'source': r[6],
                   'created_at': r[7].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'flags': result})

    # ── AML: проверить адрес (Compliance+) ────────────────────────────────────
    if action == 'check-address' and method == 'GET':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance+'})
        address = qs.get('address', '').strip()
        network = qs.get('network', '').upper()
        cur.execute(
            f"SELECT flag_type, risk_score, reason, source, created_at "
            f"FROM {SCHEMA}.compliance_address_flags WHERE address=%s AND network=%s",
            (address, network)
        )
        flags = [{'flag_type': r[0], 'risk_score': float(r[1]), 'reason': r[2],
                  'source': r[3], 'created_at': r[4].isoformat()} for r in cur.fetchall()]
        is_blacklisted = any(f['flag_type'] == 'blacklist' for f in flags)
        max_risk = max((f['risk_score'] for f in flags), default=0)
        conn.close()
        return resp(200, {
            'address': address, 'network': network,
            'is_blacklisted': is_blacklisted, 'max_risk_score': max_risk,
            'flags': flags,
        })

    # ── AML: обновить статус вывода (Compliance: approve/block) ──────────────
    if action == 'review-withdrawal' and method == 'PUT':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance может проверять выводы по AML'})
        wid        = body.get('withdrawal_id')
        aml_status = body.get('aml_status')  # 'clear' / 'flagged' / 'blocked'
        aml_note   = body.get('note', '')
        risk_score = body.get('risk_score')
        if aml_status not in ('clear', 'flagged', 'blocked'):
            conn.close(); return resp(400, {'error': 'aml_status: clear/flagged/blocked'})
        cur.execute(
            f"SELECT status, to_address, currency, amount FROM {SCHEMA}.withdrawals WHERE id=%s", (wid,)
        )
        wd = cur.fetchone()
        if not wd:
            conn.close(); return resp(404, {'error': 'Вывод не найден'})
        cur.execute(
            f"UPDATE {SCHEMA}.withdrawals SET aml_status=%s, aml_note=%s, aml_reviewed_by=%s, aml_reviewed_at=NOW() "
            f"{', aml_risk_score=%s' if risk_score is not None else ''} WHERE id=%s",
            ([aml_status, aml_note, staff['id'], float(risk_score), wid]
             if risk_score is not None else [aml_status, aml_note, staff['id'], wid])
        )
        # SoD: Compliance НЕ может изменить status вывода — только aml_status
        # Finance видит aml_status='blocked' и не может подписать такой вывод
        audit(cur, staff, f'aml.withdrawal.{aml_status}', 'withdrawal', wid,
              {'aml_status': 'pending'}, {'aml_status': aml_status, 'note': aml_note})
        conn.commit(); conn.close()
        return resp(200, {'ok': True})

    # ── Whitelist адресов вывода: список заявок (Compliance+) ─────────────────
    if action == 'whitelist-requests' and method == 'GET':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance+'})
        status_filter = qs.get('status', 'pending_compliance')
        cur.execute(
            f"""SELECT w.id, w.user_id, u.username, u.email, w.network, w.address,
                       w.label, w.status, w.created_at
                FROM {SCHEMA}.withdrawal_address_whitelist w
                JOIN {SCHEMA}.users u ON u.id=w.user_id
                WHERE w.status=%s ORDER BY w.created_at ASC""",
            (status_filter,)
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'user_id': r[1], 'username': r[2], 'email': r[3],
                   'network': r[4], 'address': r[5], 'label': r[6], 'status': r[7],
                   'created_at': r[8].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'requests': result})

    # ── Whitelist: одобрить/отклонить (Compliance+) ────────────────────────────
    if action == 'approve-whitelist' and method == 'PUT':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance+'})
        wl_id    = body.get('whitelist_id')
        approved = body.get('approved', True)
        reason   = body.get('reason', '')
        new_status = 'approved' if approved else 'rejected'
        cur.execute(
            f"UPDATE {SCHEMA}.withdrawal_address_whitelist SET status=%s, approved_by=%s, "
            f"approved_at=NOW(), reject_reason=%s WHERE id=%s RETURNING user_id, address, network",
            (new_status, staff['id'], reason if not approved else None, wl_id)
        )
        row = cur.fetchone()
        if not row:
            conn.close(); return resp(404, {'error': 'Заявка не найдена'})
        # Уведомление
        cur.execute(
            f"INSERT INTO {SCHEMA}.notifications (user_id, type, title, body) VALUES (%s,%s,%s,%s)",
            (row[0], 'whitelist_' + new_status,
             f'Адрес {"одобрен" if approved else "отклонён"}',
             f'{row[2]} {row[1][:12]}... {"одобрен для вывода" if approved else "отклонён: " + reason}')
        )
        audit(cur, staff, f'whitelist.{new_status}', 'whitelist', wl_id,
              {'status': 'pending'}, {'status': new_status})
        conn.commit(); conn.close()
        return resp(200, {'ok': True})

    # ── AML дашборд: сводка рисков (Compliance+) ──────────────────────────────
    if action == 'aml-dashboard' and method == 'GET':
        staff = get_staff(conn, token, 'compliance')
        if not staff:
            conn.close(); return resp(403, {'error': 'Только Compliance+'})
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.compliance_address_flags WHERE flag_type='blacklist'")
        blacklisted = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.compliance_address_flags WHERE flag_type='watchlist'")
        watchlisted = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.withdrawals WHERE aml_status='blocked'")
        blocked_wd = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.withdrawals WHERE aml_status='flagged'")
        flagged_wd = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.withdrawals WHERE aml_status='pending'")
        pending_aml = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users WHERE is_frozen=TRUE")
        frozen_users = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.withdrawal_address_whitelist WHERE status='pending_compliance'")
        pending_wl = cur.fetchone()[0]

        # Последние 10 рискованных выводов
        cur.execute(
            f"""SELECT w.id, u.username, w.currency, w.amount, w.to_address,
                       w.aml_status, w.aml_risk_score, w.created_at
                FROM {SCHEMA}.withdrawals w JOIN {SCHEMA}.users u ON u.id=w.user_id
                WHERE w.aml_status IN ('flagged','blocked')
                ORDER BY w.created_at DESC LIMIT 10"""
        )
        flagged_list = [{
            'id': r[0], 'username': r[1], 'currency': r[2], 'amount': float(r[3]),
            'to_address': r[4][:12] + '...', 'aml_status': r[5],
            'risk_score': float(r[6]) if r[6] else 0, 'created_at': r[7].isoformat()
        } for r in cur.fetchall()]

        conn.close()
        return resp(200, {
            'blacklisted_addresses': blacklisted,
            'watchlisted_addresses': watchlisted,
            'blocked_withdrawals': blocked_wd,
            'flagged_withdrawals': flagged_wd,
            'pending_aml_review': pending_aml,
            'frozen_users': frozen_users,
            'pending_whitelist': pending_wl,
            'recent_flagged': flagged_list,
        })

    # ── Suspension status (Support — anti-tipping-off: без деталей AML) ───────
    if action == 'user-compliance-status' and method == 'GET':
        staff = get_staff(conn, token, 'support')
        if not staff:
            conn.close(); return resp(403, {'error': 'Требуется роль Support+'})
        target_uid = int(qs.get('user_id', 0))
        is_comp = ROLE_LEVELS.get(staff['role'], 0) >= ROLE_LEVELS['compliance']
        cur.execute(
            f"SELECT is_frozen, freeze_reason, aml_status, aml_risk_score, "
            f"deposit_suspended, withdrawal_whitelist_only FROM {SCHEMA}.users WHERE id=%s",
            (target_uid,)
        )
        u = cur.fetchone()
        if not u:
            conn.close(); return resp(404, {'error': 'Пользователь не найден'})
        # Anti-tipping-off: Support видит только is_frozen и deposit_suspended
        # Compliance видит полные AML-данные
        conn.close()
        return resp(200, {
            'is_frozen': u[0],
            'freeze_reason': u[1] if is_comp else ('Account under review' if u[0] else None),
            'aml_status': u[2] if is_comp else None,     # Support НЕ видит AML статус
            'aml_risk_score': float(u[3]) if (is_comp and u[3]) else None,
            'deposit_suspended': u[4],
            'withdrawal_whitelist_only': u[5],
        })

    conn.close()
    return resp(404, {'error': 'Not found'})
