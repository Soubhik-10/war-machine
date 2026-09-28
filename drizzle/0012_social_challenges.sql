-- Free social challenges deliberately live outside accounts, payments, and
-- escrow. Browser client IDs are stored only as SHA-256 hashes.
ALTER TABLE friendly_challenges ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE friendly_challenges ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friendly_challenges ADD COLUMN updated INTEGER;

UPDATE friendly_challenges SET updated=created WHERE updated IS NULL;

CREATE INDEX IF NOT EXISTS idx_friendly_challenges_state
  ON friendly_challenges(status, expires, created DESC);

-- The listing remains the invite. This row is the immutable, server-verified
-- match record created once another browser accepts it.
CREATE TABLE IF NOT EXISTS friendly_match_runs (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE REFERENCES friendly_challenges(id),
  challenger_hash TEXT NOT NULL,
  challenger_name TEXT NOT NULL,
  challenger_blueprint TEXT NOT NULL,
  defender_hash TEXT NOT NULL,
  defender_name TEXT NOT NULL,
  defender_blueprint TEXT NOT NULL,
  rated INTEGER NOT NULL DEFAULT 0,
  rated_effective INTEGER NOT NULL DEFAULT 0,
  rating_suppressed_reason TEXT,
  status TEXT NOT NULL,
  engine_hash TEXT NOT NULL,
  arena TEXT NOT NULL,
  rules TEXT NOT NULL,
  objective TEXT NOT NULL,
  seed INTEGER NOT NULL,
  swap_spawns INTEGER NOT NULL,
  result_json TEXT,
  replay_json TEXT,
  rating_json TEXT,
  error TEXT,
  created INTEGER NOT NULL,
  accepted INTEGER NOT NULL,
  completed INTEGER,
  updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friendly_match_runs_status
  ON friendly_match_runs(status, updated DESC);
CREATE INDEX IF NOT EXISTS idx_friendly_match_runs_pair
  ON friendly_match_runs(challenger_hash, defender_hash, completed DESC);
CREATE INDEX IF NOT EXISTS idx_friendly_match_runs_defender
  ON friendly_match_runs(defender_hash, completed DESC);

CREATE TABLE IF NOT EXISTS friendly_challenge_declines (
  challenge_id TEXT NOT NULL REFERENCES friendly_challenges(id) ON DELETE CASCADE,
  actor_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, actor_hash)
);

-- Ratings are scoped so a global board and a season board can be computed
-- from the same verified result without exposing browser identifiers.
CREATE TABLE IF NOT EXISTS friendly_ratings (
  player_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  display_name TEXT NOT NULL,
  rating REAL NOT NULL,
  matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL,
  PRIMARY KEY (player_hash, scope)
);

CREATE INDEX IF NOT EXISTS idx_friendly_ratings_board
  ON friendly_ratings(scope, rating DESC, matches DESC, updated ASC);

-- One event per player and scope makes recovery after a Worker retry safe.
CREATE TABLE IF NOT EXISTS friendly_rating_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES friendly_match_runs(id),
  player_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  display_name TEXT NOT NULL,
  rating_before REAL NOT NULL,
  rating_after REAL NOT NULL,
  rating_delta REAL NOT NULL,
  result REAL NOT NULL,
  season TEXT NOT NULL,
  arena TEXT NOT NULL,
  machine_class TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(match_id, player_hash, scope)
);

CREATE INDEX IF NOT EXISTS idx_friendly_rating_events_filter
  ON friendly_rating_events(scope, arena, machine_class, created DESC);
