CREATE TABLE IF NOT EXISTS reader_progress (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  corpus TEXT NOT NULL CHECK(corpus IN ('scripture', 'fathers', 'classics')),
  location TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY (user_id, corpus)
);

-- Only hashes of app-held secrets are persisted. Approval expires in 10 minutes;
-- redemption deletes the request atomically so it cannot mint another session.
CREATE TABLE IF NOT EXISTS native_login (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  ticket_hash TEXT,
  expires_at INTEGER NOT NULL,
  last_poll INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS native_session (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
