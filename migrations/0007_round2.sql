-- Round 2 UI polish (2026-09-21).
-- 1. Remove the duplicate sports section (sec-d5aeb03279d2) — only when the
--    real one (sec-sports) exists, so this is a no-op if either was removed.
-- 2. Create the day_cache table backing GET /api/today (populated later by a
--    scheduled job from the user's iPhone calendar; empty = honest empty state).
-- 3. Convert Quick Launch (scroll-to-section buttons) into Quick Links:
--    user-managed external bookmarks, seeded empty.
-- 4. Seed the "My Day" widget pinned at position 0, shifting everything else down.

DELETE FROM sections WHERE id = 'sec-d5aeb03279d2'
  AND EXISTS (SELECT 1 FROM sections WHERE id = 'sec-sports');

CREATE TABLE IF NOT EXISTS day_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  date TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE sections
SET type = 'quicklinks',
    title = 'Quick Links',
    settings = '{"links":[]}',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'sec-quicklaunch' AND type = 'quicklaunch';

UPDATE sections SET position = position + 1
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE type = 'myday');

INSERT INTO sections (id, type, title, enabled, position, size, settings)
SELECT 'sec-myday', 'myday', 'My Day', 1, 0, 'L', '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE type = 'myday');
