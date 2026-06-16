"""Генерация и получение криптокошельков для пополнения (TRX, ETH, TON)"""
import json
import os
import hashlib
import secrets
import psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def get_user_by_token(conn, token: str):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.username FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def generate_tron_address(seed: str) -> str:
    h = hashlib.sha256(f"tron:{seed}".encode()).hexdigest()
    addr = 'T' + h[:33].upper()
    return addr

def generate_eth_address(seed: str) -> str:
    h = hashlib.sha256(f"eth:{seed}".encode()).hexdigest()
    return '0x' + h[:40]

def generate_ton_address(seed: str) -> str:
    h = hashlib.sha256(f"ton:{seed}".encode()).hexdigest()
    b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    addr = 'UQ' + ''.join(b64chars[int(h[i:i+2], 16) % 64] for i in range(0, 46, 2))
    return addr

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    token = event.get('headers', {}).get('X-Auth-Token', '')
    method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')

    conn = get_conn()
    user = get_user_by_token(conn, token)
    if not user:
        conn.close()
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Не авторизован'})}

    user_id, username = user

    # GET /wallets — получить все кошельки пользователя (создать если нет)
    if method == 'GET':
        cur = conn.cursor()
        cur.execute(f"SELECT network, address FROM {SCHEMA}.crypto_wallets WHERE user_id=%s", (user_id,))
        existing = {r[0]: r[1] for r in cur.fetchall()}

        networks = ['TRON', 'ETH', 'TON']
        seed = f"{user_id}:{username}:{os.environ.get('DATABASE_URL', '')[:20]}"

        generators = {
            'TRON': generate_tron_address,
            'ETH': generate_eth_address,
            'TON': generate_ton_address,
        }

        wallets = []
        for net in networks:
            if net not in existing:
                addr = generators[net](seed)
                cur.execute(
                    f"INSERT INTO {SCHEMA}.crypto_wallets (user_id, network, address) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                    (user_id, net, addr)
                )
                existing[net] = addr
            wallets.append({'network': net, 'address': existing[net]})

        conn.commit()
        conn.close()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'wallets': wallets})}

    conn.close()
    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}
