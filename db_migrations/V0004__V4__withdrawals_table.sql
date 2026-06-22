CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".withdrawals (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    network      VARCHAR(20) NOT NULL,
    currency     VARCHAR(10) NOT NULL,
    amount       NUMERIC(28,8) NOT NULL,
    fee          NUMERIC(28,8) NOT NULL DEFAULT 0,
    to_address   VARCHAR(200) NOT NULL,
    memo         VARCHAR(100),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, processing, completed, rejected
    tx_hash      VARCHAR(200),
    tatum_tx_id  VARCHAR(200),
    admin_note   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON "t_p38407894_crypto_exchange_api_".withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON "t_p38407894_crypto_exchange_api_".withdrawals(status);
