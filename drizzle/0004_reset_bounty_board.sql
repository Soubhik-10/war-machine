-- One-time reset before switching to Bounty Escrow v2. Accounts, wallet identities,
-- and saved builds remain intact. Old direct-escrow records point at the retired
-- contract and must not be shown as playable on the new bounty board.
DELETE FROM bookmarks;
DELETE FROM attempts;
DELETE FROM payment_holds;
DELETE FROM financial_operations;
DELETE FROM bounties;
DELETE FROM idempotency
WHERE kind = 'create'
   OR kind LIKE 'enter:%'
   OR kind LIKE 'deploy:%'
   OR kind LIKE 'forfeit:%';
