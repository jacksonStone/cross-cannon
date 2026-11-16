# Google login and account synchronization

The Rust server handles Google OIDC, browser sessions, native-app consent,
reading progress and personal study. Reading without an account stays available.
Only Google's identity scopes (`openid`, `email`, `profile`) are requested; no
email delivery service, password flow or native Google SDK is needed.

## Configure the existing Google web client

Register the exact authorized redirect URI for each environment:

```text
https://www.crosscanon.com/api/auth/callback/google
http://127.0.0.1:3005/api/auth/callback/google
```

Use the same local hostname in the browser and configured origin. The production
web client can also serve native sign-in: the native app opens the system browser,
Google returns to the web callback, and explicit consent returns a one-use ticket
to `crosscanon://login-complete`. That app link is not a Google redirect URI and
contains no Google token or persistent session credential. See
[Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect)
for provider configuration.

Keep these values in the server environment, outside source and browser bundles:

```text
GOOGLE_CLIENT_ID=<existing OAuth web client ID>
GOOGLE_CLIENT_SECRET=<existing OAuth web client secret>
CROSS_CANON_ACCOUNT_ORIGIN=https://www.crosscanon.com
ACCOUNTS_DATABASE_PATH=/home/ubuntu/.workspace-deploy/shared/cross-cannon/accounts/accounts.db
```

`BETTER_AUTH_URL` remains an alias for the canonical origin so existing environment
configuration continues to work. `BETTER_AUTH_SECRET` is not used by the Rust
runtime. Existing credentials can remain in `/home/ubuntu/.cross-canon-auth.env`
with mode 0600 and its existing `20-auth.conf` systemd EnvironmentFile drop-in;
they do not need to move into a shared environment file. A custom existing
`ACCOUNTS_DATABASE_PATH` is relocated intact by the release transition, with an
old-path symlink. SQLite opens the canonical path so sidecars use the dedicated
writable directory.

For local development, configure the origin as `http://127.0.0.1:3005` and omit
`ACCOUNTS_DATABASE_PATH` to use `storage/accounts.db`.

## Explicit account database setup

Normal startup, build, verification and deployment never initialize or migrate
a database. For an explicitly requested local account setup:

```bash
npm run update-db:accounts
```

That off-server convenience command compiles/runs the Rust server's explicit
initializer with `CROSS_CANNON_UPDATE_DB=1`. On production, use the installed
binary with the intended path; Node and npm are not needed:

```bash
CROSS_CANNON_UPDATE_DB=1 /home/ubuntu/cross-cannon/bin/cross-cannon \
  --init-accounts /home/ubuntu/.workspace-deploy/shared/cross-cannon/accounts/accounts.db
```

Run initialization as the service owner and load the production environment when
needed. The initializer operates only on the named accounts database; it never
opens Scripture/search indexes. Existing account IDs, provider associations,
progress revisions, study records and native-session hashes retain their schema.
An unconfigured server serves reading normally. Invalid account configuration or
missing schema fails closed rather than creating a database during a request.

## Browser sessions

The server validates the Google ID token's signature, issuer, audience, expiry
and nonce after the state/proof and PKCE exchange. It stores an opaque browser
session as a hash and discards provider tokens rather than maintaining an OAuth
token vault. Account matching follows the provider identity; email addresses do
not silently link unrelated accounts.

Browser sessions use opaque HttpOnly cookies and hashed server records. Legacy
Better Auth cookies require fresh sign-in; account IDs, Reader Locations and study
remain available. Native sessions retain their hash/expiry/revocation protocol. Account APIs, OAuth callbacks
and account/consent documents return private/no-store responses and bypass the
offline reader cache.

## Native iOS and macOS login

Open Reader tools (⋮) → Account and choose Continue with Google. Sign in in the
system browser, approve the named app, and return to the reader. iOS opens the
full default browser; macOS uses ASWebAuthenticationSession. Distributed apps
register the `crosscanon` URL scheme and accept a callback only for their own
pending request. No additional Google client ID or secret belongs in the app.

A request lasts ten minutes and has a public ID plus a private 256-bit device
proof. Browser approval requires a same-origin authenticated session and issues
a one-use return ticket. The app must present both the ticket and its private
proof to redeem a 30-day native session atomically. Approval-page links alone
cannot mint a session. SQLite stores hashes of proofs, tickets and native session
tokens. Native sign-out revokes only that credential; the browser session stays
independent. iOS/macOS store credentials in Keychain; other desktop platforms
retain their existing in-memory credential behavior until a platform adapter is
implemented.

## Progress, study and offline state

The shared Rust reader owns account reconciliation on browser, iOS and macOS.
Each account has separate local progress/study queues; guest locations remain
separate. Reader Links take priority over restored locations. Remote progress
updates change resume targets without moving an actively read passage. A return
refresh may restore a newer location only when local reading has not changed and
no unsynchronized changes, conflict or playing audio prevents it.

Progress writes use a per-Collection compare-and-swap revision; study writes use
per-item revisions and account-change checks. Deleted study items remain as
revisioned tombstones so an offline device cannot resurrect them. Offline edits,
sign-out and later reconnection retain the same shared client reconciliation.
Favorites and reader settings stay local. See [personal study](personal-study.md).

## Storage and recovery

The unified systemd service can write only the dedicated accounts directory.
Search indexes and other runtime artifacts remain read-only. Initial release
activation stops both previous services before moving the existing account
SQLite main file and any WAL/SHM/journal together. The old location links to the
new files; a failed activation restores account files before restarting the prior
services. Archives never include account/search databases or live storage.

Keep consistent account backups off-server and test restoration. Use SQLite's
online backup API or stop all writers before copying the main file and sidecars;
a copy of only a live `.db` can omit committed WAL data. The old
`BETTER_AUTH_SECRET` is not a dependency of new Rust sessions.

## Verification

`npm run verify` runs Rust account/OIDC/native handoff/progress/study tests,
production-shape anonymous document/API checks and a temporary-account browser
journey. Tests must not use production account data. `npm run verify:offline` exercises reading and local study through
the actual browser app. Native client tests use:

```bash
scripts/rust.sh test --locked -p cross-canon-desktop -- --test-threads=1
```

Before release, finish a real Google callback in two browser profiles/devices,
verify shared progress and study, sign out, and complete the native system-browser
consent/app-link return. Mocked token/provider tests cannot prove the external
Google account configuration or operating system app-link registration.
