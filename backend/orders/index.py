"""
Торговый движок: создание и матчинг ордеров (limit, market, stop_loss, take_profit).
Весь расчёт ведётся через Decimal для точности. Атомарные транзакции БД.
"""
import json, os, psycopg2
from decimal import Decimal, ROUND_DOWN

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.is_frozen FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def d(val):
    return Decimal(str(val)) if val is not None else Decimal('0')

def audit(cur, admin_id, action, entity_type, entity_id, old_val=None, new_val=None, ip=''):
    cur.execute(
        f"INSERT INTO {SCHEMA}.audit_log (admin_id, admin_name, action, entity_type, entity_id, old_value, new_value, ip_address) "
        f"SELECT %s, username, %s, %s, %s, %s, %s, %s FROM {SCHEMA}.users WHERE id=%s",
        (admin_id, action, entity_type, str(entity_id),
         json.dumps(old_val) if old_val else None,
         json.dumps(new_val) if new_val else None,
         ip, admin_id)
    )

def notify(cur, user_id, ntype, title, body=''):
    cur.execute(
        f"INSERT INTO {SCHEMA}.notifications (user_id, type, title, body) VALUES (%s,%s,%s,%s)",
        (user_id, ntype, title, body)
    )

def _match_orders(conn, cur, new_order_id: int):
    """
    Движок матчинга. Для лимитных ордеров ищем встречные по цене (price-time priority).
    Для рыночных — берём лучшую доступную цену.
    """
    cur.execute(
        f"SELECT id, user_id, symbol, pair_id, side, type, price, qty, filled_qty, status, fee_currency "
        f"FROM {SCHEMA}.orders WHERE id=%s FOR UPDATE",
        (new_order_id,)
    )
    order = cur.fetchone()
    if not order:
        return

    oid, uid, symbol, pair_id, side, otype, price, qty, filled_qty, status, fee_cur = order
    price    = d(price)
    qty      = d(qty)
    filled   = d(filled_qty)
    remain   = qty - filled

    if status not in ('open', 'partial'):
        return

    # Пара — комиссии
    cur.execute(f"SELECT maker_fee, taker_fee FROM {SCHEMA}.trading_pairs WHERE id=%s", (pair_id,))
    pair_row = cur.fetchone()
    maker_fee_rate = d(pair_row[0]) if pair_row else d('0.001')
    taker_fee_rate = d(pair_row[1]) if pair_row else d('0.002')

    # Ищем встречные ордера
    if side == 'buy':
        opp_side = 'sell'
        if otype == 'limit':
            where_price = f"AND o.price <= {price}"
            order_by = "ORDER BY o.price ASC, o.created_at ASC"
        else:  # market
            where_price = ""
            order_by = "ORDER BY o.price ASC, o.created_at ASC"
    else:
        opp_side = 'buy'
        if otype == 'limit':
            where_price = f"AND o.price >= {price}"
            order_by = "ORDER BY o.price DESC, o.created_at ASC"
        else:
            where_price = ""
            order_by = "ORDER BY o.price DESC, o.created_at ASC"

    cur.execute(
        f"SELECT o.id, o.user_id, o.price, o.qty, o.filled_qty, o.type "
        f"FROM {SCHEMA}.orders o "
        f"WHERE o.symbol=%s AND o.side=%s AND o.status IN ('open','partial') AND o.id != %s "
        f"{where_price} {order_by} FOR UPDATE",
        (symbol, opp_side, oid)
    )
    counterparts = cur.fetchall()

    # Получаем base/quote
    base_cur, quote_cur = symbol.split('/')
    if side == 'buy':
        taker_currency = base_cur
        maker_currency = base_cur
    else:
        taker_currency = quote_cur
        maker_currency = quote_cur

    for cp in counterparts:
        if remain <= 0:
            break
        cp_id, cp_uid, cp_price, cp_qty, cp_filled, cp_type = cp
        cp_price  = d(cp_price)
        cp_remain = d(cp_qty) - d(cp_filled)
        if cp_remain <= 0:
            continue

        # Сделка по цене мейкера
        trade_price = cp_price
        trade_qty   = min(remain, cp_remain)
        trade_total = (trade_price * trade_qty).quantize(Decimal('0.00000001'), rounding=ROUND_DOWN)

        taker_fee = (trade_qty * taker_fee_rate).quantize(Decimal('0.00000001'), rounding=ROUND_DOWN)
        maker_fee = (trade_qty * maker_fee_rate).quantize(Decimal('0.00000001'), rounding=ROUND_DOWN)

        # Обновляем балансы
        if side == 'buy':
            # Покупатель (taker): получает base, заплатил quote (уже залочено)
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET available=available+%s WHERE user_id=%s AND currency=%s",
                (float(trade_qty - taker_fee), uid, base_cur)
            )
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET locked=locked-%s WHERE user_id=%s AND currency=%s",
                (float(trade_total), uid, quote_cur)
            )
            # Продавец (maker): получает quote
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET available=available+%s WHERE user_id=%s AND currency=%s",
                (float(trade_total - maker_fee), cp_uid, quote_cur)
            )
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET locked=locked-%s WHERE user_id=%s AND currency=%s",
                (float(trade_qty), cp_uid, base_cur)
            )
        else:
            # Продавец (taker): получает quote
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET available=available+%s WHERE user_id=%s AND currency=%s",
                (float(trade_total - taker_fee), uid, quote_cur)
            )
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET locked=locked-%s WHERE user_id=%s AND currency=%s",
                (float(trade_qty), uid, base_cur)
            )
            # Покупатель (maker): получает base
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET available=available+%s WHERE user_id=%s AND currency=%s",
                (float(trade_qty - maker_fee), cp_uid, base_cur)
            )
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET locked=locked-%s WHERE user_id=%s AND currency=%s",
                (float(trade_total), cp_uid, quote_cur)
            )

        # Записываем сделку
        cur.execute(
            f"INSERT INTO {SCHEMA}.trades (symbol, pair_id, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, qty, total, buy_fee, sell_fee) "
            f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (symbol, pair_id,
             oid if side == 'buy' else cp_id,
             cp_id if side == 'buy' else oid,
             uid if side == 'buy' else cp_uid,
             cp_uid if side == 'buy' else uid,
             float(trade_price), float(trade_qty), float(trade_total),
             float(taker_fee if side == 'buy' else maker_fee),
             float(maker_fee if side == 'buy' else taker_fee))
        )

        # Обновляем last_price пары
        cur.execute(
            f"UPDATE {SCHEMA}.trading_pairs SET last_price=%s, volume_24h=volume_24h+%s WHERE id=%s",
            (float(trade_price), float(trade_qty), pair_id)
        )

        # Обновляем встречный ордер
        new_cp_filled = d(cp_filled) + trade_qty
        cp_status = 'filled' if new_cp_filled >= d(cp_qty) else 'partial'
        cur.execute(
            f"UPDATE {SCHEMA}.orders SET filled_qty=%s, avg_price=%s, status=%s, updated_at=NOW(), "
            f"filled_at=CASE WHEN %s='filled' THEN NOW() ELSE NULL END "
            f"WHERE id=%s",
            (float(new_cp_filled), float(trade_price), cp_status, cp_status, cp_id)
        )

        # Уведомление встречной стороне
        notify(cur, cp_uid, 'order_filled',
               f'Ордер исполнен: {float(trade_qty)} {base_cur} по {float(trade_price)} {quote_cur}')

        remain -= trade_qty

    # Обновляем текущий ордер
    new_filled = qty - remain
    if new_filled >= qty:
        new_status = 'filled'
    elif new_filled > 0:
        new_status = 'partial'
    else:
        new_status = 'open'

    cur.execute(
        f"UPDATE {SCHEMA}.orders SET filled_qty=%s, avg_price=%s, status=%s, updated_at=NOW(), "
        f"filled_at=CASE WHEN %s='filled' THEN NOW() ELSE NULL END WHERE id=%s",
        (float(new_filled), float(price) if price > 0 else 0, new_status, new_status, oid)
    )

    if new_status == 'filled':
        notify(cur, uid, 'order_filled',
               f'Ордер полностью исполнен: {float(qty)} {base_cur}')


def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    qs = event.get('queryStringParameters') or {}
    action = qs.get('action', '')
    body = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    conn = get_conn()
    user = get_user(conn, token)
    if not user:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})
    user_id, is_frozen = user
    if is_frozen:
        conn.close()
        return resp(403, {'error': 'Аккаунт заморожен'})

    cur = conn.cursor()

    # GET ?action=pairs — список торговых пар
    if action == 'pairs' and method == 'GET':
        cur.execute(
            f"SELECT id, symbol, base, quote, is_active, maker_fee, taker_fee, min_qty, tick_size, "
            f"last_price, volume_24h, high_24h, low_24h FROM {SCHEMA}.trading_pairs WHERE is_active=TRUE ORDER BY symbol"
        )
        rows = cur.fetchall()
        pairs = [{
            'id': r[0], 'symbol': r[1], 'base': r[2], 'quote': r[3],
            'maker_fee': float(r[5]), 'taker_fee': float(r[6]),
            'min_qty': float(r[7]), 'tick_size': float(r[8]),
            'last_price': float(r[9]), 'volume_24h': float(r[10]),
            'high_24h': float(r[11]), 'low_24h': float(r[12]),
        } for r in rows]
        conn.close()
        return resp(200, {'pairs': pairs})

    # GET ?action=orderbook&symbol=BTC/USDT — стакан
    if action == 'orderbook' and method == 'GET':
        symbol = qs.get('symbol', 'BTC/USDT')
        cur.execute(
            f"SELECT side, price, SUM(qty - filled_qty) as vol "
            f"FROM {SCHEMA}.orders WHERE symbol=%s AND status IN ('open','partial') "
            f"GROUP BY side, price ORDER BY price DESC",
            (symbol,)
        )
        rows = cur.fetchall()
        bids, asks = [], []
        for r in rows:
            side, price, vol = r
            entry = {'price': float(price), 'qty': float(vol)}
            if side == 'buy':
                bids.append(entry)
            else:
                asks.append(entry)
        # Bids: от высокой к низкой, Asks: от низкой к высокой
        bids.sort(key=lambda x: -x['price'])
        asks.sort(key=lambda x: x['price'])
        conn.close()
        return resp(200, {'symbol': symbol, 'bids': bids[:20], 'asks': asks[:20]})

    # GET ?action=candles&symbol=BTC/USDT&interval=1h&limit=100
    if action == 'candles' and method == 'GET':
        symbol   = qs.get('symbol', 'BTC/USDT')
        interval = qs.get('interval', '1h')
        limit    = min(int(qs.get('limit', '100')), 500)
        cur.execute(
            f"SELECT EXTRACT(EPOCH FROM open_time)*1000 as ts, open, high, low, close, volume "
            f"FROM {SCHEMA}.candles WHERE symbol=%s AND interval=%s "
            f"ORDER BY open_time DESC LIMIT %s",
            (symbol, interval, limit)
        )
        rows = cur.fetchall()
        candles = [{'t': int(r[0]), 'o': float(r[1]), 'h': float(r[2]),
                    'l': float(r[3]), 'c': float(r[4]), 'v': float(r[5])} for r in rows]
        candles.reverse()
        conn.close()
        return resp(200, {'symbol': symbol, 'interval': interval, 'candles': candles})

    # GET ?action=trades&symbol=BTC/USDT — последние сделки
    if action == 'trades' and method == 'GET':
        symbol = qs.get('symbol', 'BTC/USDT')
        cur.execute(
            f"SELECT price, qty, total, created_at FROM {SCHEMA}.trades "
            f"WHERE symbol=%s ORDER BY created_at DESC LIMIT 50",
            (symbol,)
        )
        rows = cur.fetchall()
        trades = [{'price': float(r[0]), 'qty': float(r[1]),
                   'total': float(r[2]), 'time': r[3].isoformat()} for r in rows]
        conn.close()
        return resp(200, {'trades': trades})

    # GET ?action=my-orders — открытые ордера пользователя
    if action == 'my-orders' and method == 'GET':
        symbol = qs.get('symbol', '')
        where_sym = f"AND symbol=%s" if symbol else ""
        params = (user_id, symbol) if symbol else (user_id,)
        cur.execute(
            f"SELECT id, symbol, side, type, status, price, stop_price, qty, filled_qty, avg_price, fee, created_at, updated_at "
            f"FROM {SCHEMA}.orders WHERE user_id=%s AND status NOT IN ('cancelled') {where_sym} "
            f"ORDER BY created_at DESC LIMIT 100",
            params
        )
        rows = cur.fetchall()
        orders = [{
            'id': r[0], 'symbol': r[1], 'side': r[2], 'type': r[3], 'status': r[4],
            'price': float(r[5]) if r[5] else None, 'stop_price': float(r[6]) if r[6] else None,
            'qty': float(r[7]), 'filled_qty': float(r[8]), 'avg_price': float(r[9]) if r[9] else 0,
            'fee': float(r[10]) if r[10] else 0,
            'created_at': r[11].isoformat(), 'updated_at': r[12].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'orders': orders})

    # POST ?action=create — создать ордер
    if action == 'create' and method == 'POST':
        symbol    = body.get('symbol', '').upper()
        side      = body.get('side', '').lower()
        otype     = body.get('type', 'limit').lower()
        try:
            qty   = d(body.get('qty', 0))
            price = d(body.get('price', 0)) if body.get('price') else None
            stop_price = d(body.get('stop_price', 0)) if body.get('stop_price') else None
        except Exception:
            conn.close()
            return resp(400, {'error': 'Неверные числовые параметры'})

        if side not in ('buy', 'sell'):
            conn.close()
            return resp(400, {'error': 'side: buy или sell'})
        if otype not in ('limit', 'market', 'stop_loss', 'take_profit'):
            conn.close()
            return resp(400, {'error': 'Неверный тип ордера'})
        if otype == 'limit' and (not price or price <= 0):
            conn.close()
            return resp(400, {'error': 'Для лимитного ордера укажите цену'})

        # Получить пару
        cur.execute(
            f"SELECT id, base, quote, min_qty, maker_fee, taker_fee, last_price FROM {SCHEMA}.trading_pairs "
            f"WHERE symbol=%s AND is_active=TRUE",
            (symbol,)
        )
        pair = cur.fetchone()
        if not pair:
            conn.close()
            return resp(400, {'error': f'Торговая пара {symbol} не найдена или не активна'})

        pair_id, base_cur, quote_cur, min_qty, maker_fee, taker_fee, last_price = pair
        if qty < d(min_qty):
            conn.close()
            return resp(400, {'error': f'Минимальный объём: {min_qty} {base_cur}'})

        # Рассчитываем сколько заморозить
        if otype == 'market':
            exec_price = d(last_price) if last_price else d('0')
            if exec_price <= 0:
                conn.close()
                return resp(400, {'error': 'Нет рыночной цены для пары'})
        else:
            exec_price = price

        if side == 'buy':
            lock_currency = quote_cur
            lock_amount   = (qty * exec_price * d('1.002')).quantize(Decimal('0.00000001'))
        else:
            lock_currency = base_cur
            lock_amount   = qty

        # Проверяем баланс
        cur.execute(
            f"SELECT available FROM {SCHEMA}.user_balances WHERE user_id=%s AND currency=%s FOR UPDATE",
            (user_id, lock_currency)
        )
        bal_row = cur.fetchone()
        available = d(bal_row[0]) if bal_row else d('0')
        if available < lock_amount:
            conn.close()
            return resp(400, {'error': f'Недостаточно {lock_currency}. Нужно {float(lock_amount):.8f}, доступно {float(available):.8f}'})

        # Замораживаем средства
        cur.execute(
            f"UPDATE {SCHEMA}.user_balances SET available=available-%s, locked=locked+%s WHERE user_id=%s AND currency=%s",
            (float(lock_amount), float(lock_amount), user_id, lock_currency)
        )

        # Создаём ордер
        cur.execute(
            f"""INSERT INTO {SCHEMA}.orders
                (user_id, pair_id, symbol, side, type, status, price, stop_price, qty, fee_currency, locked_amount)
                VALUES (%s,%s,%s,%s,%s,'open',%s,%s,%s,%s,%s) RETURNING id""",
            (user_id, pair_id, symbol, side, otype,
             float(price) if price else None,
             float(stop_price) if stop_price else None,
             float(qty),
             base_cur if side == 'buy' else quote_cur,
             float(lock_amount))
        )
        order_id = cur.fetchone()[0]

        # Матчинг (только для limit и market, не stop)
        if otype in ('limit', 'market'):
            _match_orders(conn, cur, order_id)

        conn.commit()

        # Возвращаем актуальный статус
        cur.execute(
            f"SELECT id, status, filled_qty, avg_price FROM {SCHEMA}.orders WHERE id=%s", (order_id,)
        )
        row = cur.fetchone()
        conn.close()
        return resp(200, {
            'ok': True,
            'order_id': row[0],
            'status': row[1],
            'filled_qty': float(row[2]),
            'avg_price': float(row[3]),
        })

    # DELETE ?action=cancel&order_id=123 — отменить ордер
    if action == 'cancel' and method == 'DELETE':
        order_id = int(qs.get('order_id', 0))
        cur.execute(
            f"SELECT id, user_id, side, symbol, qty, filled_qty, locked_amount, status, fee_currency "
            f"FROM {SCHEMA}.orders WHERE id=%s AND user_id=%s FOR UPDATE",
            (order_id, user_id)
        )
        order = cur.fetchone()
        if not order:
            conn.close()
            return resp(404, {'error': 'Ордер не найден'})
        oid, oud, side, symbol, qty, filled_qty, locked, status, fee_cur = order
        if status in ('filled', 'cancelled'):
            conn.close()
            return resp(400, {'error': 'Ордер уже исполнен или отменён'})

        # Разморозить остаток
        remain_qty = d(qty) - d(filled_qty)
        base_cur, quote_cur = symbol.split('/')
        if side == 'buy':
            # Вернуть quote
            cur.execute(
                f"SELECT last_price FROM {SCHEMA}.trading_pairs WHERE symbol=%s", (symbol,)
            )
            lp = cur.fetchone()
            refund_quote = (remain_qty * d(lp[0] if lp and lp[0] else '0') * d('1.002')).quantize(Decimal('0.00000001'))
            refund_amount = min(d(locked), refund_quote) if d(locked) > 0 else refund_quote
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET available=available+%s, locked=GREATEST(0,locked-%s) WHERE user_id=%s AND currency=%s",
                (float(refund_amount), float(refund_amount), user_id, quote_cur)
            )
        else:
            cur.execute(
                f"UPDATE {SCHEMA}.user_balances SET available=available+%s, locked=GREATEST(0,locked-%s) WHERE user_id=%s AND currency=%s",
                (float(remain_qty), float(remain_qty), user_id, base_cur)
            )

        cur.execute(
            f"UPDATE {SCHEMA}.orders SET status='cancelled', updated_at=NOW() WHERE id=%s", (order_id,)
        )
        conn.commit()
        conn.close()
        return resp(200, {'ok': True, 'cancelled': order_id})

    conn.close()
    return resp(404, {'error': 'Not found'})
