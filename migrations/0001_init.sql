-- A session groups one BQ PDF's parse result with all BackupEntry rows
-- that will be exported together into one BV AWAL workbook.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bq_pdf_r2_key TEXT,
  bq_pdf_filename TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row of the BQ's hierarchical work-item list, per Section 4.3's
-- catalogued irregularities (numbering resets per category, so `path`
-- carries the full breadcrumb, not just the bare item number).
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,          -- e.g. "V.1 PEKERJAAN LANTAI > 2. Pasang Lantai Keramik ... (R. Locker)"
  description TEXT NOT NULL,
  unit TEXT,                   -- SAT, e.g. m2, m3, kg, unit, titik, ls
  source_category TEXT,        -- e.g. "V PEKERJAAN ARSITEKTUR"
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- The 14 predefined RUMUS types from Section 4.2. Seeded once via
-- migrations/0002_seed_formulas.sql, not user-editable in Milestone 1.
CREATE TABLE formula_templates (
  id TEXT PRIMARY KEY,
  rumus TEXT NOT NULL UNIQUE,        -- e.g. "P x L x U"
  label TEXT NOT NULL,               -- human-readable meaning
  dimension_fields TEXT NOT NULL,    -- JSON array, e.g. ["panjang","lebar","unit"]
  expression TEXT NOT NULL           -- internal arithmetic key used by lib/formulas.ts
);

-- One accumulated submission: a drawing image matched to a work item.
-- Volume Terpasang = SUM of this entry's component rows (see below).
CREATE TABLE backup_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id),
  image_r2_key TEXT NOT NULL,
  image_filename TEXT,
  notasi TEXT,                       -- free-text legend, Section 4.1 "Notasi" column
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One Volume Bagian sub-row per entry. A single entry can have several
-- of these summed together (main area + recess - column cutout), each
-- with its own formula and dimensions, per Section 4.2.
CREATE TABLE backup_entry_components (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES backup_entries(id) ON DELETE CASCADE,
  formula_template_id TEXT NOT NULL REFERENCES formula_templates(id),
  panjang REAL,
  lebar REAL,
  tinggi REAL,
  berat REAL,
  koefisien REAL,
  unit REAL,                         -- the "Unit" quantity multiplier column
  sign INTEGER NOT NULL DEFAULT 1,   -- 1 = add, -1 = subtract (e.g. column cutout)
  ket TEXT,                          -- e.g. "door recess", "column cut-out"
  same_as_entry_id TEXT REFERENCES backup_entries(id), -- for "sama dengan <item>" cross-ref
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_work_items_session ON work_items(session_id);
CREATE INDEX idx_entries_session ON backup_entries(session_id);
CREATE INDEX idx_components_entry ON backup_entry_components(entry_id);
