-- Migration 5: every page asks which cities have movies. Asking that per cinema reads one row with
-- this index, and about 62,000 for all cinemas at 7,000 screenings without it.

CREATE INDEX screenings_by_cinema_and_start ON screenings (cinema_id, starts_at);
