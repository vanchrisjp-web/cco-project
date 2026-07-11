-- A single entry can have several physical sub-components (main area, a
-- recess, a column cut-out), each potentially illustrated by its own
-- detail drawing rather than sharing just the entry's one overview image.
ALTER TABLE backup_entry_components ADD COLUMN image_r2_key TEXT;
ALTER TABLE backup_entry_components ADD COLUMN image_filename TEXT;
