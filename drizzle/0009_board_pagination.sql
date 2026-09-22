-- Bounded board reads filter current public rows by policy/listing/status and
-- page them by status, update time and id.  These additive indexes also keep
-- private owner/history and batched entrant entitlement lookups bounded.
CREATE INDEX IF NOT EXISTS idx_bounties_board_page
  ON bounties(fee_policy_version, listed, status, updated DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bounties_owner_updated
  ON bounties(owner, updated DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_account_bounty
  ON attempts(account, bounty);
