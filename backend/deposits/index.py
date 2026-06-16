"""Управление депозитами: создание заявки, список, ручное подтверждение (admin)"""
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

def get_user_by_token(conn, token: str):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.username, u.is_admin FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    method = event.get('httpMethod', 'GET')
    qs = event.get('queryStringParameters') or {}
    action = qs.get('action', 'list')
    body = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    conn = get_conn()
    user = get_user_by_token(conn, token)
    if not user:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})

    user_id, username, is_admin = user
    cur = conn.cursor()

    # list — список депозитов пользователя
    if action == 'list':
        cur.execute(
            f"SELECT id, network, address, tx_hash, amount, currency, status, created_at FROM {SCHEMA}.deposits WHERE user_id=%s ORDER BY created_at DESC LIMIT 50",
            (user_id,)
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'network': r[1], 'address': r[2], 'tx_hash': r[3],
                   'amount': float(r[4]) if r[4] else None, 'currency': r[5],
                   'status': r[6], 'created_at': r[7].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'deposits': result})

    # create — создать заявку на депозит
    if action == 'create' and method == 'POST':
        network = body.get('network', '').upper()
        if network not in ('TRON', 'ETH', 'TON'):
            conn.close()
            return resp(400, {'error': 'Неверная сеть'})

        cur.execute(f"SELECT address FROM {SCHEMA}.crypto_wallets WHERE user_id=%s AND network=%s", (user_id, network))
        row = cur.fetchone()
        if not row:
            conn.close()
            return resp(400, {'error': 'Кошелёк не найден'})

        address = row[0]
        cur.execute(
            f"INSERT INTO {SCHEMA}.deposits (user_id, network, address, currency) VALUES (%s, %s, %s, 'USDT') RETURNING id",
            (user_id, network, address)
        )
        dep_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return resp(200, {'id': dep_id, 'address': address, 'network': network})

    # confirm — подтвердить депозит (только admin)
    if action == 'confirm' and method == 'PUT':
        if not is_admin:
            conn.close()
            return resp(403, {'error': 'Доступ запрещён'})

        dep_id = body.get('deposit_id')
        amount = float(body.get('amount', 0))
        tx_hash = body.get('tx_hash', '')

        if not dep_id or amount <= 0:
            conn.close()
            return resp(400, {'error': 'Укажите deposit_id и amount'})

        cur.execute(f"SELECT user_id, status, currency FROM {SCHEMA}.deposits WHERE id=%s", (dep_id,))
        dep = cur.fetchone()
        if not dep:
            conn.close()
            return resp(404, {'error': 'Депозит не найден'})

        dep_user_id, status, currency = dep
        if status == 'confirmed':
            conn.close()
            return resp(400, {'error': 'Депозит уже подтверждён'})

        cur.execute(
            f"UPDATE {SCHEMA}.deposits SET status='confirmed', amount=%s, tx_hash=%s, confirmed_at=NOW() WHERE id=%s",
            (amount, tx_hash, dep_id)
        )
        cur.execute(
            f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, currency)
                DO UPDATE SET available = {SCHEMA}.user_balances.available + EXCLUDED.available""",
            (dep_user_id, currency, amount)
        )
        cur.execute(
            f"INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, ref_id, note) VALUES (%s, 'deposit', %s, %s, %s, 'Пополнение')",
            (dep_user_id, currency, amount, str(dep_id))
        )
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # all — все депозиты (только admin)
    if action == 'all':
        if not is_admin:
            conn.close()
            return resp(403, {'error': 'Доступ запрещён'})

        cur.execute(
            f"""SELECT d.id, u.username, u.email, d.network, d.address, d.tx_hash,
                       d.amount, d.currency, d.status, d.created_at
                FROM {SCHEMA}.deposits d JOIN {SCHEMA}.users u ON u.id=d.user_id
                ORDER BY d.created_at DESC LIMIT 200"""
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'username': r[1], 'email': r[2], 'network': r[3], 'address': r[4],
                   'tx_hash': r[5], 'amount': float(r[6]) if r[6] else None,
                   'currency': r[7], 'status': r[8], 'created_at': r[9].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'deposits': result})

    conn.close()
    return resp(404, {'error': 'Not found'})
