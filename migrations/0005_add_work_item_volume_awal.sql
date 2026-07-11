-- The Breakdown's own VOLUME/VOL AWAL column (Section 4.3) is parsed
-- alongside SAT but was previously discarded — surfaced here so a work
-- item's own contract volume can pre-fill Volume Awal when building an
-- entry, instead of always requiring manual entry.
ALTER TABLE work_items ADD COLUMN volume_awal REAL;
