"""Пополнение рублями — создание заявки на оплату картой (ручное подтверждение оператором)"""
import json
import os
import psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

# Реквизиты для оплаты (задаются через секрет или здесь как дефолт)
CARD_NUMBER = os.environ.get('PAYMENT_CARD', '2200 0000 0000 0000')
CARD_HOLDER = os.environ.get('PAYMENT_HOLDER', 'NEXUS EXCHANGE')
BANK_NAME   = os.environ.get('PAYMENT_BANK', 'Сбербанк')

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data)}

def get_user(conn, token):
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

    user_id, username, is_admin = user
    cur = conn.cursor()

    # GET ?action=info — реквизиты и курс RUB→USDT
    if action == 'info' and method == 'GET':
        # Получаем курс RUB→USDT с Binance (через USDTRUB)
        import urllib.request
        try:
            url = 'https://api.binance.com/api/v3/ticker/price?symbol=USDTRUB'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=3) as r:
                data = json.loads(r.read())
                rub_per_usdt = float(data['price'])
        except Exception:
            rub_per_usdt = 90.0

        conn.close()
        return resp(200, {
            'card_number': CARD_NUMBER,
            'card_holder': CARD_HOLDER,
            'bank_name': BANK_NAME,
            'rub_per_usdt': round(rub_per_usdt, 2),
            'min_amount_rub': 500,
            'fee_pct': 2.0,
        })

    # POST ?action=create — создать заявку на пополнение рублями
    if action == 'create' and method == 'POST':
        try:
            amount_rub = float(body.get('amount_rub', 0))
        except Exception:
            conn.close()
            return resp(400, {'error': 'Неверная сумма'})

        if amount_rub < 500:
            conn.close()
            return resp(400, {'error': 'Минимальная сумма 500 ₽'})

        # Получить курс
        import urllib.request
        try:
            url = 'https://api.binance.com/api/v3/ticker/price?symbol=USDTRUB'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=3) as r:
                data = json.loads(r.read())
                rub_per_usdt = float(data['price'])
        except Exception:
            rub_per_usdt = 90.0

        fee_rub = round(amount_rub * 0.02, 2)  # 2% комиссия
        usdt_amount = round((amount_rub - fee_rub) / rub_per_usdt, 4)
        order_id = f'F{user_id}{int(amount_rub)}'  # уникальный ID для комментария к переводу

        # Сохранить в deposits как fiat-заявку
        cur.execute(
            f"""INSERT INTO {SCHEMA}.deposits (user_id, network, address, currency, amount, status)
                VALUES (%s, 'FIAT', %s, 'USDT', %s, 'pending') RETURNING id""",
            (user_id, order_id, usdt_amount)
        )
        dep_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return resp(200, {
            'ok': True,
            'deposit_id': dep_id,
            'order_id': order_id,
            'amount_rub': amount_rub,
            'fee_rub': fee_rub,
            'usdt_amount': usdt_amount,
            'card_number': CARD_NUMBER,
            'card_holder': CARD_HOLDER,
            'bank_name': BANK_NAME,
            'comment': f'Перевод NEXUS {order_id}',
        })

    # GET ?action=list — заявки пользователя
    if action == 'list' and method == 'GET':
        cur.execute(
            f"SELECT id, address, amount, status, created_at FROM {SCHEMA}.deposits WHERE user_id=%s AND network='FIAT' ORDER BY created_at DESC LIMIT 20",
            (user_id,)
        )
        rows = cur.fetchall()
        result = [{'id': r[0], 'order_id': r[1], 'usdt_amount': float(r[2]) if r[2] else None,
                   'status': r[3], 'created_at': r[4].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'orders': result})

    conn.close()
    return resp(404, {'error': 'Not found'})
