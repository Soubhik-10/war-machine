-- Free friendly challenges are intentionally isolated from bounty and payment
-- tables. Their worker cleanup policy removes rows at the 24-hour deadline.
CREATE TABLE IF NOT EXISTS friendly_challenges (
  id TEXT PRIMARY KEY,
  creator_hash TEXT NOT NULL,
  challenger_name TEXT NOT NULL,
  title TEXT NOT NULL,
  blueprint TEXT NOT NULL,
  engine_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friendly_challenges_board
  ON friendly_challenges(expires, created DESC);

CREATE INDEX IF NOT EXISTS idx_friendly_challenges_creator
  ON friendly_challenges(creator_hash, expires);
