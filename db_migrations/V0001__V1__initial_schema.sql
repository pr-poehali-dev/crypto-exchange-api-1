
CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  kyc_status TEXT DEFAULT 'none',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".user_balances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
  currency TEXT NOT NULL DEFAULT 'USDT',
  available NUMERIC(28, 8) DEFAULT 0,
  locked NUMERIC(28, 8) DEFAULT 0,
  UNIQUE(user_id, currency)
);

CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".crypto_wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, network)
);

CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".deposits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  tx_hash TEXT,
  amount NUMERIC(28, 8),
  currency TEXT DEFAULT 'USDT',
  status TEXT DEFAULT 'pending',
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount NUMERIC(28, 8) NOT NULL,
  fee NUMERIC(28, 8) DEFAULT 0,
  status TEXT DEFAULT 'completed',
  ref_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "t_p38407894_crypto_exchange_api_".auth_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "t_p38407894_crypto_exchange_api_".users(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposits_user ON "t_p38407894_crypto_exchange_api_".deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON "t_p38407894_crypto_exchange_api_".transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON "t_p38407894_crypto_exchange_api_".auth_sessions(token);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON "t_p38407894_crypto_exchange_api_".crypto_wallets(user_id);
