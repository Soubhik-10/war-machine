-- A direct-escrow entry funds the right to inspect and engineer against the
-- defender. The defender blueprint remains in the bounty row; the attempt
-- records only its private construction deadline until deployment.
ALTER TABLE attempts ADD COLUMN build_deadline INTEGER;
ALTER TABLE attempts ADD COLUMN build_requested_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_attempts_engineering_deadline
  ON attempts(status, build_deadline)
  WHERE status = 'engineering';
