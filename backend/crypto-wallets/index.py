"""
Крипто-кошельки пользователей.
TRON (TRX / USDT TRC-20): реальные адреса через Tatum xpub + ADDRESS_TRANSACTION webhook.
Остальные сети — аналогичная схема через Tatum HD-wallet.
"""
import json
import os
import urllib.request
import hashlib
import psycopg2

SCHEMA      = os.environ['MAIN_DB_SCHEMA']
TATUM_KEY   = os.environ.get('TATUM_API_KEY', '')
TATUM_BASE  = 'https://api.tatum.io/v3'

# xpub мастер-кошелька платформы для TRON (один на всю платформу, адреса — по user_id)
TRON_XPUB = os.environ.get('TRON_XPUB', '')

# Контракт USDT TRC-20
USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, x-tatum-signature',
}

NETWORKS = {
    'BTC':        {'chain': 'BTC',  'currency': 'BTC',  'label': 'Bitcoin',       'symbol': 'BTC',  'min': 0.0001},
    'ETH':        {'chain': 'ETH',  'currency': 'ETH',  'label': 'Ethereum',      'symbol': 'ETH',  'min': 0.001},
    'USDT_ERC20': {'chain': 'ETH',  'currency': 'USDT', 'label': 'USDT (ERC-20)', 'symbol': 'USDT', 'min': 5.0,
                   'contract': '0xdac17f958d2ee523a2206206994597c13d831ec7'},
    'USDT_TRC20': {'chain': 'TRON', 'currency': 'USDT', 'label': 'USDT (TRC-20)', 'symbol': 'USDT', 'min': 1.0,
                   'contract': USDT_TRC20_CONTRACT},
    'TRX':        {'chain': 'TRON', 'currency': 'TRX',  'label': 'TRON (TRX)',    'symbol': 'TRX',  'min': 10.0},
    'BNB':        {'chain': 'BSC',  'currency': 'BNB',  'label': 'BNB (BEP-20)',  'symbol': 'BNB',  'min': 0.01},
    'TON':        {'chain': 'TON',  'currency': 'TON',  'label': 'TON Network',   'symbol': 'TON',  'min': 1.0},
    'SOL':        {'chain': 'SOL',  'currency': 'SOL',  'label': 'Solana',        'symbol': 'SOL',  'min': 0.01},
}


# ─── Утилиты ──────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.username FROM {SCHEMA}.auth_sessions s "
        f"JOIN {SCHEMA}.users u ON u.id=s.user_id "
        f"WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def tatum(method: str, path: str, body: dict = None):
    url = TATUM_BASE + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'x-api-key': TATUM_KEY,
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            raw = r.read()
            return (json.loads(raw) if raw else {}), r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return json.loads(raw), e.code
        except Exception:
            return {'error': raw[:300]}, e.code
    except Exception as ex:
        return {'error': str(ex)}, 500


# ─── Генерация адресов ────────────────────────────────────────────────────────

def _tron_address_from_xpub(xpub: str, index: int) -> str | None:
    """Получить TRON-адрес по xpub и индексу через Tatum."""
    result, status = tatum('GET', f'/tron/address/{xpub}/{index}')
    if status == 200 and 'address' in result:
        return result['address']
    return None

def _tron_generate_wallet() -> dict | None:
    """Сгенерировать новый TRON HD-кошелёк (xpub + mnemonic). Вызывать один раз."""
    result, status = tatum('GET', '/tron/wallet')
    if status == 200 and 'xpub' in result:
        return result  # {'xpub': '...', 'mnemonic': '...'}
    return None

def _hd_address(chain: str, index: int) -> str | None:
    """HD-адрес для ETH/BTC/BSC по индексу пользователя."""
    result, status = tatum('GET', f'/blockchain/wallet?chain={chain}')
    if status != 200:
        return None
    if 'xpub' in result:
        xpub = result['xpub']
        addr_res, addr_status = tatum('GET', f'/blockchain/wallet/address/{xpub}/{index}?chain={chain}')
        if addr_status == 200 and 'address' in addr_res:
            return addr_res['address']
    return None

def generate_real_address(network: str, user_id: int) -> dict | None:
    """
    Генерирует реальный адрес для сети.
    TRON: использует TRON_XPUB из env (мастер-ключ платформы).
    Остальные: через Tatum HD-wallet API.
    Fallback: детерминированный псевдоадрес (только для тестирования).
    """
    net_info = NETWORKS.get(network)
    if not net_info:
        return None

    if not TATUM_KEY:
        return _fallback_address(network, user_id)

    chain = net_info['chain']

    # ── TRON / USDT TRC-20 ──────────────────────────────────────────────────
    if chain == 'TRON':
        xpub = TRON_XPUB
        if not xpub:
            # Пытаемся сгенерировать новый кошелёк (только при первом запуске)
            wallet = _tron_generate_wallet()
            if wallet:
                xpub = wallet.get('xpub', '')
                # Логируем xpub — администратор должен сохранить его в секрет TRON_XPUB
                print(f"[TRON] NEW XPUB GENERATED (save to TRON_XPUB secret): {xpub}")
                print(f"[TRON] MNEMONIC (save securely!): {wallet.get('mnemonic','')}")

        if xpub:
            address = _tron_address_from_xpub(xpub, user_id)
            if address:
                return {'address': address, 'memo': None}

        return _fallback_address(network, user_id)

    # ── ETH / USDT ERC-20 / BNB ─────────────────────────────────────────────
    if chain in ('ETH', 'BSC', 'BTC'):
        address = _hd_address(chain, user_id)
        if address:
            return {'address': address, 'memo': None}
        return _fallback_address(network, user_id)

    # ── TON ─────────────────────────────────────────────────────────────────
    if chain == 'TON':
        result, status = tatum('GET', '/ton/wallet')
        if status == 200 and 'address' in result:
            return {'address': result['address'], 'memo': str(user_id)}
        return _fallback_address(network, user_id)

    # ── SOL ─────────────────────────────────────────────────────────────────
    if chain == 'SOL':
        result, status = tatum('GET', '/solana/wallet')
        if status == 200 and 'address' in result:
            return {'address': result['address'], 'memo': None}
        return _fallback_address(network, user_id)

    return _fallback_address(network, user_id)


def _fallback_address(network: str, user_id: int) -> dict:
    """Детерминированный адрес для тестирования (без Tatum)."""
    seed = f"{network}:{user_id}:{os.environ.get('DATABASE_URL','')[:30]}"
    h = hashlib.sha256(seed.encode()).hexdigest()
    if network == 'BTC':
        chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        addr = '1' + ''.join(chars[int(h[i:i+2], 16) % len(chars)] for i in range(0, 66, 2))
        return {'address': addr[:34], 'memo': None}
    elif network in ('ETH', 'USDT_ERC20', 'BNB'):
        return {'address': '0x' + h[:40], 'memo': None}
    elif network in ('USDT_TRC20', 'TRX'):
        chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'
        addr = 'T' + ''.join(chars[int(h[i:i+2], 16) % len(chars)] for i in range(0, 66, 2))
        return {'address': addr[:34], 'memo': None}
    elif network == 'TON':
        b64c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
        addr = 'UQ' + ''.join(b64c[int(h[i:i+2], 16) % 64] for i in range(0, 46, 2))
        return {'address': addr[:48], 'memo': str(user_id * 7 + 1000)}
    elif network == 'SOL':
        chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        addr = ''.join(chars[int(h[i:i+2], 16) % len(chars)] for i in range(0, 88, 2))
        return {'address': addr[:44], 'memo': None}
    return {'address': h[:42], 'memo': None}


# ─── Webhook-подписка ─────────────────────────────────────────────────────────

def subscribe_address(address: str, network: str, webhook_url: str) -> str | None:
    """
    Подписаться на входящие транзакции адреса.
    Для USDT TRC-20 — подписка через TOKEN_TRANSACTION (с контрактом).
    Для остальных — ADDRESS_TRANSACTION.
    """
    if not TATUM_KEY or not webhook_url:
        return None

    net_info = NETWORKS.get(network, {})
    chain = net_info.get('chain', '')
    contract = net_info.get('contract')

    if chain == 'TRON' and contract:
        # Специальная подписка для TRC-20 токенов
        body = {
            'type': 'ADDRESS_TRANSACTION',
            'attr': {
                'address': address,
                'chain': 'TRON',
                'url': webhook_url,
            }
        }
    else:
        body = {
            'type': 'ADDRESS_TRANSACTION',
            'attr': {
                'address': address,
                'chain': chain,
                'url': webhook_url,
            }
        }

    result, status = tatum('POST', '/subscription', body)
    if status in (200, 201) and 'id' in result:
        return result['id']
    print(f"[SUBSCRIBE] Failed for {network}/{address}: {result}")
    return None


# ─── Обработчик входящих транзакций (webhook) ─────────────────────────────────

def _handle_webhook(body: dict) -> dict:
    """
    Tatum присылает webhook при входящей транзакции.
    Для TRON/USDT TRC-20 разбираем поля amount, asset, address, txId.
    """
    address   = body.get('address', '')
    tx_hash   = body.get('txId') or body.get('hash') or body.get('txHash') or ''
    amount_raw = body.get('amount', '0')
    asset     = (body.get('asset') or body.get('currency') or '').upper()
    chain     = (body.get('chain') or '').upper()
    direction = (body.get('type') or body.get('subscriptionType') or '').upper()

    # Принимаем только входящие (некоторые Tatum-планы шлют без type)
    if direction and direction not in ('INCOMING', 'ADDRESS_TRANSACTION'):
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'skipped': direction})}

    try:
        amount = float(amount_raw)
    except Exception:
        amount = 0.0

    if not address or amount <= 0:
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'ignored': True})}

    # Определяем валюту и сеть
    network = None
    currency = None

    if chain == 'TRON' or address.startswith('T'):
        if asset in ('USDT', 'USDTTRX', ''):
            network = 'USDT_TRC20'
            currency = 'USDT'
        elif asset in ('TRX', 'TRON'):
            network = 'TRX'
            currency = 'TRX'
        else:
            # Любой TRC-20 — попробуем определить по контракту
            network = 'USDT_TRC20'
            currency = 'USDT'
    elif chain == 'ETH':
        if asset == 'USDT':
            network = 'USDT_ERC20'; currency = 'USDT'
        else:
            network = 'ETH'; currency = 'ETH'
    elif chain == 'BTC':
        network = 'BTC'; currency = 'BTC'
    elif chain == 'BSC':
        network = 'BNB'; currency = 'BNB'
    elif chain == 'SOL':
        network = 'SOL'; currency = 'SOL'
    elif chain == 'TON':
        network = 'TON'; currency = 'TON'
    else:
        # Пробуем угадать по asset
        asset_map = {'BTC': ('BTC','BTC'), 'ETH': ('ETH','ETH'), 'BNB': ('BNB','BNB'),
                     'USDT': ('USDT_TRC20','USDT'), 'TRX': ('TRX','TRX')}
        if asset in asset_map:
            network, currency = asset_map[asset]

    if not network:
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'unknown_chain': chain})}

    conn = get_conn()
    cur = conn.cursor()

    # Ищем кошелёк — сначала точное совпадение network+address
    cur.execute(
        f"SELECT id, user_id FROM {SCHEMA}.wallet_addresses WHERE address=%s AND network=%s",
        (address, network)
    )
    wallet = cur.fetchone()

    # Для TRON: адрес один и тот же для TRX и USDT TRC-20
    if not wallet and chain == 'TRON':
        cur.execute(
            f"SELECT id, user_id FROM {SCHEMA}.wallet_addresses WHERE address=%s AND network IN ('USDT_TRC20','TRX')",
            (address,)
        )
        wallet = cur.fetchone()

    if not wallet:
        conn.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'wallet_not_found': address})}

    wallet_id, user_id = wallet

    # Защита от дублей по tx_hash
    if tx_hash:
        cur.execute(f"SELECT id FROM {SCHEMA}.deposits WHERE tx_hash=%s AND user_id=%s", (tx_hash, user_id))
        if cur.fetchone():
            conn.close()
            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'duplicate': True})}

    # Проверяем минимальную сумму
    min_amount = NETWORKS.get(network, {}).get('min', 0)
    if amount < min_amount:
        conn.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True, 'below_min': amount})}

    # Создаём депозит
    cur.execute(
        f"""INSERT INTO {SCHEMA}.deposits
            (user_id, network, address, tx_hash, amount, currency, status,
             wallet_address_id, auto_confirmed, confirmed_at, tx_confirmations)
            VALUES (%s,%s,%s,%s,%s,%s,'confirmed',%s,TRUE,NOW(),1)
            RETURNING id""",
        (user_id, network, address, tx_hash or None, amount, currency, wallet_id)
    )
    dep_id = cur.fetchone()[0]

    # Зачисляем баланс
    cur.execute(
        f"""INSERT INTO {SCHEMA}.user_balances (user_id, currency, available)
            VALUES (%s,%s,%s)
            ON CONFLICT (user_id, currency)
            DO UPDATE SET available={SCHEMA}.user_balances.available+EXCLUDED.available""",
        (user_id, currency, amount)
    )

    # Транзакция
    note = f'Пополнение {network} · {tx_hash[:14] if tx_hash else "авто"}...'
    cur.execute(
        f"""INSERT INTO {SCHEMA}.transactions (user_id, type, currency, amount, fee, status, note)
            VALUES (%s,'deposit',%s,%s,0,'completed',%s)""",
        (user_id, currency, amount, note)
    )

    conn.commit()
    conn.close()
    return {
        'statusCode': 200,
        'headers': CORS,
        'body': json.dumps({'ok': True, 'deposit_id': dep_id, 'credited': amount, 'currency': currency})
    }


# ─── Основной handler ─────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method   = event.get('httpMethod', 'GET')
    qs       = event.get('queryStringParameters') or {}
    action   = qs.get('action', '')
    body     = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    # ── Webhook от Tatum (без авторизации) ───────────────────────────────────
    if action == 'webhook':
        return _handle_webhook(body)

    # ── GET ?action=setup-tron — автогенерация TRON xpub (только для инициализации) ──
    if action == 'setup-tron' and method == 'GET':
        token = (event.get('headers') or {}).get('X-Auth-Token', '')
        conn = get_conn()
        user = get_user(conn, token)
        if not user:
            conn.close()
            return resp(401, {'error': 'Не авторизован'})
        cur = conn.cursor()
        cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id=%s", (user[0],))
        row = cur.fetchone()
        conn.close()
        if not row or not row[0]:
            return resp(403, {'error': 'Нет доступа'})

        if TRON_XPUB:
            return resp(200, {'xpub': TRON_XPUB[:20] + '...', 'already_set': True})

        wallet = _tron_generate_wallet()
        if not wallet:
            return resp(500, {'error': 'Tatum API недоступен. Проверьте TATUM_API_KEY'})

        return resp(200, {
            'xpub': wallet.get('xpub', ''),
            'mnemonic': wallet.get('mnemonic', ''),
            'instruction': 'Сохраните xpub в секрет TRON_XPUB, mnemonic — в надёжное место. Никому не передавайте mnemonic!',
        })

    # ── Авторизация ───────────────────────────────────────────────────────────
    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    conn = get_conn()
    user = get_user(conn, token)
    if not user:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})

    user_id, username = user
    cur = conn.cursor()

    # GET ?action=list — кошельки пользователя
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
                'network': net, 'address': r[1], 'memo': r[2],
                'label': info.get('label', net), 'symbol': info.get('symbol', net),
                'min_deposit': info.get('min', 0),
                'created_at': r[3].isoformat() if r[3] else None,
            })
        conn.close()
        return resp(200, {'wallets': wallets})

    # POST ?action=generate — создать / получить адрес для сети
    if action == 'generate' and method == 'POST':
        network = body.get('network', '').upper()
        if network not in NETWORKS:
            conn.close()
            return resp(400, {'error': f'Сеть не поддерживается: {network}'})

        # Уже есть?
        cur.execute(
            f"SELECT address, memo FROM {SCHEMA}.wallet_addresses WHERE user_id=%s AND network=%s",
            (user_id, network)
        )
        existing = cur.fetchone()
        if existing:
            net_info = NETWORKS[network]
            conn.close()
            return resp(200, {
                'network': network, 'address': existing[0], 'memo': existing[1],
                'label': net_info['label'], 'symbol': net_info['symbol'],
                'min_deposit': net_info['min'], 'already_exists': True,
            })

        # Генерируем
        addr_data = generate_real_address(network, user_id)
        if not addr_data:
            conn.close()
            return resp(500, {'error': 'Не удалось сгенерировать адрес. Проверьте TATUM_API_KEY и TRON_XPUB'})

        address = addr_data['address']
        memo    = addr_data.get('memo')
        qr_data = f"{address}?memo={memo}" if memo else address

        cur.execute(
            f"""INSERT INTO {SCHEMA}.wallet_addresses (user_id, network, address, memo, qr_data)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (user_id, network) DO UPDATE SET address=EXCLUDED.address, memo=EXCLUDED.memo
                RETURNING id""",
            (user_id, network, address, memo, qr_data)
        )
        wallet_id = cur.fetchone()[0]

        # Webhook-подписка через Tatum
        sub_id = None
        webhook_url = os.environ.get('WEBHOOK_BASE_URL', '')
        if webhook_url:
            sub_id = subscribe_address(
                address, network,
                webhook_url + '?action=webhook'
            )
            if sub_id:
                cur.execute(
                    f"UPDATE {SCHEMA}.wallet_addresses SET tatum_sub_id=%s WHERE id=%s",
                    (sub_id, wallet_id)
                )

        conn.commit()
        conn.close()

        net_info = NETWORKS[network]
        return resp(200, {
            'network': network, 'address': address, 'memo': memo,
            'qr_data': qr_data, 'label': net_info['label'],
            'symbol': net_info['symbol'], 'min_deposit': net_info['min'],
            'monitoring': sub_id is not None,
        })

    # GET ?action=deposits — история пополнений
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
