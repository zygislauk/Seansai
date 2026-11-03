-- Migration 6: Marijampolė and Gargždai are no longer covered, so nothing refreshes or shows these
-- two cinemas. Their movies stay until the daily cleanup, 30 days after their last screening date.

DELETE FROM screenings WHERE source_id IN ('spindulys', 'minija');
DELETE FROM sources WHERE id IN ('spindulys', 'minija');
