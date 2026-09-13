-- One-time reset for Bounty Escrow v3. V2 bounty rows reference the retired
-- escrow flow and must not appear in the V3 board or block new challenge runs.
-- This changes only the app database; it never changes chain transactions.
DELETE FROM bookmarks
WHERE bounty IN (
  SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
);

DELETE FROM settlement_jobs
WHERE attempt IN (
  SELECT id FROM attempts
  WHERE bounty IN (
    SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
  )
);

DELETE FROM payment_holds
WHERE bounty IN (
  SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
);

DELETE FROM financial_operations
WHERE ref IN (
  SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
)
OR ref IN (
  SELECT id FROM attempts
  WHERE bounty IN (
    SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
  )
);

DELETE FROM idempotency
WHERE ref IN (
  SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
)
OR ref IN (
  SELECT id FROM attempts
  WHERE bounty IN (
    SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
  )
);

DELETE FROM attempts
WHERE bounty IN (
  SELECT id FROM bounties WHERE fee_policy_version = 'pathusd-direct-escrow-v2'
);

DELETE FROM bounties
WHERE fee_policy_version = 'pathusd-direct-escrow-v2';