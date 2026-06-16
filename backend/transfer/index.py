"""Перевод крипты между пользователями платформы"""
import json
import os
import psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.username FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

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
    user = get_user(conn, token)
    if not user:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})

    from_id, from_username = user
    cur = conn.cursor()

    # POST ?action=send — отправить крипту другому пользователю
    if action == 'send' and method == 'POST':
        to_username = body.get('to_username', '').strip()
        currency = body.get('currency', 'USDT').upper()
        try:
            amount = float(body.get('amount', 0))
        except Exception:
            conn.close()
            return resp(400, {'error': 'Неверная сумма'})

        if amount <= 0:
            conn.close()
            return resp(400, {'error': 'Сумма должна быть больше 0'})
        if to_username.lower() == from_username.lower():
            conn.close()
            return resp(400, {'error': 'Нельзя переводить самому себе'})

        # Найти получателя
        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE username=%s", (to_username,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return resp(404, {'error': f'Пользователь @{to_username} не найден'})
        to_id = row[0]

        # Проверить баланс отправителя
        cur.execute(f"SELECT available FROM {SCHEMA}.user_balances WHERE user_id=%s AND currency=%s", (from_id, currency))
        bal_row = cur.fetchone()
        balance = float(bal_row[0]) if bal_row else 0.0
        fee = round(amount * 0.001, 8)  # 0.1% комиссия
        total = amount + fee

        if balance < total:
            conn.close()
            return resp(400, {'error': f'Недостаточно средств. Нужно {total:.6f} {currency} (включая комиссию {fee:.6f})'})

        # Списать у отправителя
        cur.execute(
            f"UPDATE {SCHEMA}.user_balances SET available=available-%s WHERE user_id=%s AND currency=%s",
            (total, from_id, currency)
        )
        # Зачислить получателю
        cur.execute(
            f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, currency)
                DO UPDATE SET available={SCHEMA}.user_balances.available + EXCLUDED.available""",
            (to_id, currency, amount)
        )
        # Записать транзакции обеим сторонам
        note_out = f'Перевод → @{to_username}'
        note_in = f'Перевод от @{from_username}'
        cur.execute(
            f"INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, fee, status, note) VALUES (%s,'transfer_out',%s,%s,%s,'completed',%s)",
            (from_id, currency, amount, fee, note_out)
        )
        cur.execute(
            f"INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, fee, status, note) VALUES (%s,'transfer_in',%s,%s,0,'completed',%s)",
            (to_id, currency, amount, note_in)
        )
        conn.commit()
        conn.close()
        return resp(200, {'ok': True, 'amount': amount, 'fee': fee, 'currency': currency, 'to': to_username})

    # GET ?action=check&username=xxx — проверить существование пользователя
    if action == 'check' and method == 'GET':
        username = qs.get('username', '').strip()
        cur.execute(f"SELECT id, username FROM {SCHEMA}.users WHERE username=%s", (username,))
        row = cur.fetchone()
        conn.close()
        if row:
            return resp(200, {'found': True, 'username': row[1]})
        return resp(200, {'found': False})

    conn.close()
    return resp(404, {'error': 'Not found'})
