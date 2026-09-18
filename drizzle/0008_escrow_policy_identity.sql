-- Escrow bounty ids restart when a new contract is deployed. Scope the D1
-- uniqueness check by contract policy so archived V3/V4 rows cannot block V5
-- ids that are valid on the new escrow address.
DROP INDEX IF EXISTS bounties_escrow_bounty_id;
CREATE UNIQUE INDEX IF NOT EXISTS bounties_escrow_policy_id
  ON bounties(fee_policy_version, escrow_bounty_id)
  WHERE escrow_bounty_id IS NOT NULL;
