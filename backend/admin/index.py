"""Административная панель: пользователи, балансы, транзакции, управление"""
import json
import os
import psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data)}

def get_admin_user(conn, token: str):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.is_admin FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    row = cur.fetchone()
    if not row or not row[1]:
        return None
    return row[0]

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    method = event.get('httpMethod', 'GET')
    qs = event.get('queryStringParameters') or {}
    action = qs.get('action', '')
    body = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    conn = get_conn()
    admin_id = get_admin_user(conn, token)
    if not admin_id:
        conn.close()
        return resp(403, {'error': 'Доступ запрещён'})

    cur = conn.cursor()

    if action == 'users':
        cur.execute(
            f"""SELECT u.id, u.email, u.username, u.is_admin, u.is_verified, u.kyc_status, u.created_at, u.last_login,
                       COALESCE(SUM(b.available), 0) as total_usdt
                FROM {SCHEMA}.users u
                LEFT JOIN {SCHEMA}.user_balances b ON b.user_id=u.id AND b.currency='USDT'
                GROUP BY u.id ORDER BY u.created_at DESC"""
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'email': r[1], 'username': r[2], 'is_admin': r[3],
                   'is_verified': r[4], 'kyc_status': r[5],
                   'created_at': r[6].isoformat(),
                   'last_login': r[7].isoformat() if r[7] else None,
                   'total_usdt': float(r[8])} for r in rows]
        conn.close()
        return resp(200, {'users': result})

    if action == 'stats':
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users")
        total_users = cur.fetchone()[0]
        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.deposits WHERE status='pending'")
        pending_deposits = cur.fetchone()[0]
        cur.execute(f"SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.deposits WHERE status='confirmed'")
        total_deposited = float(cur.fetchone()[0])
        cur.execute(f"SELECT COALESCE(SUM(available), 0) FROM {SCHEMA}.user_balances WHERE currency='USDT'")
        total_balance = float(cur.fetchone()[0])
        conn.close()
        return resp(200, {
            'total_users': total_users,
            'pending_deposits': pending_deposits,
            'total_deposited': total_deposited,
            'total_balance': total_balance,
        })

    if action == 'balance' and method == 'PUT':
        target_user_id = body.get('user_id')
        currency = body.get('currency', 'USDT')
        amount = float(body.get('amount', 0))
        operation = body.get('operation', 'set')

        if not target_user_id:
            conn.close()
            return resp(400, {'error': 'user_id обязателен'})

        if operation == 'set':
            cur.execute(
                f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, currency)
                    DO UPDATE SET available=%s""",
                (target_user_id, currency, amount, amount)
            )
        elif operation == 'add':
            cur.execute(
                f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, currency)
                    DO UPDATE SET available = {SCHEMA}.user_balances.available + EXCLUDED.available""",
                (target_user_id, currency, amount)
            )

        cur.execute(
            f"INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, note) VALUES (%s, 'admin_adjustment', %s, %s, 'Ручная корректировка')",
            (target_user_id, currency, amount)
        )
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    if action == 'toggle-admin' and method == 'PUT':
        target_user_id = body.get('user_id')
        if not target_user_id:
            conn.close()
            return resp(400, {'error': 'user_id обязателен'})
        cur.execute(f"UPDATE {SCHEMA}.users SET is_admin = NOT is_admin WHERE id=%s RETURNING is_admin", (target_user_id,))
        new_val = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return resp(200, {'is_admin': new_val})

    if action == 'transactions':
        cur.execute(
            f"""SELECT t.id, u.username, t.type, t.currency, t.amount, t.fee, t.status, t.note, t.created_at
                FROM {SCHEMA}.transactions t JOIN {SCHEMA}.users u ON u.id=t.user_id
                ORDER BY t.created_at DESC LIMIT 200"""
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'username': r[1], 'type': r[2], 'currency': r[3],
                   'amount': float(r[4]), 'fee': float(r[5]), 'status': r[6],
                   'note': r[7], 'created_at': r[8].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'transactions': result})

    conn.close()
    return resp(404, {'error': 'Not found'})
