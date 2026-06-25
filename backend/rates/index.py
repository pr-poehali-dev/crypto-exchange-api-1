"""
Котировки USDT/RUB.
Источники (по приоритету):
1. Bybit P2P API — реальные сделки покупки USDT за рубли
2. ЦБ РФ (USD/RUB) × Coinbase (USDT/USD)
Кэш 60 секунд.
"""
import json, urllib.request, time

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

_cache: dict = {'data': None, 'ts': 0}
CACHE_TTL = 60

def _req(url: str, method='GET', data=None, headers=None) -> dict | None:
    h = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return json.loads(r.read())
    except Exception:
        return None

def fetch_bybit() -> dict | None:
    """Bybit P2P — реальные цены покупки USDT за RUB."""
    payload = json.dumps({
        "tokenId": "USDT", "currencyId": "RUB",
        "side": "1", "size": "10", "page": "1",
    }).encode()
    result = _req(
        'https://api2.bybit.com/fiat/otc/item/online',
        method='POST', data=payload,
        headers={'Content-Type': 'application/json'},
    )
    if not result:
        return None
    items = (result.get('result') or {}).get('items') or []
    prices = [float(i['price']) for i in items[:5] if i.get('price')]
    if not prices:
        return None
    avg   = round(sum(prices) / len(prices), 2)
    return {
        'symbol': 'USDT/RUB', 'price': avg,
        'buy': max(prices), 'sell': min(prices),
        'high_24h': max(prices), 'low_24h': min(prices),
        'change_pct': 0.0, 'volume': 0,
        'source': 'Bybit P2P', 'updated_at': int(time.time()),
    }

def fetch_cbr() -> dict | None:
    """ЦБ РФ (USD/RUB) × Coinbase (USDT/USD) — официальный курс."""
    cbr = _req('https://www.cbr-xml-daily.ru/daily_json.js')
    if not cbr:
        return None
    usd_rub = float((cbr.get('Valute') or {}).get('USD', {}).get('Value', 0))
    if usd_rub <= 0:
        return None
    cb = _req('https://api.coinbase.com/v2/prices/USDT-USD/spot')
    usdt_usd = float((cb or {}).get('data', {}).get('amount', 1.0))
    price = round(usdt_usd * usd_rub, 2)
    return {
        'symbol': 'USDT/RUB', 'price': price,
        'buy': round(price * 1.005, 2), 'sell': round(price * 0.995, 2),
        'high_24h': round(price * 1.01, 2), 'low_24h': round(price * 0.99, 2),
        'change_pct': 0.0, 'volume': 0,
        'source': 'ЦБ РФ + Coinbase', 'updated_at': int(time.time()),
    }

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    now = time.time()
    if _cache['data'] and (now - _cache['ts']) < CACHE_TTL:
        return {'statusCode': 200, 'headers': CORS,
                'body': json.dumps({**_cache['data'], 'cached': True})}

    result = fetch_bybit() or fetch_cbr()

    if result:
        _cache['data'] = result
        _cache['ts']   = now
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps(result)}

    if _cache['data']:
        return {'statusCode': 200, 'headers': CORS,
                'body': json.dumps({**_cache['data'], 'stale': True})}

    return {'statusCode': 502, 'headers': CORS,
            'body': json.dumps({'error': 'Котировка временно недоступна'})}
