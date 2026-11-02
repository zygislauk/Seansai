-- Migration 5: plain 2D and 3D are no longer shown as formats. Rows that still held them would fail
-- the web client's response check until the next refresh. The CHECK in migration 1 stays permissive,
-- as tightening it would mean rebuilding the table and nothing writes those values any more.

UPDATE screenings SET format = NULL WHERE format IN ('2D', '3D');
