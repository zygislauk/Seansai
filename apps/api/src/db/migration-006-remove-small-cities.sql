-- Migration 6: Marijampolė and Gargždai are no longer covered, so nothing refreshes or shows these
-- two cinemas. Their movies stay until the daily cleanup removes movies with no screenings.

DELETE FROM screenings WHERE source_id IN ('spindulys', 'minija');
DELETE FROM sources WHERE id IN ('spindulys', 'minija');
