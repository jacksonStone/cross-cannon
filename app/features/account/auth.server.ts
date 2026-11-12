import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";

export function accountsDatabasePath() {
  return resolve(process.env.ACCOUNTS_DATABASE_PATH ?? "storage/accounts.db");
}

export function authConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL);
}

export function authOptions(database: DatabaseSync) {
  return {
    appName: "Cross Canon",
    database,
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  };
}

let database: DatabaseSync | undefined;
export function getAccountsDatabase() {
  if (!database) {
    const path = accountsDatabasePath();
    if (!existsSync(path)) throw new Error("Run npm run update-db:accounts before enabling accounts.");
    const connection = new DatabaseSync(path);
    try {
      connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      connection.prepare("SELECT revision FROM reader_progress LIMIT 1").all();
      database = connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }
  return database;
}

type AccountAuth = ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>>;
let auth: AccountAuth | undefined;
export function getAuth() {
  if (!authConfigured()) throw new Error("Google sign-in is not configured.");
  if (!auth) {
    const origin = new URL(process.env.BETTER_AUTH_URL!);
    if (process.env.BETTER_AUTH_SECRET!.length < 32
      || (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) {
      throw new Error("Accounts require a strong secret and an HTTPS base URL (except localhost).");
    }
    auth = betterAuth(authOptions(getAccountsDatabase()));
  }
  return auth!;
}

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(process.env.BETTER_AUTH_URL!).origin) {
    throw new Response("Invalid origin", { status: 403, headers: PRIVATE_HEADERS });
  }
}
