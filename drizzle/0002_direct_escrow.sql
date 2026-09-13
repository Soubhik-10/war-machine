-- Direct Tempo escrow records. The chain remains the source of funds; D1 only stores
-- the signed-in creator/challenger, immutable game terms and verified transaction links.
ALTER TABLE bounties ADD COLUMN escrow_bounty_id TEXT;
ALTER TABLE bounties ADD COLUMN terms_hash TEXT;
ALTER TABLE bounties ADD COLUMN escrow_create_tx TEXT;
ALTER TABLE bounties ADD COLUMN escrow_attempt_nonce INTEGER;
ALTER TABLE bounties ADD COLUMN escrow_attempt_deadline INTEGER;

ALTER TABLE attempts ADD COLUMN escrow_entry_tx TEXT;
ALTER TABLE attempts ADD COLUMN escrow_settlement_tx TEXT;
ALTER TABLE attempts ADD COLUMN settlement_payload TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bounties_escrow_bounty_id ON bounties(escrow_bounty_id) WHERE escrow_bounty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_holds_direct_intents ON payment_holds(account, purpose, status, created DESC);
