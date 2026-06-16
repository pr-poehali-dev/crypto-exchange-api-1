"""Регистрация, вход, выход, получение профиля пользователя"""
import json
import os
import hashlib
import secrets
import psycopg2
from datetime import datetime, timedelta

SCHEMA = os.environ['MAIN_DB_SCHEMA']

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def make_token() -> str:
    return secrets.token_hex(32)

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data)}

def get_user_by_token(conn, token: str):
    cur = conn.cursor()
    cur.execute(
        f"""SELECT u.id, u.email, u.username, u.is_admin, u.kyc_status, u.created_at
            FROM {SCHEMA}.auth_sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > NOW()""",
        (token,)
    )
    return cur.fetchone()

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

    # register
    if action == 'register' and method == 'POST':
        email = body.get('email', '').strip().lower()
        username = body.get('username', '').strip()
        password = body.get('password', '')

        if not email or not username or not password:
            conn.close()
            return resp(400, {'error': 'Все поля обязательны'})
        if len(password) < 8:
            conn.close()
            return resp(400, {'error': 'Пароль минимум 8 символов'})

        cur = conn.cursor()
        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE email=%s OR username=%s", (email, username))
        if cur.fetchone():
            conn.close()
            return resp(409, {'error': 'Email или username уже занят'})

        pw_hash = hash_password(password)
        cur.execute(
            f"INSERT INTO {SCHEMA}.users (email, username, password_hash) VALUES (%s, %s, %s) RETURNING id",
            (email, username, pw_hash)
        )
        user_id = cur.fetchone()[0]

        for currency in ['USDT', 'BTC', 'ETH', 'BNB', 'SOL']:
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_balances (user_id, currency) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (user_id, currency)
            )

        token_val = make_token()
        expires = datetime.utcnow() + timedelta(days=30)
        cur.execute(
            f"INSERT INTO {SCHEMA}.auth_sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
            (user_id, token_val, expires)
        )
        conn.commit()
        conn.close()
        return resp(200, {'token': token_val, 'user': {'id': user_id, 'email': email, 'username': username, 'is_admin': False}})

    # login
    if action == 'login' and method == 'POST':
        email = body.get('email', '').strip().lower()
        password = body.get('password', '')
        pw_hash = hash_password(password)

        cur = conn.cursor()
        cur.execute(
            f"SELECT id, email, username, is_admin FROM {SCHEMA}.users WHERE (email=%s OR username=%s) AND password_hash=%s",
            (email, email, pw_hash)
        )
        user = cur.fetchone()
        if not user:
            conn.close()
            return resp(401, {'error': 'Неверный email или пароль'})

        user_id, user_email, username, is_admin = user
        cur.execute(f"UPDATE {SCHEMA}.users SET last_login=NOW() WHERE id=%s", (user_id,))

        token_val = make_token()
        expires = datetime.utcnow() + timedelta(days=30)
        cur.execute(
            f"INSERT INTO {SCHEMA}.auth_sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
            (user_id, token_val, expires)
        )
        conn.commit()
        conn.close()
        return resp(200, {'token': token_val, 'user': {'id': user_id, 'email': user_email, 'username': username, 'is_admin': is_admin}})

    # me
    if action == 'me' and method == 'GET':
        if not token:
            conn.close()
            return resp(401, {'error': 'Не авторизован'})

        row = get_user_by_token(conn, token)
        if not row:
            conn.close()
            return resp(401, {'error': 'Сессия истекла'})

        user_id, email, username, is_admin, kyc_status, created_at = row
        cur = conn.cursor()
        cur.execute(f"SELECT currency, available, locked FROM {SCHEMA}.user_balances WHERE user_id=%s", (user_id,))
        balances = [{'currency': r[0], 'available': float(r[1]), 'locked': float(r[2])} for r in cur.fetchall()]
        conn.close()
        return resp(200, {
            'id': user_id, 'email': email, 'username': username,
            'is_admin': is_admin, 'kyc_status': kyc_status,
            'created_at': created_at.isoformat(), 'balances': balances,
        })

    # logout
    if action == 'logout' and method == 'POST':
        if token:
            cur = conn.cursor()
            cur.execute(f"UPDATE {SCHEMA}.auth_sessions SET expires_at=NOW() WHERE token=%s", (token,))
            conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    conn.close()
    return resp(404, {'error': 'Not found'})
