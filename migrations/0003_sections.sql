-- Dashboard section framework (Phase 1: Project HD dashboard).
-- Sections are user-customizable dashboard cards: type, title, visibility,
-- position, and per-section settings stored as a JSON object.

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sections_position ON sections(position);

-- Seed default dashboard layout (only if the table is empty, so user
-- customizations are never overwritten by re-running migrations).
INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-greeting', 'greeting', 'Welcome', 1, 0, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections);

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-search', 'search', 'Search', 1, 1, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-search');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-weather', 'weather', 'Weather', 1, 2,
  '{"location":"Lexington, KY","lat":38.04,"lon":-84.50,"useGeolocation":true}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-weather');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-sports', 'sports', 'My Teams', 1, 3,
  '{"teams":[{"teamId":"96","sport":"football/college-football","label":"Kentucky Football"},{"teamId":"96","sport":"basketball/mens-college-basketball","label":"Kentucky Basketball"}]}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-sports');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-links', 'links', 'Kentucky Sports Radio', 1, 4,
  '{"links":[{"title":"Kentucky Sports Radio","subtitle":"Listen live","url":"https://790louisville.iheart.com/"},{"title":"KSR Podcast","subtitle":"Past shows on demand","url":"https://www.iheart.com/podcast/484-ksr-kentucky-sports-radio-28233652/"},{"title":"Aaron Torres Sports Podcast","subtitle":"Episodes & clips","url":"https://american-podcasts.com/podcast/aaron-torres-sports-podcast"}]}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-links');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-files', 'files', 'Files', 1, 5, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-files');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-projects', 'projects', 'Projects', 1, 6, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-projects');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-youtube', 'youtube', 'YouTube', 1, 7, '{"channels":[]}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-youtube');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-notes', 'notes', 'Notes', 1, 8, '{"content":""}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-notes');
