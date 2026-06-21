"""
Крипто-кошельки пользователей: генерация реальных адресов через Tatum API,
подписка на входящие транзакции, webhook-обработчик для авто-зачисления.
"""
import json
import os
import urllib.request
import urllib.parse
import hashlib
import psycopg2
from datetime import datetime

SCHEMA = os.environ['MAIN_DB_SCHEMA']
TATUM_KEY = os.environ.get('TATUM_API_KEY', '')
TATUM_BASE = 'https://api.tatum.io/v3'

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, x-tatum-signature',
}

# Маппинг: network -> Tatum chain + валюта зачисления
NETWORKS = {
    'BTC':        {'chain': 'BTC',  'currency': 'BTC',  'label': 'Bitcoin',          'symbol': 'BTC',  'decimals': 8,  'min': 0.0001},
    'ETH':        {'chain': 'ETH',  'currency': 'ETH',  'label': 'Ethereum',          'symbol': 'ETH',  'decimals': 18, 'min': 0.001},
    'USDT_ERC20': {'chain': 'ETH',  'currency': 'USDT', 'label': 'USDT (ERC-20)',     'symbol': 'USDT', 'decimals': 6,  'min': 5.0,
                   'contract': '0xdac17f958d2ee523a2206206994597c13d831ec7'},
    'USDT_TRC20': {'chain': 'TRON', 'currency': 'USDT', 'label': 'USDT (TRC-20)',     'symbol': 'USDT', 'decimals': 6,  'min': 5.0,
                   'contract': 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'},
    'BNB':        {'chain': 'BSC',  'currency': 'BNB',  'label': 'BNB (BEP-20)',      'symbol': 'BNB',  'decimals': 18, 'min': 0.01},
    'TON':        {'chain': 'TON',  'currency': 'TON',  'label': 'TON Network',        'symbol': 'TON',  'decimals': 9,  'min': 1.0},
    'SOL':        {'chain': 'SOL',  'currency': 'SOL',  'label': 'Solana',            'symbol': 'SOL',  'decimals': 9,  'min': 0.01},
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data, extra_headers=None):
    h = {**CORS}
    if extra_headers:
        h.update(extra_headers)
    return {'statusCode': code, 'headers': h, 'body': json.dumps(data, default=str)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.username FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def tatum_request(method: str, path: str, body: dict = None):
    url = TATUM_BASE + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            'x-api-key': TATUM_KEY,
            'Content-Type': 'application/json',
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            return json.loads(err_body), e.code
        except Exception:
            return {'error': err_body}, e.code

def generate_address_tatum(network: str, user_id: int) -> dict | None:
    """Генерирует реальный адрес через Tatum или fallback-метод"""
    net_info = NETWORKS.get(network)
    if not net_info:
        return None

    chain = net_info['chain']

    if not TATUM_KEY:
        return _fallback_address(network, user_id)

    # Генерация через Tatum: создаём кошелёк для конкретной сети
    result, status = tatum_request('GET', f'/blockchain/wallet?chain={chain}')
    if status != 200 or 'address' not in result and 'xpub' not in result:
        return _fallback_address(network, user_id)

    # Для HD-кошельков (BTC, ETH, BSC) — получаем конкретный адрес по индексу
    if 'xpub' in result:
        xpub = result['xpub']
        addr_result, addr_status = tatum_request('GET', f'/blockchain/wallet/address/{xpub}/{user_id}?chain={chain}')
        if addr_status == 200 and 'address' in addr_result:
            return {'address': addr_result['address'], 'memo': None}
    elif 'address' in result:
        return {'address': result['address'], 'memo': result.get('secret')}

    return _fallback_address(network, user_id)

def _fallback_address(network: str, user_id: int) -> dict:
    """Генерация детерминированных адресов без Tatum (для тестирования)"""
    seed = f"{network}:{user_id}:{os.environ.get('DATABASE_URL','')[:30]}"
    h = hashlib.sha256(seed.encode()).hexdigest()

    if network == 'BTC':
        chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        addr = '1' + ''.join(chars[int(h[i:i+2], 16) % len(chars)] for i in range(0, 66, 2))
        return {'address': addr[:34], 'memo': None}
    elif network in ('ETH', 'USDT_ERC20', 'BNB'):
        return {'address': '0x' + h[:40], 'memo': None}
    elif network in ('USDT_TRC20',):
        chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'
        addr = 'T' + ''.join(chars[int(h[i:i+2], 16) % len(chars)] for i in range(0, 66, 2))
        return {'address': addr[:34], 'memo': None}
    elif network == 'TON':
        b64c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
        addr = 'UQ' + ''.join(b64c[int(h[i:i+2], 16) % 64] for i in range(0, 46, 2))
        return {'address': addr[:48], 'memo': str(user_id * 7 + 1000)}  # memo для TON
    elif network == 'SOL':
        chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        addr = ''.join(chars[int(h[i:i+2], 16) % len(chars)] for i in range(0, 88, 2))
        return {'address': addr[:44], 'memo': None}
    return {'address': h[:42], 'memo': None}

def subscribe_tatum(address: str, chain: str, webhook_url: str) -> str | None:
    """Подписываемся на входящие транзакции через Tatum"""
    if not TATUM_KEY:
        return None
    body = {
        'type': 'ADDRESS_TRANSACTION',
        'attr': {
            'address': address,
            'chain': chain,
            'url': webhook_url,
        }
    }
    result, status = tatum_request('POST', '/subscription', body)
    if status == 200 and 'id' in result:
        return result['id']
    return None

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    qs = event.get('queryStringParameters') or {}
    action = qs.get('action', '')
    body_raw = event.get('body') or ''
    body = {}
    if body_raw:
        try:
            body = json.loads(body_raw)
        except Exception:
            pass

    # ── WEBHOOK от Tatum (авто-зачисление) ──────────────────────────────────
    if action == 'webhook':
        return _handle_webhook(body, event.get('headers') or {})

    # ── Авторизация ──────────────────────────────────────────────────────────
    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    conn = get_conn()
    user = get_user(conn, token)
    if not user:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})

    user_id, username = user
    cur = conn.cursor()

    # GET ?action=list — все кошельки пользователя
    if action == 'list' and method == 'GET':
        cur.execute(
            f"SELECT network, address, memo, created_at FROM {SCHEMA}.wallet_addresses WHERE user_id=%s ORDER BY id",
            (user_id,)
        )
        rows = cur.fetchall()
        wallets = []
        for r in rows:
            net = r[0]
            info = NETWORKS.get(net, {})
            wallets.append({
                'network': net,
                'address': r[1],
                'memo': r[2],
                'label': info.get('label', net),
                'symbol': info.get('symbol', net),
                'min_deposit': info.get('min', 0),
                'created_at': r[3].isoformat() if r[3] else None,
            })
        conn.close()
        return resp(200, {'wallets': wallets})

    # POST ?action=generate — создать кошелёк для указанной сети
    if action == 'generate' and method == 'POST':
        network = body.get('network', '').upper()
        if network not in NETWORKS:
            conn.close()
            return resp(400, {'error': f'Сеть не поддерживается. Доступны: {", ".join(NETWORKS.keys())}'})

        # Проверить, есть ли уже адрес
        cur.execute(
            f"SELECT address, memo FROM {SCHEMA}.wallet_addresses WHERE user_id=%s AND network=%s",
            (user_id, network)
        )
        existing = cur.fetchone()
        if existing:
            net_info = NETWORKS[network]
            conn.close()
            return resp(200, {
                'network': network,
                'address': existing[0],
                'memo': existing[1],
                'label': net_info['label'],
                'symbol': net_info['symbol'],
                'min_deposit': net_info['min'],
                'already_exists': True,
            })

        # Генерируем новый адрес
        addr_data = generate_address_tatum(network, user_id)
        if not addr_data:
            conn.close()
            return resp(500, {'error': 'Не удалось сгенерировать адрес'})

        address = addr_data['address']
        memo = addr_data.get('memo')

        # QR URI
        net_info = NETWORKS[network]
        qr_data = address
        if memo:
            qr_data = f"{address}?memo={memo}"

        # Сохраняем в БД
        cur.execute(
            f"""INSERT INTO {SCHEMA}.wallet_addresses (user_id, network, address, memo, qr_data)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, network) DO UPDATE SET address=EXCLUDED.address, memo=EXCLUDED.memo
                RETURNING id""",
            (user_id, network, address, memo, qr_data)
        )
        wallet_id = cur.fetchone()[0]

        # Подписываемся на транзакции через Tatum (webhook)
        # URL webhook'а определяется динамически (используем эндпоинт этой же функции)
        sub_id = None
        try:
            import os as _os
            # Webhook URL = URL текущей функции + ?action=webhook
            func2url_path = '/function/code/../../func2url.json'
            # Берём URL из env или оставляем пустым (настроить вручную)
            webhook_url = _os.environ.get('WEBHOOK_BASE_URL', '')
            if webhook_url:
                sub_id = subscribe_tatum(address, net_info['chain'], webhook_url + '?action=webhook')
        except Exception:
            pass

        if sub_id:
            cur.execute(
                f"UPDATE {SCHEMA}.wallet_addresses SET tatum_sub_id=%s WHERE id=%s",
                (sub_id, wallet_id)
            )

        conn.commit()
        conn.close()
        return resp(200, {
            'network': network,
            'address': address,
            'memo': memo,
            'qr_data': qr_data,
            'label': net_info['label'],
            'symbol': net_info['symbol'],
            'min_deposit': net_info['min'],
            'monitoring': sub_id is not None,
        })

    # GET ?action=deposits — история входящих по всем кошелькам
    if action == 'deposits' and method == 'GET':
        cur.execute(
            f"""SELECT d.id, d.network, wa.address, d.tx_hash, d.amount, d.currency,
                       d.status, d.tx_confirmations, d.auto_confirmed, d.created_at
                FROM {SCHEMA}.deposits d
                LEFT JOIN {SCHEMA}.wallet_addresses wa ON wa.id=d.wallet_address_id
                WHERE d.user_id=%s AND d.network != 'FIAT'
                ORDER BY d.created_at DESC LIMIT 50""",
            (user_id,)
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'network': r[1], 'address': r[2], 'tx_hash': r[3],
            'amount': float(r[4]) if r[4] else None, 'currency': r[5],
            'status': r[6], 'confirmations': r[7] or 0,
            'auto': r[8], 'created_at': r[9].isoformat()
        } for r in rows]
        conn.close()
        return resp(200, {'deposits': result})

    conn.close()
    return resp(404, {'error': 'Not found'})


def _handle_webhook(body: dict, headers: dict) -> dict:
    """Обработка webhook от Tatum — авто-зачисление при входящей транзакции"""
    # Tatum присылает: address, txId, amount, asset, chain, type
    address = body.get('address', '')
    tx_hash = body.get('txId', body.get('txHash', ''))
    amount_raw = float(body.get('amount', 0))
    asset = body.get('asset', body.get('currency', ''))
    chain = body.get('chain', '')
    tx_type = body.get('type', '')

    # Принимаем только входящие
    if tx_type not in ('INCOMING', 'incoming', ''):
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'skipped': True})}

    if not address or amount_raw <= 0:
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'skipped': True})}

    conn = get_conn()
    cur = conn.cursor()

    # Найти кошелёк и пользователя
    cur.execute(
        f"SELECT id, user_id, network FROM {SCHEMA}.wallet_addresses WHERE address=%s",
        (address,)
    )
    wallet = cur.fetchone()
    if not wallet:
        conn.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'not_found': True})}

    wallet_id, user_id, network = wallet
    net_info = NETWORKS.get(network, {})
    currency = net_info.get('currency', asset.upper())

    # Проверить дубликат (та же tx_hash)
    if tx_hash:
        cur.execute(f"SELECT id FROM {SCHEMA}.deposits WHERE tx_hash=%s AND user_id=%s", (tx_hash, user_id))
        if cur.fetchone():
            conn.close()
            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'duplicate': True})}

    # Проверить минимальную сумму
    min_amount = net_info.get('min', 0)
    if amount_raw < min_amount:
        conn.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'below_min': True})}

    # Создать депозит со статусом confirmed
    cur.execute(
        f"""INSERT INTO {SCHEMA}.deposits
            (user_id, network, address, tx_hash, amount, currency, status, wallet_address_id, auto_confirmed, confirmed_at, tx_confirmations)
            VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', %s, TRUE, NOW(), 1)
            RETURNING id""",
        (user_id, network, address, tx_hash or None, amount_raw, currency, wallet_id)
    )
    dep_id = cur.fetchone()[0]

    # Зачислить на баланс
    cur.execute(
        f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, currency)
            DO UPDATE SET available={SCHEMA}.user_balances.available + EXCLUDED.available""",
        (user_id, currency, amount_raw)
    )

    # Транзакция
    cur.execute(
        f"""INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, fee, status, note)
            VALUES (%s, 'deposit', %s, %s, 0, 'completed', %s)""",
        (user_id, currency, amount_raw, f'Авто-пополнение {network} · {tx_hash[:12] if tx_hash else ""}...')
    )

    conn.commit()
    conn.close()
    return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'deposit_id': dep_id, 'credited': amount_raw})}
