"""
KYC-верификация: подача документов, загрузка в S3, модерация администратором.
Level 2: паспорт РФ + селфи. Level 3: подтверждение адреса.
"""
import json, os, base64, uuid, boto3, psycopg2

SCHEMA = os.environ['MAIN_DB_SCHEMA']
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def resp(code, data):
    return {'statusCode': code, 'headers': CORS, 'body': json.dumps(data, default=str)}

def get_user(conn, token):
    cur = conn.cursor()
    cur.execute(
        f"SELECT u.id, u.kyc_status, u.kyc_level, u.role FROM {SCHEMA}.auth_sessions s "
        f"JOIN {SCHEMA}.users u ON u.id=s.user_id WHERE s.token=%s AND s.expires_at>NOW()",
        (token,)
    )
    return cur.fetchone()

def s3_client():
    return boto3.client('s3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )

def upload_doc(b64_data: str, filename: str) -> str:
    """Загружает base64-файл в S3, возвращает CDN URL."""
    if b64_data.startswith('data:'):
        header, b64_data = b64_data.split(',', 1)
    raw = base64.b64decode(b64_data)
    key = f"kyc/{uuid.uuid4().hex}/{filename}"
    ctype = 'image/jpeg'
    if filename.endswith('.png'):
        ctype = 'image/png'
    elif filename.endswith('.pdf'):
        ctype = 'application/pdf'
    s3_client().put_object(Bucket='files', Key=key, Body=raw, ContentType=ctype)
    access_key = os.environ['AWS_ACCESS_KEY_ID']
    return f"https://cdn.poehali.dev/projects/{access_key}/bucket/{key}"

def audit(cur, admin_id, action, entity_type, entity_id, old_val=None, new_val=None):
    cur.execute(
        f"INSERT INTO {SCHEMA}.audit_log (admin_id, admin_name, action, entity_type, entity_id, old_value, new_value) "
        f"SELECT %s, username, %s, %s, %s, %s, %s FROM {SCHEMA}.users WHERE id=%s",
        (admin_id, action, entity_type, str(entity_id),
         json.dumps(old_val) if old_val else None,
         json.dumps(new_val) if new_val else None,
         admin_id)
    )

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
    user  = get_user(conn, token)
    if not user:
        conn.close()
        return resp(401, {'error': 'Не авторизован'})

    user_id, kyc_status, kyc_level, role = user
    cur = conn.cursor()
    is_admin = role in ('admin', 'superadmin', 'compliance')

    # GET ?action=status — статус верификации пользователя
    if action == 'status' and method == 'GET':
        cur.execute(
            f"SELECT id, level, status, reject_reason, created_at, updated_at "
            f"FROM {SCHEMA}.kyc_submissions WHERE user_id=%s ORDER BY id DESC LIMIT 1",
            (user_id,)
        )
        row = cur.fetchone()
        conn.close()
        return resp(200, {
            'kyc_level': kyc_level or 0,
            'kyc_status': kyc_status or 'none',
            'submission': {
                'id': row[0], 'level': row[1], 'status': row[2],
                'reject_reason': row[3],
                'created_at': row[4].isoformat(),
                'updated_at': row[5].isoformat(),
            } if row else None
        })

    # POST ?action=submit — подать заявку на KYC Level 2
    if action == 'submit' and method == 'POST':
        # Нельзя подавать если уже approved
        if kyc_status == 'approved' and kyc_level >= 2:
            conn.close()
            return resp(400, {'error': 'Верификация уже пройдена'})

        full_name    = body.get('full_name', '').strip()
        birth_date   = body.get('birth_date', '')
        passport_num = body.get('passport_number', '').strip()
        passport_by  = body.get('passport_issued_by', '').strip()
        passport_dt  = body.get('passport_issued_date', '')

        if not full_name or not birth_date or not passport_num:
            conn.close()
            return resp(400, {'error': 'Заполните все обязательные поля'})

        # Загрузка документов
        passport_url = selfie_url = address_url = None
        try:
            if body.get('doc_passport'):
                passport_url = upload_doc(body['doc_passport'], 'passport.jpg')
            if body.get('doc_selfie'):
                selfie_url = upload_doc(body['doc_selfie'], 'selfie.jpg')
            if body.get('doc_address'):
                address_url = upload_doc(body['doc_address'], 'address.jpg')
        except Exception as e:
            conn.close()
            return resp(500, {'error': f'Ошибка загрузки документа: {str(e)}'})

        if not passport_url or not selfie_url:
            conn.close()
            return resp(400, {'error': 'Необходимо загрузить паспорт и селфи'})

        # Отменяем предыдущие pending заявки
        cur.execute(
            f"UPDATE {SCHEMA}.kyc_submissions SET status='cancelled' WHERE user_id=%s AND status='pending'",
            (user_id,)
        )

        cur.execute(
            f"""INSERT INTO {SCHEMA}.kyc_submissions
                (user_id, level, status, full_name, birth_date, passport_number,
                 passport_issued_by, passport_issued_date, doc_passport_url, doc_selfie_url, doc_address_url)
                VALUES (%s, 2, 'pending', %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id""",
            (user_id, full_name, birth_date or None, passport_num, passport_by,
             passport_dt or None, passport_url, selfie_url, address_url)
        )
        sub_id = cur.fetchone()[0]

        # Обновляем kyc_status у пользователя
        cur.execute(
            f"UPDATE {SCHEMA}.users SET kyc_status='pending' WHERE id=%s", (user_id,)
        )

        conn.commit()
        conn.close()
        return resp(200, {'ok': True, 'submission_id': sub_id, 'message': 'Заявка отправлена на проверку'})

    # ── Админ-действия ────────────────────────────────────────────────────────

    # GET ?action=admin-list — список заявок для модерации
    if action == 'admin-list' and method == 'GET' and is_admin:
        status_filter = qs.get('status', 'pending')
        cur.execute(
            f"""SELECT k.id, k.user_id, u.email, u.username, k.level, k.status,
                       k.full_name, k.birth_date, k.passport_number,
                       k.doc_passport_url, k.doc_selfie_url, k.doc_address_url,
                       k.reject_reason, k.created_at
                FROM {SCHEMA}.kyc_submissions k
                JOIN {SCHEMA}.users u ON u.id=k.user_id
                WHERE k.status=%s ORDER BY k.created_at ASC""",
            (status_filter,)
        )
        rows = cur.fetchall()
        result = [{
            'id': r[0], 'user_id': r[1], 'email': r[2], 'username': r[3],
            'level': r[4], 'status': r[5], 'full_name': r[6],
            'birth_date': r[7].isoformat() if r[7] else None,
            'passport_number': r[8],
            'doc_passport_url': r[9], 'doc_selfie_url': r[10], 'doc_address_url': r[11],
            'reject_reason': r[12], 'created_at': r[13].isoformat(),
        } for r in rows]
        conn.close()
        return resp(200, {'submissions': result, 'total': len(result)})

    # PUT ?action=approve — одобрить KYC
    if action == 'approve' and method == 'PUT' and is_admin:
        sub_id  = body.get('submission_id')
        note    = body.get('note', '')
        cur.execute(
            f"SELECT user_id, level, status FROM {SCHEMA}.kyc_submissions WHERE id=%s", (sub_id,)
        )
        sub = cur.fetchone()
        if not sub:
            conn.close()
            return resp(404, {'error': 'Заявка не найдена'})
        target_uid, level, old_status = sub

        cur.execute(
            f"UPDATE {SCHEMA}.kyc_submissions SET status='approved', reviewed_by=%s, reviewed_at=NOW(), admin_note=%s, updated_at=NOW() WHERE id=%s",
            (user_id, note, sub_id)
        )
        cur.execute(
            f"UPDATE {SCHEMA}.users SET kyc_status='approved', kyc_level=%s, full_name=k.full_name, birth_date=k.birth_date "
            f"FROM {SCHEMA}.kyc_submissions k WHERE {SCHEMA}.users.id=%s AND k.id=%s",
            (level, target_uid, sub_id)
        )
        # Уведомление
        cur.execute(
            f"INSERT INTO {SCHEMA}.notifications (user_id, type, title, body) VALUES (%s,'kyc_approved','Верификация одобрена','Ваш аккаунт прошёл KYC Level %s. Лимиты на вывод увеличены.')",
            (target_uid, level)
        )
        audit(cur, user_id, 'kyc.approve', 'kyc', sub_id, {'status': old_status}, {'status': 'approved'})
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    # PUT ?action=reject — отклонить KYC
    if action == 'reject' and method == 'PUT' and is_admin:
        sub_id = body.get('submission_id')
        reason = body.get('reason', 'Документы не соответствуют требованиям')
        cur.execute(
            f"SELECT user_id, status FROM {SCHEMA}.kyc_submissions WHERE id=%s", (sub_id,)
        )
        sub = cur.fetchone()
        if not sub:
            conn.close()
            return resp(404, {'error': 'Заявка не найдена'})
        target_uid, old_status = sub
        cur.execute(
            f"UPDATE {SCHEMA}.kyc_submissions SET status='rejected', reviewed_by=%s, reviewed_at=NOW(), reject_reason=%s, updated_at=NOW() WHERE id=%s",
            (user_id, reason, sub_id)
        )
        cur.execute(
            f"UPDATE {SCHEMA}.users SET kyc_status='rejected' WHERE id=%s", (target_uid,)
        )
        cur.execute(
            f"INSERT INTO {SCHEMA}.notifications (user_id, type, title, body) VALUES (%s,'kyc_rejected','Верификация отклонена',%s)",
            (target_uid, f'Причина: {reason}. Вы можете подать заявку повторно.')
        )
        audit(cur, user_id, 'kyc.reject', 'kyc', sub_id, {'status': old_status}, {'status': 'rejected', 'reason': reason})
        conn.commit()
        conn.close()
        return resp(200, {'ok': True})

    conn.close()
    return resp(404, {'error': 'Not found'})
