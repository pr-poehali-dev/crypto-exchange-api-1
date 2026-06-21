-- Таблица реальных крипто-адресов пользователей (по одному на сеть)
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".wallet_addresses (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    network     VARCHAR(20) NOT NULL,   -- BTC, ETH, USDT_TRC20, USDT_ERC20, BNB, TON, SOL
    address     VARCHAR(200) NOT NULL,
    memo        VARCHAR(100),           -- для TON/XRP tag
    qr_data     TEXT,                   -- данные для QR (URI)
    tatum_sub_id VARCHAR(100),          -- ID подписки Tatum для мониторинга
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, network)
);

-- Расширяем deposits: добавляем поля для авто-зачисления
ALTER TABLE "t_p38407894_crypto_exchange_api_".deposits
    ADD COLUMN IF NOT EXISTS wallet_address_id INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".wallet_addresses(id),
    ADD COLUMN IF NOT EXISTS tx_confirmations   INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS auto_confirmed     BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS confirmed_at       TIMESTAMPTZ;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_user ON "t_p38407894_crypto_exchange_api_".wallet_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_addr ON "t_p38407894_crypto_exchange_api_".wallet_addresses(address);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON "t_p38407894_crypto_exchange_api_".deposits(status);
