-- Explicit account initialization only. Existing account IDs and sync rows keep
-- the established schema; the Rust runtime never creates or migrates databases.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS user (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 emailVerified INTEGER NOT NULL, image TEXT, createdAt DATE NOT NULL, updatedAt DATE NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
 id TEXT PRIMARY KEY NOT NULL, expiresAt DATE NOT NULL, token TEXT NOT NULL UNIQUE,
 createdAt DATE NOT NULL, updatedAt DATE NOT NULL, ipAddress TEXT, userAgent TEXT,
 userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS account (
 id TEXT PRIMARY KEY NOT NULL, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
 userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, accessToken TEXT,
 refreshToken TEXT, idToken TEXT, accessTokenExpiresAt DATE, refreshTokenExpiresAt DATE,
 scope TEXT, password TEXT, createdAt DATE NOT NULL, updatedAt DATE NOT NULL
);
CREATE TABLE IF NOT EXISTS verification (
 id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
 expiresAt DATE NOT NULL, createdAt DATE NOT NULL, updatedAt DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS crosscanon_provider_identity ON account(providerId, accountId);
CREATE INDEX IF NOT EXISTS crosscanon_oauth_state ON verification(identifier);
CREATE TABLE IF NOT EXISTS reader_progress (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 corpus TEXT NOT NULL CHECK(corpus IN ('scripture','fathers','classics')),
 location TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
 PRIMARY KEY(user_id, corpus)
);
CREATE TABLE IF NOT EXISTS native_login (
 id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL,
 user_id TEXT REFERENCES user(id) ON DELETE CASCADE, ticket_hash TEXT,
 expires_at INTEGER NOT NULL, last_poll INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS native_session (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS study_items (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, id TEXT NOT NULL,
 item TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), PRIMARY KEY(user_id,id)
);
