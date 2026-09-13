ALTER TABLE attempts ADD COLUMN match_record TEXT;
CREATE TABLE settlement_jobs (
  attempt TEXT PRIMARY KEY REFERENCES attempts(id), state TEXT NOT NULL DEFAULT 'queued',
  tries INTEGER NOT NULL DEFAULT 0, next_run INTEGER NOT NULL DEFAULT 0,
  lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, tx_hash TEXT, error_code TEXT,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX settlement_jobs_due ON settlement_jobs(state,next_run,lease_until);
CREATE TABLE settlement_control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 1, heartbeat INTEGER NOT NULL DEFAULT 0);
INSERT INTO settlement_control(id) VALUES(1);
CREATE TABLE settlement_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt TEXT, actor TEXT NOT NULL, event TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TRIGGER settlement_audit_no_update BEFORE UPDATE ON settlement_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER settlement_audit_no_delete BEFORE DELETE ON settlement_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER match_record_immutable BEFORE UPDATE OF match_record,blueprint,seed,bounty,account,build_deadline ON attempts
WHEN OLD.match_record IS NOT NULL AND (NEW.match_record IS NOT OLD.match_record OR NEW.blueprint IS NOT OLD.blueprint OR NEW.seed IS NOT OLD.seed OR NEW.bounty IS NOT OLD.bounty OR NEW.account IS NOT OLD.account OR NEW.build_deadline IS NOT OLD.build_deadline)
BEGIN SELECT RAISE(ABORT,'immutable match'); END;
CREATE TRIGGER match_record_no_delete BEFORE DELETE ON attempts WHEN OLD.match_record IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable match'); END;
CREATE TRIGGER settlement_payload_immutable BEFORE UPDATE OF settlement_payload ON attempts
WHEN OLD.match_record IS NOT NULL AND OLD.settlement_payload IS NOT NULL AND (
  json_extract(NEW.settlement_payload,'$.bountyId') IS NOT json_extract(OLD.settlement_payload,'$.bountyId') OR
  json_extract(NEW.settlement_payload,'$.attemptNonce') IS NOT json_extract(OLD.settlement_payload,'$.attemptNonce') OR
  json_extract(NEW.settlement_payload,'$.outcome') IS NOT json_extract(OLD.settlement_payload,'$.outcome') OR
  json_extract(NEW.settlement_payload,'$.resultHash') IS NOT json_extract(OLD.settlement_payload,'$.resultHash') OR
  json_extract(NEW.settlement_payload,'$.validUntil') IS NOT json_extract(OLD.settlement_payload,'$.validUntil'))
BEGIN SELECT RAISE(ABORT,'immutable settlement'); END;
CREATE TRIGGER enqueue_settlement AFTER UPDATE OF match_record ON attempts
WHEN OLD.match_record IS NULL AND NEW.match_record IS NOT NULL
BEGIN
  INSERT INTO settlement_jobs(attempt,created,updated) VALUES(NEW.id,NEW.updated,NEW.updated);
  INSERT INTO settlement_audit(attempt,actor,event,created) VALUES(NEW.id,'api','match-committed',NEW.updated);
END;
CREATE TABLE service_nonces (caller TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(caller,nonce));
CREATE TABLE service_rates (caller TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(caller,minute));
