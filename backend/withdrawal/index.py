"""
Вывод криптовалюты на внешний кошелёк.
Поддерживает BTC, ETH, USDT (ERC-20/TRC-20), BNB, TON, SOL.
Заявки создаются мгновенно, отправка через Tatum (при наличии API-ключа).
Без Tatum — заявки уходят в статус 'pending' для ручной обработки админом.
"""
import json
import os
import re
import urllib.request
import psycopg2
from datetime import datetime

SCHEMA = os.environ['MAIN_DB_SCHEMA']
TATUM_KEY = os.environ.get('TATUM_API_KEY', '')
TATUM_BASE = 'https://api.tatum.io/v3'

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

# Параметры сетей для вывода
NETWORKS = {
    'BTC':        {'currency': 'BTC',  'label': 'Bitcoin',       'chain': 'BTC',  'min': 0.0005, 'fee': 0.0001,   'fee_currency': 'BTC'},
    'ETH':        {'currency': 'ETH',  'label': 'Ethereum',      'chain': 'ETH',  'min': 0.005,  'fee': 0.001,    'fee_currency': 'ETH'},
    'USDT_ERC20': {'currency': 'USDT', 'label': 'USDT ERC-20',   'chain': 'ETH',  'min': 10.0,   'fee': 3.0,      'fee_currency': 'USDT'},
    'USDT_TRC20': {'currency': 'USDT', 'label': 'USDT TRC-20',   'chain': 'TRON', 'min': 5.0,    'fee': 1.0,      'fee_currency': 'USDT'},
    'BNB':        {'currency': 'BNB',  'label': 'BNB BEP-20',    'chain': 'BSC',  'min': 0.02,   'fee': 0.001,    'fee_currency': 'BNB'},
    'TON':        {'currency': 'TON',  'label': 'TON',            'chain': 'TON',  'min': 2.0,    'fee': 0.05,     'fee_currency': 'TON'},
    'SOL':        {'currency': 'SOL',  'label': 'Solana',         'chain': 'SOL',  'min': 0.05,   'fee': 0.000005, 'fee_currency': 'SOL'},
}

# Базовые правила валидации адресов по сети
ADDRESS_PATTERNS = {
    'BTC':        r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$',
    'ETH':        r'^0x[0-9a-fA-F]{40}$',
    'USDT_ERC20': r'^0x[0-9a-fA-F]{40}$',
    'USDT_TRC20': r'^T[A-Za-z1-9]{33}$',
    'BNB':        r'^0x[0-9a-fA-F]{40}$',
    'TON':        r'^[UE][Qf][A-Za-z0-9_\-]{46}$',
    'SOL':        r'^[1-9A-HJ-NP-Za-km-z]{32,44}$',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.username, u.kyc_status FROM {SCHEMA}.auth_sessions s "
        f"JOIN {SCHEMA}.users u ON u.id=s.user_id "
        f"WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def validate_address(network: str, address: str) -> bool:
    pattern = ADDRESS_PATTERNS.get(network)
    if not pattern:
        return len(address) >= 20
    return bool(re.match(pattern, address))

def tatum_send(network: str, to_address: str, amount: float, memo: str = None) -> dict:
    """Отправка через Tatum. Возвращает {'ok': True, 'tx_id': '...'} или {'ok': False, 'error': '...'}"""
    if not TATUM_KEY:
        return {'ok': False, 'error': 'Tatum API key not configured'}

    net = NETWORKS.get(network, {})
    chain = net.get('chain', '')

    # Tatum v3 send endpoint зависит от сети
    chain_map = {
        'BTC': '/bitcoin/transaction',
        'ETH': '/ethereum/transaction',
        'TRON': '/tron/transaction',
        'BSC': '/bsc/transaction',
        'TON': '/ton/transaction',
        'SOL': '/solana/transaction',
    }
    endpoint = chain_map.get(chain)
    if not endpoint:
        return {'ok': False, 'error': f'Unsupported chain: {chain}'}

    body = {
        'to': to_address,
        'amount': str(amount),
        'currency': net.get('currency', ''),
    }
    if memo:
        body['message'] = memo

    url = TATUM_BASE + endpoint
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method='POST', headers={
        'x-api-key': TATUM_KEY,
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            result = json.loads(r.read())
            tx_id = result.get('txId') or result.get('hash') or result.get('id', '')
            return {'ok': True, 'tx_id': tx_id}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        try:
            err_data = json.loads(err)
            return {'ok': False, 'error': err_data.get('message', err)}
        except Exception:
            return {'ok': False, 'error': err[:200]}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

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

    user_id, username, kyc_status = user
    cur = conn.cursor()

    # GET ?action=networks — информация о сетях и комиссиях
    if action == 'networks' and method == 'GET':
        result = {}
        for net_key, net_info in NETWORKS.items():
            # Получить баланс нужной валюты
            currency = net_info['currency']
            cur.execute(
                f"SELECT available FROM {SCHEMA}.user_balances WHERE user_id=%s AND currency=%s",
                (user_id, currency)
            )
            row = cur.fetchone()
            balance = float(row[0]) if row else 0.0
            result[net_key] = {
                **net_info,
                'balance': balance,
            }
        conn.close()
        return resp(200, {'networks': result})

    # POST ?action=create — создать заявку на вывод
    if action == 'create' and method == 'POST':
        network   = body.get('network', '').upper()
        to_address = body.get('address', '').strip()
        memo      = body.get('memo', '').strip() or None
        try:
            amount = float(body.get('amount', 0))
        except Exception:
            conn.close()
            return resp(400, {'error': 'Неверная сумма'})

        # Валидации
        if network not in NETWORKS:
            conn.close()
            return resp(400, {'error': f'Сеть не поддерживается'})

        net_info = NETWORKS[network]
        currency = net_info['currency']
        min_amount = net_info['min']
        fee = net_info['fee']
        total_needed = amount + fee

        if amount < min_amount:
            conn.close()
            return resp(400, {'error': f'Минимальная сумма вывода: {min_amount} {currency}'})

        if not to_address:
            conn.close()
            return resp(400, {'error': 'Укажите адрес получателя'})

        if not validate_address(network, to_address):
            conn.close()
            return resp(400, {'error': f'Неверный формат адреса для сети {net_info["label"]}'})

        # Нельзя выводить на свой депозитный адрес
        cur.execute(
            f"SELECT id FROM {SCHEMA}.wallet_addresses WHERE user_id=%s AND network=%s AND address=%s",
            (user_id, network, to_address)
        )
        if cur.fetchone():
            conn.close()
            return resp(400, {'error': 'Нельзя выводить на собственный депозитный адрес'})

        # Проверить баланс (сумма + комиссия)
        cur.execute(
            f"SELECT available FROM {SCHEMA}.user_balances WHERE user_id=%s AND currency=%s",
            (user_id, currency)
        )
        row = cur.fetchone()
        balance = float(row[0]) if row else 0.0

        if balance < total_needed:
            conn.close()
            return resp(400, {'error': f'Недостаточно средств. Нужно {total_needed:.8f} {currency} (включая комиссию {fee} {currency}), доступно {balance:.8f}'})

        # Заморозить средства на балансе
        cur.execute(
            f"UPDATE {SCHEMA}.user_balances SET available=available-%s WHERE user_id=%s AND currency=%s",
            (total_needed, user_id, currency)
        )

        # Создать заявку
        cur.execute(
            f"""INSERT INTO {SCHEMA}.withdrawals
                (user_id, network, currency, amount, fee, to_address, memo, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
                RETURNING id""",
            (user_id, network, currency, amount, fee, to_address, memo)
        )
        withdrawal_id = cur.fetchone()[0]

        # Записать транзакцию с статусом processing
        cur.execute(
            f"""INSERT INTO {SCHEMA}.transactions
                (user_id, type, currency, amount, fee, status, note)
                VALUES (%s, 'withdrawal', %s, %s, %s, 'processing', %s)""",
            (user_id, currency, amount, fee, f'Вывод {net_info["label"]} → {to_address[:16]}...')
        )
        conn.commit()

        # Попробовать отправить через Tatum сразу
        tatum_result = tatum_send(network, to_address, amount, memo)
        final_status = 'pending'
        tx_hash = None

        if tatum_result['ok']:
            tx_hash = tatum_result.get('tx_id', '')
            final_status = 'processing'
            cur.execute(
                f"UPDATE {SCHEMA}.withdrawals SET status='processing', tatum_tx_id=%s, updated_at=NOW() WHERE id=%s",
                (tx_hash, withdrawal_id)
            )
            conn.commit()

        conn.close()
        return resp(200, {
            'ok': True,
            'withdrawal_id': withdrawal_id,
            'status': final_status,
            'amount': amount,
            'fee': fee,
            'currency': currency,
            'network': net_info['label'],
            'to_address': to_address,
            'tx_hash': tx_hash,
            'auto_sent': tatum_result['ok'],
            'message': 'Заявка отправлена в блокчейн' if tatum_result['ok'] else 'Заявка принята, будет обработана в течение 24 часов',
        })

    # GET ?action=list — история выводов пользователя
    if action == 'list' and method == 'GET':
        cur.execute(
            f"""SELECT id, network, currency, amount, fee, to_address, memo,
                       status, tx_hash, created_at, updated_at
                FROM {SCHEMA}.withdrawals
                WHERE user_id=%s
                ORDER BY created_at DESC LIMIT 50""",
            (user_id,)
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'network': r[1], 'currency': r[2],
            'amount': float(r[3]), 'fee': float(r[4]),
            'to_address': r[5], 'memo': r[6],
            'status': r[7], 'tx_hash': r[8],
            'created_at': r[9].isoformat(),
            'updated_at': r[10].isoformat() if r[10] else None,
        } for r in rows]
        conn.close()
        return resp(200, {'withdrawals': result})

    # GET ?action=fee&network=USDT_TRC20 — получить комиссию для сети
    if action == 'fee' and method == 'GET':
        network = qs.get('network', '').upper()
        net_info = NETWORKS.get(network)
        if not net_info:
            conn.close()
            return resp(400, {'error': 'Сеть не найдена'})
        conn.close()
        return resp(200, {
            'network': network,
            'fee': net_info['fee'],
            'fee_currency': net_info['fee_currency'],
            'min': net_info['min'],
            'currency': net_info['currency'],
        })

    # PUT ?action=admin-complete — только для админа: отметить завершённым
    if action == 'admin-complete' and method == 'PUT':
        cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id=%s", (user_id,))
        is_admin = cur.fetchone()
        if not is_admin or not is_admin[0]:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})

        withdrawal_id = body.get('withdrawal_id')
        tx_hash = body.get('tx_hash', '')
        cur.execute(
            f"UPDATE {SCHEMA}.withdrawals SET status='completed', tx_hash=%s, updated_at=NOW() WHERE id=%s RETURNING user_id, currency, amount, fee",
            (tx_hash, withdrawal_id)
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return resp(404, {'error': 'Заявка не найдена'})
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # PUT ?action=admin-reject — только для админа: отклонить и вернуть средства
    if action == 'admin-reject' and method == 'PUT':
        cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id=%s", (user_id,))
        is_admin = cur.fetchone()
        if not is_admin or not is_admin[0]:
            conn.close()
            return resp(403, {'error': 'Нет доступа'})

        withdrawal_id = body.get('withdrawal_id')
        admin_note = body.get('note', '')
        cur.execute(
            f"UPDATE {SCHEMA}.withdrawals SET status='rejected', admin_note=%s, updated_at=NOW() WHERE id=%s AND status='pending' RETURNING user_id, currency, amount, fee",
            (admin_note, withdrawal_id)
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return resp(404, {'error': 'Заявка не найдена или уже обработана'})
        w_user_id, currency, amount, fee = row
        # Вернуть средства на баланс
        cur.execute(
            f"UPDATE {SCHEMA}.user_balances SET available=available+%s WHERE user_id=%s AND currency=%s",
            (float(amount) + float(fee), w_user_id, currency)
        )
        conn.commit()
        conn.close()
        return resp(200, {'ok': True, 'refunded': float(amount) + float(fee)})

    conn.close()
    return resp(404, {'error': 'Not found'})
