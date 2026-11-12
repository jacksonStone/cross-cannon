CREATE TABLE IF NOT EXISTS reader_progress (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  corpus TEXT NOT NULL CHECK(corpus IN ('scripture', 'fathers', 'classics')),
  location TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY (user_id, corpus)
);
