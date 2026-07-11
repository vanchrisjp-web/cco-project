-- The original reference BV AWAL sheet carries a "Volume Awal" column per
-- entry — the field-measured/VAR-recorded volume, shown next to the
-- computed Volume Terpasang so a live "Deviasi Volume" (= Terpasang - Awal)
-- can flag mismatches. This app has no separate VAR sheet to pull that
-- value from automatically, so it's entered once per entry, optionally.
ALTER TABLE backup_entries ADD COLUMN volume_awal REAL;
