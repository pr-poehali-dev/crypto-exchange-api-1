"""История транзакций пользователя"""
import json
import os
import psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def get_user_by_token(conn, token: str):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    row = cur.fetchone()
    return row[0] if row else None

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    token = event.get('headers', {}).get('X-Auth-Token', '')
    conn = get_conn()
    user_id = get_user_by_token(conn, token)
    if not user_id:
        conn.close()
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Не авторизован'})}

    cur = conn.cursor()
    cur.execute(
        f"SELECT id, type, currency, amount, fee, status, note, created_at FROM {SCHEMA}.transactions WHERE user_id=%s ORDER BY created_at DESC LIMIT 100",
        (user_id,)
    )
    rows = cur.fetchall()
    result = [{'id': r[0], 'type': r[1], 'currency': r[2], 'amount': float(r[3]),
               'fee': float(r[4]), 'status': r[5], 'note': r[6], 'created_at': r[7].isoformat()} for r in rows]
    conn.close()
    return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'transactions': result})}
