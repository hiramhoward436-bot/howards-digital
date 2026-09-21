-- Phase 1 UI foundation: per-section widget size (S/M/L) for the flexible
-- dashboard grid. Existing sections default to M (medium).
ALTER TABLE sections ADD COLUMN size TEXT NOT NULL DEFAULT 'M';
