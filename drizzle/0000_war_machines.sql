CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  balance INTEGER NOT NULL,
  entry_cap INTEGER,
  daily_cap INTEGER,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bounties (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  blueprint TEXT NOT NULL,
  entry INTEGER NOT NULL,
  reward INTEGER NOT NULL,
  status TEXT NOT NULL,
  listed INTEGER NOT NULL,
  expires INTEGER,
  active_attempt TEXT,
  winner TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bounties_listing ON bounties(listed, status, created DESC);
CREATE INDEX IF NOT EXISTS idx_bounties_owner ON bounties(owner, created DESC);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  bounty TEXT NOT NULL REFERENCES bounties(id),
  account TEXT NOT NULL REFERENCES accounts(id),
  blueprint TEXT NOT NULL,
  seed INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_bounty ON attempts(bounty, created DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_account ON attempts(account, created DESC);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(account, kind, ref)
);

CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account, created DESC);

CREATE TABLE IF NOT EXISTS saved_builds (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  blueprint TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_builds_account ON saved_builds(account, updated DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  account TEXT NOT NULL REFERENCES accounts(id),
  bounty TEXT NOT NULL REFERENCES bounties(id),
  created INTEGER NOT NULL,
  PRIMARY KEY(account, bounty)
);

CREATE TABLE IF NOT EXISTS agent_keys (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_keys_account ON agent_keys(account, created DESC);

CREATE TABLE IF NOT EXISTS idempotency (
  account TEXT NOT NULL REFERENCES accounts(id),
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT NOT NULL,
  ref TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(account, key)
);
