-- Tempo mainnet bounties use exact pathUSD base units (6 decimals) stored as text.
-- Existing demo rows remain readable; mainnet queries require the *_units columns.
ALTER TABLE accounts ADD COLUMN payout_address TEXT;
ALTER TABLE accounts ADD COLUMN entry_cap_units TEXT;
ALTER TABLE accounts ADD COLUMN daily_cap_units TEXT;

ALTER TABLE bounties ADD COLUMN entry_units TEXT;
ALTER TABLE bounties ADD COLUMN reward_units TEXT;
ALTER TABLE bounties ADD COLUMN reserve_units TEXT;
ALTER TABLE bounties ADD COLUMN platform_fee_bps INTEGER NOT NULL DEFAULT 250;
ALTER TABLE bounties ADD COLUMN fee_policy_version TEXT NOT NULL DEFAULT 'demo-v1';
ALTER TABLE bounties ADD COLUMN platform_recipient TEXT;

CREATE TABLE IF NOT EXISTS identities (
  scheme TEXT NOT NULL,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  account TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (scheme, chain, address)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);

CREATE TABLE IF NOT EXISTS wallet_challenges (
  id TEXT PRIMARY KEY,
  message_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_challenges_expiry ON wallet_challenges(expires);

CREATE TABLE IF NOT EXISTS payment_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_holds (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  bounty TEXT NOT NULL,
  request_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  body TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_ref TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_holds_active ON payment_holds(account, bounty, status, expires);
CREATE UNIQUE INDEX IF NOT EXISTS payment_holds_request ON payment_holds(account, request_key, digest, purpose, status);

CREATE TABLE IF NOT EXISTS financial_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account TEXT NOT NULL,
  ref TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_ref TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE(kind, ref)
);
CREATE INDEX IF NOT EXISTS financial_operations_queue ON financial_operations(status, created);
