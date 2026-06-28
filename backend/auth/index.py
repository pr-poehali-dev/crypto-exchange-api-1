"""Регистрация, вход, выход, получение профиля пользователя"""
import json, os, hashlib, secrets, psycopg2
from datetime import datetime, timedelta

SCHEMA = os.environ['MAIN_DB_SCHEMA']

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

# Роли с правом доступа к Admin-панели
STAFF_ROLES = {'support', 'compliance', 'finance', 'devops', 'admin', 'superadmin'}

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
        f"""SELECT u.id, u.email, u.username, u.is_admin, u.kyc_status,
                   u.created_at, u.role, u.kyc_level, u.is_frozen
            FROM {SCHEMA}.auth_sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > NOW()""",
        (token,)
    )
    return cur.fetchone()

def _effective_role(role: str | None, is_admin: bool) -> str:
    """Возвращает эффективную роль с учётом legacy-флага is_admin."""
    if role and role != 'user':
        return role
    if is_admin:
        return 'admin'
    return 'user'

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    qs     = event.get('queryStringParameters') or {}
    action = qs.get('action', '')
    body   = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except Exception:
            pass

    token = (event.get('headers') or {}).get('X-Auth-Token', '')
    conn  = get_conn()

    # ── register ─────────────────────────────────────────────────────────────
    if action == 'register' and method == 'POST':
        email    = body.get('email', '').strip().lower()
        username = body.get('username', '').strip()
        password = body.get('password', '')

        if not email or not username or not password:
            conn.close(); return resp(400, {'error': 'Все поля обязательны'})
        if len(password) < 8:
            conn.close(); return resp(400, {'error': 'Пароль минимум 8 символов'})

        cur = conn.cursor()
        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE email=%s OR username=%s", (email, username))
        if cur.fetchone():
            conn.close(); return resp(409, {'error': 'Email или username уже занят'})

        pw_hash = hash_password(password)
        cur.execute(
            f"INSERT INTO {SCHEMA}.users (email, username, password_hash, role) VALUES (%s,%s,%s,'user') RETURNING id",
            (email, username, pw_hash)
        )
        user_id = cur.fetchone()[0]

        for currency in ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX']:
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_balances (user_id, currency) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (user_id, currency)
            )

        token_val = make_token()
        expires   = datetime.utcnow() + timedelta(days=30)
        ip        = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp', '')
        ua        = (event.get('headers') or {}).get('User-Agent', '')
        cur.execute(
            f"INSERT INTO {SCHEMA}.auth_sessions (user_id, token, expires_at, ip_address, user_agent) VALUES (%s,%s,%s,%s,%s)",
            (user_id, token_val, expires, ip, ua[:500])
        )
        conn.commit(); conn.close()
        return resp(200, {
            'token': token_val,
            'user': {
                'id': user_id, 'email': email, 'username': username,
                'is_admin': False, 'role': 'user', 'kyc_status': 'none',
                'kyc_level': 0, 'balances': [],
            }
        })

    # ── login ─────────────────────────────────────────────────────────────────
    if action == 'login' and method == 'POST':
        email    = body.get('email', '').strip().lower()
        password = body.get('password', '')
        pw_hash  = hash_password(password)

        cur = conn.cursor()
        cur.execute(
            f"SELECT id, email, username, is_admin, role, kyc_status, kyc_level, is_frozen "
            f"FROM {SCHEMA}.users WHERE (email=%s OR username=%s) AND password_hash=%s",
            (email, email, pw_hash)
        )
        user = cur.fetchone()
        if not user:
            conn.close(); return resp(401, {'error': 'Неверный email или пароль'})

        user_id, user_email, username, is_admin, role, kyc_status, kyc_level, is_frozen = user

        if is_frozen:
            conn.close(); return resp(403, {'error': 'Аккаунт заблокирован. Обратитесь в поддержку.'})

        eff_role = _effective_role(role, is_admin)
        cur.execute(f"UPDATE {SCHEMA}.users SET last_login=NOW() WHERE id=%s", (user_id,))

        token_val = make_token()
        expires   = datetime.utcnow() + timedelta(days=30)
        ip        = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp', '')
        ua        = (event.get('headers') or {}).get('User-Agent', '')
        cur.execute(
            f"INSERT INTO {SCHEMA}.auth_sessions (user_id, token, expires_at, ip_address, user_agent) VALUES (%s,%s,%s,%s,%s)",
            (user_id, token_val, expires, ip, ua[:500])
        )
        conn.commit(); conn.close()
        return resp(200, {
            'token': token_val,
            'user': {
                'id': user_id, 'email': user_email, 'username': username,
                'is_admin': eff_role in STAFF_ROLES,
                'role': eff_role,
                'kyc_status': kyc_status or 'none',
                'kyc_level': kyc_level or 0,
                'balances': [],
            }
        })

    # ── me ────────────────────────────────────────────────────────────────────
    if action == 'me' and method == 'GET':
        if not token:
            conn.close(); return resp(401, {'error': 'Не авторизован'})

        row = get_user_by_token(conn, token)
        if not row:
            conn.close(); return resp(401, {'error': 'Сессия истекла'})

        user_id, email, username, is_admin, kyc_status, created_at, role, kyc_level, is_frozen = row

        if is_frozen:
            conn.close(); return resp(403, {'error': 'Аккаунт заблокирован'})

        eff_role = _effective_role(role, is_admin)

        cur = conn.cursor()
        cur.execute(f"SELECT currency, available, locked FROM {SCHEMA}.user_balances WHERE user_id=%s", (user_id,))
        balances = [{'currency': r[0], 'available': float(r[1]), 'locked': float(r[2])} for r in cur.fetchall()]
        conn.close()
        return resp(200, {
            'id': user_id, 'email': email, 'username': username,
            'is_admin': eff_role in STAFF_ROLES,
            'role': eff_role,
            'kyc_status': kyc_status or 'none',
            'kyc_level': kyc_level or 0,
            'created_at': created_at.isoformat(),
            'balances': balances,
        })

    # ── logout ────────────────────────────────────────────────────────────────
    if action == 'logout' and method == 'POST':
        if token:
            cur = conn.cursor()
            cur.execute(f"UPDATE {SCHEMA}.auth_sessions SET expires_at=NOW() WHERE token=%s", (token,))
            conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    conn.close()
    return resp(404, {'error': 'Not found'})
