-- ═══════════════════════════════════════════════════════════════════════════
-- V6: Три слоя кошельков, sweep-механизм, compliance AML, multisig очередь
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Hot Pool кошельки (по одному на сеть/валюту) ──────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".hot_pool_wallets (
    id            SERIAL PRIMARY KEY,
    network       VARCHAR(20)   NOT NULL,
    currency      VARCHAR(10)   NOT NULL,
    address       VARCHAR(200)  NOT NULL,
    is_active     BOOLEAN       DEFAULT TRUE,
    balance_onchain NUMERIC(28,8) DEFAULT 0,
    balance_target_pct NUMERIC(5,2) DEFAULT 15.0,
    last_synced   TIMESTAMPTZ,
    note          TEXT,
    created_at    TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(network, currency)
);

-- ── 2. Cold Vault кошельки (мультиподпись 3-из-5) ────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".cold_vault_wallets (
    id            SERIAL PRIMARY KEY,
    network       VARCHAR(20)   NOT NULL,
    currency      VARCHAR(10)   NOT NULL,
    address       VARCHAR(200)  NOT NULL,
    multisig_n    SMALLINT      DEFAULT 3,
    multisig_m    SMALLINT      DEFAULT 5,
    is_active     BOOLEAN       DEFAULT TRUE,
    balance_onchain NUMERIC(28,8) DEFAULT 0,
    note          TEXT,
    created_at    TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(network, currency)
);

-- ── 3. Sweep лог (Deposit Address → Hot Pool) ────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".sweep_log (
    id            BIGSERIAL     PRIMARY KEY,
    user_id       INTEGER       NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    wallet_address_id INTEGER   REFERENCES "t_p38407894_crypto_exchange_api_".wallet_addresses(id),
    network       VARCHAR(20)   NOT NULL,
    currency      VARCHAR(10)   NOT NULL,
    from_address  VARCHAR(200)  NOT NULL,
    to_address    VARCHAR(200)  NOT NULL,
    amount        NUMERIC(28,8) NOT NULL,
    fee           NUMERIC(28,8) DEFAULT 0,
    tx_hash       VARCHAR(200),
    status        VARCHAR(20)   DEFAULT 'pending',
    confirmations INTEGER       DEFAULT 0,
    triggered_by  VARCHAR(50)   DEFAULT 'auto',
    created_at    TIMESTAMPTZ   DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sweep_user   ON "t_p38407894_crypto_exchange_api_".sweep_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sweep_status ON "t_p38407894_crypto_exchange_api_".sweep_log(status);
CREATE INDEX IF NOT EXISTS idx_sweep_addr   ON "t_p38407894_crypto_exchange_api_".sweep_log(from_address);

-- ── 4. Расширяем withdrawals полями AML и мультиподписи ──────────────────────
ALTER TABLE "t_p38407894_crypto_exchange_api_".withdrawals
    ADD COLUMN IF NOT EXISTS aml_status       VARCHAR(20) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS aml_risk_score   NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS aml_note         TEXT,
    ADD COLUMN IF NOT EXISTS aml_reviewed_by  INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    ADD COLUMN IF NOT EXISTS aml_reviewed_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finance_signed_by INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    ADD COLUMN IF NOT EXISTS finance_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finance_note     TEXT,
    ADD COLUMN IF NOT EXISTS hot_pool_id      INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".hot_pool_wallets(id),
    ADD COLUMN IF NOT EXISTS batch_id         VARCHAR(50),
    ADD COLUMN IF NOT EXISTS requires_cold_vault BOOLEAN DEFAULT FALSE;

-- ── 5. Compliance: чёрный/белый/наблюдательный список адресов ────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".compliance_address_flags (
    id            SERIAL        PRIMARY KEY,
    address       VARCHAR(200)  NOT NULL,
    network       VARCHAR(20)   NOT NULL,
    flag_type     VARCHAR(20)   NOT NULL,
    risk_score    NUMERIC(5,2)  DEFAULT 0,
    reason        TEXT,
    source        VARCHAR(100)  DEFAULT 'manual',
    flagged_by    INTEGER       REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(address, network, flag_type)
);

CREATE INDEX IF NOT EXISTS idx_caf_address ON "t_p38407894_crypto_exchange_api_".compliance_address_flags(address, network);

-- ── 6. Расширяем users compliance-полями ─────────────────────────────────────
ALTER TABLE "t_p38407894_crypto_exchange_api_".users
    ADD COLUMN IF NOT EXISTS aml_status            VARCHAR(20) DEFAULT 'clear',
    ADD COLUMN IF NOT EXISTS aml_risk_score        NUMERIC(5,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deposit_suspended     BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deposit_suspend_reason TEXT,
    ADD COLUMN IF NOT EXISTS withdrawal_whitelist_only BOOLEAN DEFAULT FALSE;

-- ── 7. Whitelist адресов вывода пользователей ────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".withdrawal_address_whitelist (
    id            SERIAL        PRIMARY KEY,
    user_id       INTEGER       NOT NULL REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    network       VARCHAR(20)   NOT NULL,
    address       VARCHAR(200)  NOT NULL,
    label         VARCHAR(100),
    status        VARCHAR(20)   DEFAULT 'pending_compliance',
    approved_by   INTEGER       REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    approved_at   TIMESTAMPTZ,
    reject_reason TEXT,
    created_at    TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(user_id, network, address)
);

-- ── 8. Матрица разрешений ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".role_permissions (
    id            SERIAL        PRIMARY KEY,
    role          VARCHAR(50)   NOT NULL,
    action        VARCHAR(100)  NOT NULL,
    target_type   VARCHAR(50),
    is_allowed    BOOLEAN       DEFAULT FALSE,
    UNIQUE(role, action, target_type)
);

INSERT INTO "t_p38407894_crypto_exchange_api_".role_permissions (role, action, target_type, is_allowed) VALUES
('support',    'view_deposit_address',   'deposit',    TRUE),
('support',    'view_user_balance',      'internal',   TRUE),
('support',    'suspend_deposits',       'deposit',    TRUE),
('support',    'create_refund_request',  'deposit',    TRUE),
('support',    'initiate_withdrawal',    'hot_pool',   FALSE),
('support',    'view_hot_pool_key',      'hot_pool',   FALSE),
('compliance', 'freeze_account',         'user',       TRUE),
('compliance', 'aml_flag_address',       'deposit',    TRUE),
('compliance', 'approve_withdraw_addr',  'whitelist',  TRUE),
('compliance', 'view_sweep_log',         'sweep',      TRUE),
('compliance', 'sign_withdrawal',        'hot_pool',   FALSE),
('compliance', 'unfreeze_alone',         'user',       FALSE),
('finance',    'view_hot_pool_balance',  'hot_pool',   TRUE),
('finance',    'sign_withdrawal_batch',  'hot_pool',   TRUE),
('finance',    'rebalance_hot_cold',     'cold_vault', TRUE),
('finance',    'view_withdrawal_queue',  'hot_pool',   TRUE),
('finance',    'edit_user_balance',      'internal',   FALSE),
('finance',    'sign_alone_large',       'hot_pool',   FALSE),
('admin',      'delist_pair',            'trading',    TRUE),
('admin',      'update_fees',            'trading',    TRUE),
('admin',      'sign_withdrawal',        'hot_pool',   FALSE),
('superadmin', 'emergency_shutdown',     'platform',   TRUE),
('superadmin', 'migrate_hot_pool',       'hot_pool',   TRUE),
('superadmin', 'view_all_logs',          'platform',   TRUE)
ON CONFLICT DO NOTHING;

-- ── 9. Запросы на подпитку Hot Pool из Cold Vault ────────────────────────────
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".vault_transfer_requests (
    id             SERIAL       PRIMARY KEY,
    from_type      VARCHAR(20)  NOT NULL DEFAULT 'cold_vault',
    to_type        VARCHAR(20)  NOT NULL DEFAULT 'hot_pool',
    network        VARCHAR(20)  NOT NULL,
    currency       VARCHAR(10)  NOT NULL,
    amount         NUMERIC(28,8) NOT NULL,
    status         VARCHAR(20)  DEFAULT 'pending',
    requested_by   INTEGER      REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
    finance_sig    TEXT,
    compliance_sig TEXT,
    superadmin_sig TEXT,
    sigs_required  SMALLINT     DEFAULT 2,
    tx_hash        VARCHAR(200),
    note           TEXT,
    created_at     TIMESTAMPTZ  DEFAULT NOW(),
    completed_at   TIMESTAMPTZ
);
