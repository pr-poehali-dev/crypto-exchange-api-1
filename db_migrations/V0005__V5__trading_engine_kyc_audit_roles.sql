-- ═══════════════════════════════════════════════════════════════
-- V5: Торговый движок, KYC, ролевая модель, аудит
-- ═══════════════════════════════════════════════════════════════

-- Расширяем таблицу users
ALTER TABLE "t_p38407894_crypto_exchange_api_".users
    ADD COLUMN IF NOT EXISTS phone          VARCHAR(20),
    ADD COLUMN IF NOT EXISTS full_name      VARCHAR(200),
    ADD COLUMN IF NOT EXISTS birth_date     DATE,
    ADD COLUMN IF NOT EXISTS is_frozen      BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS freeze_reason  TEXT,
    ADD COLUMN IF NOT EXISTS kyc_level      SMALLINT DEFAULT 0,  -- 0,1,2,3
    ADD COLUMN IF NOT EXISTS antiphishing_code VARCHAR(32),
    ADD COLUMN IF NOT EXISTS totp_secret    VARCHAR(64),         -- 2FA TOTP
    ADD COLUMN IF NOT EXISTS totp_enabled   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS role           VARCHAR(30) DEFAULT 'user'; -- user, support, compliance, finance, devops, admin, superadmin

-- Расширяем auth_sessions
ALTER TABLE "t_p38407894_crypto_exchange_api_".auth_sessions
    ADD COLUMN IF NOT EXISTS ip_address  VARCHAR(45),
    ADD COLUMN IF NOT EXISTS user_agent  TEXT,
    ADD COLUMN IF NOT EXISTS last_seen   TIMESTAMPTZ DEFAULT NOW();

-- ──────────────────────────────────────────────────────────────
-- Торговые пары
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".trading_pairs (
    id           SERIAL PRIMARY KEY,
    symbol       VARCHAR(20) UNIQUE NOT NULL,  -- BTC/USDT
    base         VARCHAR(10) NOT NULL,          -- BTC
    quote        VARCHAR(10) NOT NULL,          -- USDT
    is_active    BOOLEAN DEFAULT TRUE,
    maker_fee    NUMERIC(8,6) DEFAULT 0.001,    -- 0.1%
    taker_fee    NUMERIC(8,6) DEFAULT 0.002,    -- 0.2%
    min_qty      NUMERIC(28,8) DEFAULT 0.00001,
    tick_size    NUMERIC(28,8) DEFAULT 0.01,    -- шаг цены
    last_price   NUMERIC(28,8) DEFAULT 0,
    volume_24h   NUMERIC(28,8) DEFAULT 0,
    high_24h     NUMERIC(28,8) DEFAULT 0,
    low_24h      NUMERIC(28,8) DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Дефолтные пары
INSERT INTO "t_p38407894_crypto_exchange_api_".trading_pairs (symbol, base, quote, maker_fee, taker_fee, min_qty, tick_size)
VALUES
    ('BTC/USDT',  'BTC',  'USDT', 0.001, 0.002, 0.00001,  0.01),
    ('ETH/USDT',  'ETH',  'USDT', 0.001, 0.002, 0.0001,   0.01),
    ('BNB/USDT',  'BNB',  'USDT', 0.001, 0.002, 0.001,    0.001),
    ('SOL/USDT',  'SOL',  'USDT', 0.001, 0.002, 0.01,     0.001),
    ('TRX/USDT',  'TRX',  'USDT', 0.001, 0.002, 1.0,      0.0001),
    ('BTC/ETH',   'BTC',  'ETH',  0.001, 0.002, 0.00001,  0.0001)
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- Ордера
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".orders (
    id           BIGSERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    pair_id      INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".trading_pairs(id),
    symbol       VARCHAR(20) NOT NULL,
    side         VARCHAR(4)  NOT NULL,    -- buy / sell
    type         VARCHAR(12) NOT NULL,    -- limit / market / stop_loss / take_profit
    status       VARCHAR(12) NOT NULL DEFAULT 'open', -- open / partial / filled / cancelled
    price        NUMERIC(28,8),          -- NULL для market
    stop_price   NUMERIC(28,8),          -- для stop_loss / take_profit
    qty          NUMERIC(28,8) NOT NULL, -- заявленное количество
    filled_qty   NUMERIC(28,8) DEFAULT 0,
    quote_qty    NUMERIC(28,8) DEFAULT 0, -- сумма в quote (для market buy)
    avg_price    NUMERIC(28,8) DEFAULT 0,
    fee          NUMERIC(28,8) DEFAULT 0,
    fee_currency VARCHAR(10),
    locked_amount NUMERIC(28,8) DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    filled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_user   ON "t_p38407894_crypto_exchange_api_".orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_pair   ON "t_p38407894_crypto_exchange_api_".orders(pair_id, status, side, price);
CREATE INDEX IF NOT EXISTS idx_orders_status ON "t_p38407894_crypto_exchange_api_".orders(status);

-- ──────────────────────────────────────────────────────────────
-- Сделки (trades) — результат матчинга
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".trades (
    id           BIGSERIAL PRIMARY KEY,
    symbol       VARCHAR(20) NOT NULL,
    pair_id      INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".trading_pairs(id),
    buy_order_id BIGINT REFERENCES "t_p38407894_crypto_exchange_api_".orders(id),
    sell_order_id BIGINT REFERENCES "t_p38407894_crypto_exchange_api_".orders(id),
    buy_user_id  INTEGER,
    sell_user_id INTEGER,
    price        NUMERIC(28,8) NOT NULL,
    qty          NUMERIC(28,8) NOT NULL,
    total        NUMERIC(28,8) NOT NULL,  -- price * qty
    buy_fee      NUMERIC(28,8) DEFAULT 0,
    sell_fee     NUMERIC(28,8) DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON "t_p38407894_crypto_exchange_api_".trades(symbol, created_at DESC);

-- ──────────────────────────────────────────────────────────────
-- OHLCV свечи (агрегируются из trades)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".candles (
    id         BIGSERIAL PRIMARY KEY,
    symbol     VARCHAR(20) NOT NULL,
    interval   VARCHAR(5)  NOT NULL,  -- 1m, 5m, 15m, 1h, 4h, 1d
    open_time  TIMESTAMPTZ NOT NULL,
    open       NUMERIC(28,8) NOT NULL,
    high       NUMERIC(28,8) NOT NULL,
    low        NUMERIC(28,8) NOT NULL,
    close      NUMERIC(28,8) NOT NULL,
    volume     NUMERIC(28,8) DEFAULT 0,
    UNIQUE(symbol, interval, open_time)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup ON "t_p38407894_crypto_exchange_api_".candles(symbol, interval, open_time DESC);

-- ──────────────────────────────────────────────────────────────
-- KYC заявки
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".kyc_submissions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    level           SMALLINT NOT NULL DEFAULT 2,
    status          VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, needs_info
    full_name       VARCHAR(200),
    birth_date      DATE,
    passport_number VARCHAR(50),
    passport_issued_by TEXT,
    passport_issued_date DATE,
    address_text    TEXT,
    -- S3 ссылки на документы
    doc_passport_url    TEXT,
    doc_selfie_url      TEXT,
    doc_address_url     TEXT,
    -- Модерация
    reviewed_by     INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    reviewed_at     TIMESTAMPTZ,
    reject_reason   TEXT,
    admin_note      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_user   ON "t_p38407894_crypto_exchange_api_".kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON "t_p38407894_crypto_exchange_api_".kyc_submissions(status);

-- ──────────────────────────────────────────────────────────────
-- Лог аудита действий администраторов (Immutable)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".audit_log (
    id          BIGSERIAL PRIMARY KEY,
    admin_id    INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    admin_name  VARCHAR(100),
    action      VARCHAR(100) NOT NULL,   -- kyc.approve, user.freeze, withdrawal.approve...
    entity_type VARCHAR(50),             -- user, kyc, withdrawal, order, pair
    entity_id   VARCHAR(50),
    old_value   JSONB,
    new_value   JSONB,
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin  ON "t_p38407894_crypto_exchange_api_".audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON "t_p38407894_crypto_exchange_api_".audit_log(action, created_at DESC);

-- ──────────────────────────────────────────────────────────────
-- Уведомления пользователей
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    type       VARCHAR(50) NOT NULL,  -- order_filled, deposit_confirmed, kyc_approved...
    title      TEXT NOT NULL,
    body       TEXT,
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON "t_p38407894_crypto_exchange_api_".notifications(user_id, is_read);
