-- Optional friendly identity for completed bounty attempts. The wallet remains
-- the authority; names and address visibility are presentation metadata only.
ALTER TABLE attempts ADD COLUMN participant_name TEXT;
ALTER TABLE attempts ADD COLUMN show_address INTEGER NOT NULL DEFAULT 0;

