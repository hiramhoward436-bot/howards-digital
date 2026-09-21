-- Single configurable "AI" widget (Master handoff §13, Harm's 2026-09-20 decision).
-- Replaces the three seeded AI launcher cards (ChatGPT / Claude / Grok) with
-- one "AI" widget whose selected services live in the section's settings.
-- Only swaps what actually exists: if all three cards were already removed,
-- no new widget is created. The widget takes the position of the first AI
-- card, so it lands where the launchers used to be, and stays hidden if all
-- three cards were hidden.

INSERT INTO sections (id, type, title, enabled, position, settings)
SELECT
  'sec-ai',
  'ai',
  'AI',
  (SELECT MAX(enabled) FROM sections WHERE type IN ('chatgpt','claude','grok')),
  (SELECT MIN(position) FROM sections WHERE type IN ('chatgpt','claude','grok')),
  '{"services":[{"id":"chatgpt","name":"ChatGPT","url":"https://chatgpt.com"},{"id":"claude","name":"Claude","url":"https://claude.ai"},{"id":"grok","name":"Grok","url":"https://grok.com"}],"defaultId":"chatgpt"}'
WHERE EXISTS (SELECT 1 FROM sections WHERE type IN ('chatgpt','claude','grok'))
  AND NOT EXISTS (SELECT 1 FROM sections WHERE type = 'ai');

DELETE FROM sections WHERE type IN ('chatgpt','claude','grok');
