"""Быстрый обмен валют внутри платформы по курсу Binance"""
import json
import os
import urllib.request
import psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

# Курсы к USDT (fallback если Binance недоступен)
FALLBACK_RATES = {
    'BTC': 67000.0, 'ETH': 3500.0, 'BNB': 600.0,
    'SOL': 178.0, 'USDT': 1.0,
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    row = cur.fetchone()
    return row[0] if row else None

def get_price_usdt(symbol: str) -> float:
    if symbol == 'USDT':
        return 1.0
    try:
        pair = symbol + 'USDT'
        url = f'https://api.binance.com/api/v3/ticker/price?symbol={pair}'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as r:
            data = json.loads(r.read())
            return float(data['price'])
    except Exception:
        return FALLBACK_RATES.get(symbol, 1.0)

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
    user_id = get_user(conn, token)
    if not user_id:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})

    cur = conn.cursor()

    # GET ?action=rates — получить текущие курсы
    if action == 'rates' and method == 'GET':
        currencies = ['BTC', 'ETH', 'BNB', 'SOL', 'USDT']
        rates = {}
        for c in currencies:
            rates[c] = get_price_usdt(c)
        conn.close()
        return resp(200, {'rates': rates})

    # GET ?action=quote&from=BTC&to=USDT&amount=0.1 — расчёт без обмена
    if action == 'quote' and method == 'GET':
        from_c = qs.get('from', '').upper()
        to_c = qs.get('to', '').upper()
        try:
            amount = float(qs.get('amount', 0))
        except Exception:
            conn.close()
            return resp(400, {'error': 'Неверная сумма'})

        if from_c == to_c:
            conn.close()
            return resp(400, {'error': 'Выберите разные валюты'})

        from_price = get_price_usdt(from_c)
        to_price = get_price_usdt(to_c)
        usdt_value = amount * from_price
        to_amount = usdt_value / to_price
        fee_pct = 0.002  # 0.2%
        fee_usdt = usdt_value * fee_pct
        to_amount_after_fee = (usdt_value - fee_usdt) / to_price
        rate = from_price / to_price

        conn.close()
        return resp(200, {
            'from': from_c, 'to': to_c,
            'amount': amount,
            'rate': round(rate, 8),
            'to_amount': round(to_amount_after_fee, 8),
            'fee_usdt': round(fee_usdt, 4),
            'fee_pct': fee_pct * 100,
        })

    # POST ?action=swap — выполнить обмен
    if action == 'swap' and method == 'POST':
        from_c = body.get('from', '').upper()
        to_c = body.get('to', '').upper()
        try:
            amount = float(body.get('amount', 0))
        except Exception:
            conn.close()
            return resp(400, {'error': 'Неверная сумма'})

        allowed = ['BTC', 'ETH', 'BNB', 'SOL', 'USDT']
        if from_c not in allowed or to_c not in allowed:
            conn.close()
            return resp(400, {'error': 'Валюта не поддерживается'})
        if from_c == to_c:
            conn.close()
            return resp(400, {'error': 'Выберите разные валюты'})
        if amount <= 0:
            conn.close()
            return resp(400, {'error': 'Сумма должна быть больше 0'})

        # Проверить баланс
        cur.execute(f"SELECT available FROM {SCHEMA}.user_balances WHERE user_id=%s AND currency=%s", (user_id, from_c))
        row = cur.fetchone()
        balance = float(row[0]) if row else 0.0
        if balance < amount:
            conn.close()
            return resp(400, {'error': f'Недостаточно {from_c}. Доступно: {balance:.6f}'})

        # Получить курсы и посчитать
        from_price = get_price_usdt(from_c)
        to_price = get_price_usdt(to_c)
        usdt_value = amount * from_price
        fee_usdt = usdt_value * 0.002
        to_amount = (usdt_value - fee_usdt) / to_price

        # Списать from
        cur.execute(
            f"UPDATE {SCHEMA}.user_balances SET available=available-%s WHERE user_id=%s AND currency=%s",
            (amount, user_id, from_c)
        )
        # Зачислить to
        cur.execute(
            f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, currency)
                DO UPDATE SET available={SCHEMA}.user_balances.available + EXCLUDED.available""",
            (user_id, to_c, to_amount)
        )
        note = f'Обмен {amount} {from_c} → {round(to_amount, 8)} {to_c}'
        cur.execute(
            f"INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, fee, status, note) VALUES (%s,'exchange',%s,%s,%s,'completed',%s)",
            (user_id, from_c, amount, round(fee_usdt / from_price, 8), note)
        )
        conn.commit()
        conn.close()
        return resp(200, {
            'ok': True,
            'from': from_c, 'from_amount': amount,
            'to': to_c, 'to_amount': round(to_amount, 8),
            'fee_usdt': round(fee_usdt, 4),
        })

    conn.close()
    return resp(404, {'error': 'Not found'})
