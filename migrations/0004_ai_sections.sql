-- Quick Launch + AI launcher gadgets (Muse Handoff items 5-9).
-- These run once, only on dashboards that don't have them yet, so any
-- user customization (rename/hide/remove/reorder) is never overwritten.
-- The new cards take positions 0-3 near the top; existing sections keep
-- their relative order, shifted down.

UPDATE sections SET position = position + 4
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-quicklaunch');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-quicklaunch', 'quicklaunch', 'Quick Launch', 1, 0, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-quicklaunch');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-chatgpt', 'chatgpt', 'ChatGPT', 1, 1, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-chatgpt');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-claude', 'claude', 'Claude', 1, 2, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-claude');

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT 'sec-grok', 'grok', 'Grok', 1, 3, '{}'
WHERE NOT EXISTS (SELECT 1 FROM sections WHERE id = 'sec-grok');
