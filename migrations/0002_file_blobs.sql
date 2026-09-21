-- File uploads stored as blobs in D1 (free tier, no payment method needed).
-- Keeps metadata in the existing `files` table; blob bytes live here so
-- listing files never has to pull the file data.

CREATE TABLE IF NOT EXISTS file_contents (
  file_id TEXT PRIMARY KEY REFERENCES files(file_id) ON DELETE CASCADE,
  data BLOB NOT NULL
);

-- Share token for the public /f/:token download link (unguessable, single-user site).
ALTER TABLE files ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_share_token ON files(share_token);
