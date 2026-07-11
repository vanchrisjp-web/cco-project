-- Not every work item has a drawing/blueprint to attach (e.g. lump-sum
-- "unit"/"ls" items with no plan reference) — image_r2_key was NOT NULL,
-- forcing every entry to have an image. SQLite has no ALTER COLUMN to drop
-- a NOT NULL constraint, so the table is recreated with the same data.
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE backup_entries_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id),
  image_r2_key TEXT,
  image_filename TEXT,
  notasi TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  volume_awal REAL
);

INSERT INTO backup_entries_new
  (id, session_id, work_item_id, image_r2_key, image_filename, notasi, sort_order, created_at, volume_awal)
SELECT id, session_id, work_item_id, image_r2_key, image_filename, notasi, sort_order, created_at, volume_awal
FROM backup_entries;

DROP TABLE backup_entries;
ALTER TABLE backup_entries_new RENAME TO backup_entries;

CREATE INDEX idx_entries_session ON backup_entries(session_id);
