-- Free friend challenges are intentionally separate from Tempo wallet sessions
-- and paid escrow operations. Email addresses are never stored here: the
-- Worker stores only an HMAC identity hash and sends the address to the email
-- provider at request time.
CREATE TABLE IF NOT EXISTS email_login_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  return_to TEXT NOT NULL,
  requester_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_login_tokens_email_created
  ON email_login_tokens(email_hash, created DESC);
CREATE INDEX IF NOT EXISTS idx_email_login_tokens_requester_created
  ON email_login_tokens(requester_hash, created DESC);

CREATE TABLE IF NOT EXISTS email_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL REFERENCES accounts(id),
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_sessions_expiry ON email_sessions(expires);

-- A paid account can have many historical attempts in one bounty. Free
-- challenges instead permit one completed hosted run per verified email
-- account, enforced independently so this constraint cannot affect escrow
-- attempts.
CREATE TABLE IF NOT EXISTS free_bounty_entries (
  bounty TEXT NOT NULL REFERENCES bounties(id),
  account TEXT NOT NULL REFERENCES accounts(id),
  attempt TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  created INTEGER NOT NULL,
  PRIMARY KEY (bounty, account)
);
CREATE INDEX IF NOT EXISTS idx_free_bounty_entries_attempt
  ON free_bounty_entries(attempt);
