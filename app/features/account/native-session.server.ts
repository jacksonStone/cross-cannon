import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAccountsDatabase, PRIVATE_HEADERS } from "./auth.server";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const nonce = () => randomBytes(32).toString("hex");
const LOGIN_LIFETIME = 10 * 60_000;
const SESSION_LIFETIME = 30 * 24 * 60 * 60_000;

export function nativeSession(request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (ccn_[a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  return getAccountsDatabase().prepare(`SELECT user.id, user.name, user.email
    FROM native_session JOIN user ON user.id = native_session.user_id
    WHERE token_hash = ? AND expires_at > ?`).get(hash(token), Date.now()) as
    { id: string; name: string; email: string } | undefined ?? null;
}

export function revokeNativeSession(request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (ccn_[a-f0-9]{64})$/)?.[1];
  if (token) getAccountsDatabase().prepare("DELETE FROM native_session WHERE token_hash = ?").run(hash(token));
}

export function startNativeLogin(database: DatabaseSync, platform: unknown, now = Date.now()) {
  database.prepare("DELETE FROM native_login WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM native_session WHERE expires_at <= ?").run(now);
  if ((database.prepare("SELECT COUNT(*) AS n FROM native_login").get()!.n as number) >= 1000) {
    throw new Response("Try again later", { status: 429, headers: PRIVATE_HEADERS });
  }
  const id = nonce();
  const secret = nonce();
  const label = platform === "ios" ? "Cross Canon for iPhone / iPad" : "Cross Canon for desktop";
  database.prepare(`INSERT INTO native_login (id, secret_hash, code, label, expires_at)
    VALUES (?, ?, '', ?, ?)`).run(id, hash(secret), label, now + LOGIN_LIFETIME);
  return { id, secret, label, expiresAt: now + LOGIN_LIFETIME,
    url: new URL(`/account/native?id=${id}`, process.env.BETTER_AUTH_URL!).href };
}

export function pendingNativeLogin(database: DatabaseSync, id: string, now = Date.now()) {
  return database.prepare("SELECT id, label FROM native_login WHERE id = ? AND expires_at > ?")
    .get(id, now) as { id: string; label: string } | undefined;
}

export function approveNativeLogin(database: DatabaseSync, id: string, userId: string, now = Date.now()) {
  const ticket = nonce();
  const approved = database.prepare(`UPDATE native_login SET user_id = ?, ticket_hash = ?
    WHERE id = ? AND user_id IS NULL AND expires_at > ?`).run(userId, hash(ticket), id, now).changes === 1;
  return approved ? ticket : null;
}

export function pollNativeLogin(database: DatabaseSync, id: string, secret: string, ticket?: string, now = Date.now()) {
  database.exec("BEGIN IMMEDIATE");
  const redeem = () => {
    const login = database.prepare("SELECT * FROM native_login WHERE id = ? AND expires_at > ?")
      .get(id, now);
    if (!login || !timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(login.secret_hash as string))) {
      return { status: "expired" } as const;
    }
    // Browser approval alone cannot mint a session. The one-use ticket must
    // return through the app link on the same device that holds the proof.
    // This replaces the manual pairing code and prevents a remote initiator
    // from obtaining a victim's session by sending them an approval-page link.
    if (login.user_id && !ticket) return { status: "pending" } as const;
    if (login.user_id && (!login.ticket_hash || !timingSafeEqual(Buffer.from(hash(ticket!)), Buffer.from(login.ticket_hash as string)))) {
      return { status: "expired" } as const;
    }
    if ((login.last_poll as number) > now - 1500) return { status: "slow_down" } as const;
    database.prepare("UPDATE native_login SET last_poll = ? WHERE id = ?").run(now, id);
    if (!login.user_id) return { status: "pending" } as const;
    const token = `ccn_${nonce()}`;
    const expiresAt = now + SESSION_LIFETIME;
    database.prepare("INSERT INTO native_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hash(token), login.user_id, expiresAt);
    database.prepare("DELETE FROM native_login WHERE id = ?").run(id);
    return { status: "complete", token, expiresAt } as const;
  };
  try {
    const result = redeem();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
