# Google login and reading progress

Cross Canon uses Better Auth with Google as its only login provider. Reading
without an account remains available. There are no password, email-code, or
magic-link flows, and no email delivery service is needed.

## Configure Google

Create a **Web application** OAuth client in Google Cloud Console, configure
the Google Auth Platform branding/audience screens, and register these exact
authorized redirect URIs:

```text
https://www.crosscanon.com/api/auth/callback/google
http://127.0.0.1:3005/api/auth/callback/google
```

Use the same hostname when opening local development. Add a separate localhost
callback only if you also configure `BETTER_AUTH_URL` to use localhost. While
Google's audience is in Testing, add the Google accounts that will test login;
publish the audience before opening sign-in to everyone. Request only the
default identity scopes: `openid`, `email`, and `profile`.

Official references: [Google OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect)
and [Better Auth Google integration](https://better-auth.com/docs/authentication/google).

## Server configuration

Set these in the web server's environment, keeping the secret out of source
control and browser bundles:

```text
GOOGLE_CLIENT_ID=<OAuth web client ID>
GOOGLE_CLIENT_SECRET=<OAuth web client secret>
BETTER_AUTH_SECRET=<at least 32 random characters>
BETTER_AUTH_URL=https://www.crosscanon.com
ACCOUNTS_DATABASE_PATH=/home/ubuntu/cross-cannon/storage/accounts.db
```

Generate the authentication secret with `openssl rand -base64 32`. For local
development, use `BETTER_AUTH_URL=http://127.0.0.1:3005` and omit
`ACCOUNTS_DATABASE_PATH` to use `storage/accounts.db`.

Initialize the separate account database with the server environment loaded:

```bash
npm run update-db:accounts
```

This explicit command creates/updates Better Auth's account/session tables and
the reader-progress table. It never touches scripture/search databases. Normal
builds, verification, deployment, and server startup do not run this migration.
On first production enablement, run the command in the application directory
with the production service's environment, then restart `cross-cannon`.
Subsequent auth dependency upgrades may require rerunning this explicit command.

An unconfigured installation continues to serve the reader normally and shows
sign-in as unavailable on `/account`. Missing schema or invalid configuration
fails closed. Account endpoints and OAuth callbacks use private, non-cacheable
responses and bypass the offline service worker's shell fallback. No personal
account data is embedded in cached reader HTML.

## Reader behavior

- Open reader tools (`⋮`) and choose the account icon to sign in.
- Locations save separately for Scripture, Early Christian Works, and Christian
  Classics. Account locations are isolated from guest locations and other
  accounts in the browser.
- Before-sign-in progress can be imported explicitly from the account page.
- Active reading queues changes locally and syncs after a short delay, when the
  browser reconnects or regains focus, and periodically while open. The simple
  offline Scripture fallback also queues progress for the next connected visit.
- Opening a reader restores the saved account location; an explicit Reader Link
  still takes priority. Remote changes never move an already-open reading view.
- Concurrent/offline writes use server revisions. When two devices disagree,
  the account page asks which location to keep instead of silently overwriting.
- Sign-out revokes the server session and returns to guest reading. Previously
  queued account changes remain isolated on that browser for the same account.
- This implementation syncs Reader Locations. Notes, favorites, reader settings,
  and native iOS/macOS account UI are future features.

## Storage and backups

The account database is writable and independent of the read-only search
indexes. It lives under the existing deploy-preserved `storage/` directory and
must never be included in deploy packages. Back it up off-server with SQLite's
online backup API (or an equivalent consistent backup), including a restore
check. Copying only the live `.db` file can miss committed WAL data. Session
signing and encrypted OAuth tokens depend on `BETTER_AUTH_SECRET`; retain that
secret securely with the operational recovery configuration.

## Verification

`npm run verify` includes account/session/security and conflict tests using a
temporary database and fake Google client credentials. `npm run e2e:accounts`
uses temporary accounts and real server sessions to exercise browser sync and
capture desktop/mobile screenshots under `docs/screenshots/`.

Neither test contacts Google or completes a real Google login. After configuring
credentials, complete Google consent in two browser profiles/devices, read in
one, resume in the other, and verify sign-out before enabling production login.
