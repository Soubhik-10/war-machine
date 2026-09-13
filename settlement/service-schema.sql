CREATE TABLE service_nonces(caller TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(caller,nonce));
CREATE TABLE service_rates(caller TEXT NOT NULL,minute INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(caller,minute));
CREATE TABLE signer_decisions(match_key TEXT PRIMARY KEY,record_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,signature TEXT,created INTEGER NOT NULL);
CREATE TABLE service_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,attempt TEXT,event TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE notification_state(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL,sent INTEGER NOT NULL);
CREATE TRIGGER decisions_immutable BEFORE UPDATE OF record_hash,payload_hash ON signer_decisions BEGIN SELECT RAISE(ABORT,'immutable decision'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON signer_decisions BEGIN SELECT RAISE(ABORT,'immutable decision'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON service_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON service_audit BEGIN SELECT RAISE(ABORT,'append only'); END;
