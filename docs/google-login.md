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
callback only if you also configure `BETTER_AUTH_URL` to use localhost. Request
only the default identity scopes: `openid`, `email`, and `profile`. Google's
basic-identity exception permits these scopes without a test-user allowlist,
even in Testing. Use an External audience for public Google accounts, and set
the publishing status to In production when releasing publicly. Adding other
scopes changes Google's testing/verification requirements; this app needs none.

Official references: [Google OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect)
and [Better Auth Google integration](https://better-auth.com/docs/authentication/google).
See [Google's audience and basic-identity exception](https://support.google.com/cloud/answer/15549945).

## iPhone and desktop: no additional GCP clients

The native apps use the existing server login through the system browser. Google
still returns to `https://www.crosscanon.com/api/auth/callback/google`; its web
client secret never ships in an app. There is no iOS client ID, desktop client
ID, Firebase project, Google SDK, or additional Google redirect to configure for
this flow. `crosscanon://login-complete` is a local app return link, **not** a
Google redirect URI. It carries a short-lived return ticket and cannot sign in an app without its
matching private proof.

Phone-friendly GCP check, in the existing project:

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients?project=gen-lang-client-0153949172).
   Keep the existing Web application client and the production redirect above.
   No changes are needed if the website already signs in successfully.
2. Open [Audience](https://console.cloud.google.com/auth/audience?project=gen-lang-client-0153949172).
   Use External for public access. For a public release, select Publish app if
   its status still says Testing. Basic Google sign-in has the exception described
   above; you do not need to add test users for the current identity-only scopes.
3. [Data access](https://console.cloud.google.com/auth/scopes?project=gen-lang-client-0153949172)
   should contain only identity scopes (`openid`, email, profile). Do not add
   Gmail, Drive, or other API permissions for progress sync.

In the app, open Reader tools (⋮) → Account and tap Continue with Google.
The browser opens directly. Sign in if needed, tap Continue as your account,
and return to Cross Canon. No pairing codes or manual comparison are shown.
The native account sheet keeps sign-in, close, and back-to-reading controls
visible on small phones; reading details expand only when requested.

The server issues a 10-minute request with separate public ID and 256-bit
private device proof. Explicit confirmation requires a same-origin,
authenticated browser session. Confirmation sends a one-use return ticket to
`crosscanon://login-complete`; the native app accepts it only for its own
pending request. Only that return ticket together with the app-held proof can
atomically redeem a 30-day device session. Sending an approval-page link to
another device cannot give a remote initiator a session. Proofs, return tickets
and session tokens are stored only as hashes in SQLite. Return links contain
only the short-lived ticket, never Google tokens or the persistent device
session. The old schema's `code` column is retained empty for compatibility;
there are no manual codes in the flow.

Both distributed apps must register the `crosscanon` scheme; macOS also forwards
its system authentication session's callback to the existing native link
handler. A return URL alone cannot sign in an app without its matching pending
request and private proof.

iOS opens the full default browser (Safari by default); macOS uses
ASWebAuthenticationSession. Google account choices stalled inside the iOS
system authentication sheet during device testing, while the same login worked
in regular Safari. Both apps store their device session in Keychain with a
ThisDeviceOnly accessibility policy. The currently distributed
desktop app is macOS. Other desktop builds need platform URL-scheme and single-instance callback
routing before distributing native login. Their current credential adapter
retains a session in memory only; their Account screen states that a
restart requires sign-in. No plaintext token fallback is used.

Each account has its own durable offline progress queue. Guest locations are
preserved separately and imported only on request. Sync uses the same server
revisions as the website. A remote update changes resume targets without moving
an open reader. Conflicts offer Use other device / Keep this device. Sign-out
immediately returns to guest reading; if offline, revocation is queued and
retried on reconnection, including after restart. Sessions expire after 30 days.

After deploying this feature, explicitly run `npm run update-db:accounts` with
the existing production service environment. This adds `native_login` and
`native_session` without modifying existing accounts or Reader Locations.
Normal deploys do not migrate databases automatically.
Release the backend, run that explicit migration, and verify the native-login
endpoint before distributing updated native apps.

## Server configuration

Set these in the web server's environment, keeping the secret out of source
control and browser bundles:

Production keeps these settings in `/home/ubuntu/.cross-canon-auth.env` with
owner-only permissions (`0600`). The `cross-cannon` systemd service loads this
file through `/etc/systemd/system/cross-cannon.service.d/20-auth.conf`, after the
shared environment file, so Google credentials are isolated to this app. Keep
the existing `BETTER_AUTH_SECRET` when updating Google credentials.

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
- This implementation syncs Reader Locations across web, native iOS and macOS.
  Notes, favorites and reader settings sync are future features.

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
capture desktop/mobile screenshots under `docs/screenshots/`, including native
browser approval and native-session-to-web sync. Native tests run with
`scripts/rust.sh test --locked -p cross-canon-desktop -- --test-threads=1` and
cover location compatibility, account isolation, offline conflicts, in-flight
reading updates, authenticated transport, and compact Account UI.

Neither test contacts Google or completes a real Google login. After configuring
credentials, complete Google consent in two browser profiles/devices, read in
one, resume in the other, and verify sign-out before enabling production login.

## Build away from production

`npm run ship:docker` snapshots the deployment inputs, installs and tests with
Node 24.13.0 in a local `linux/amd64` Docker container, and exports
only the production runtime. It refuses remote Docker engines. No credentials,
databases, or live storage enter the build context or release artifact.
The runtime exports as one tar stream and unpacks in an OS temporary directory;
this avoids slow file-provider coordination when the checkout is on a synced
Desktop. Temporary runtime files are removed after packaging.

The production runtime remains Node 26.13.0 from `.nvmrc`, checked on Ubuntu
before activation. The builder uses Node 24 because the Node 26 x64 container
misparses fractional numbers under the local Docker Desktop emulator, causing
npm's packument cache initialization to fail. The Dockerfile checks fractional
arithmetic before installing anything, and artifact metadata records both Node
versions. `--build-node-version` can select another exact builder patch version.

The artifact omits identical copies of public files from `build/client`; the
existing web server serves those files from `public/`. A container smoke check
verifies the pruned runtime before upload. File hashes, runtime architecture,
source identity, and the previous release receipt are checked before activation.
The shared deploy lock, health checks, rollback, storage preservation, and
release retention are reused. Production does not install or compile anything.
