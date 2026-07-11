-- backup_entry_components was missing its own `sat` column entirely --
-- the unit of measure entered per component was silently dropped before
-- ever reaching the database (never persisted, never exported). Caught
-- by the AI QA pass correctly flagging "Sat=undefined" on real test data.
ALTER TABLE backup_entry_components ADD COLUMN sat TEXT;
