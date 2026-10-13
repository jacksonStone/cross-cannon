# Optional Google login and reader sync

Status: Planning complete; implementation not started\
Recorded: 2026-09-23\
Repository: `/Users/jacksonstone/Desktop/ubuntu_box_software/cross-cannon`

## Start here when home

1. Unlock the Mac. Docker Desktop's engine was unreachable, its CLI startup
   timed out, and computer use could not proceed while the Mac was locked.
2. Ask the agent to open Docker Desktop and run
   `docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`.
   Identify the actual OpenClaw container and its published dashboard address.
   Its name, configuration, health, and browser capabilities are still unknown.
3. Use OpenClaw if it has suitable browser access, or the available computer-use
   tools directly. OpenClaw is a setup convenience, not an application dependency.
   Google account sign-in or MFA may require Jackson's interaction.
4. Configure the Google web client using the checklist below. Record the public
   Client ID; never put passwords, client secrets, or OpenClaw access tokens here.
5. Start with milestone 1, then implement the login slice. Resolve the few product
   choices below before implementing sync. No work has been deployed for this feature.

Copy this into a new session:

> Resume the optional Google login plan in docs/google-login-plan.md. Read
> AGENTS.md first and preserve existing unrelated work. The Mac should now be
> unlocked. Locate the OpenClaw Docker container and use it, if suitable, to help
> configure Google Auth Platform. Then implement the optional login milestones,
> using the plan's proposed defaults after checking the unresolved product choices
> with me. Report any Google steps that need my interaction. Prepare and verify
> the implementation before deployment; this handoff does not itself request deployment.

## Agreed direction and proposed scope

Jackson requested optional Google login, help with the Google setup through an
existing OpenClaw Docker container, and a comprehensive saved plan to resume at
home. Reading and search must continue to work without an account.

The suggested benefit was syncing Reader Location, reader settings, and favorite
Early Christian Works. Jackson accepted the overall direction, but exact sync
and conflict behavior has not been settled. Treat the following as proposed defaults.

| Area | Proposed first release |
| --- | --- |
| Login | Explicit Sign in with Google button inside reader tools; no automatic prompt |
| Anonymous use | Existing reading, search, audio, and offline downloads remain available |
| Reader Location | One saved location per corpus, matching the current model |
| Reader settings | Sync existing theme, type size, spacing, width, and preset |
| Favorites | Sync existing favorite Early Christian Works |
| Search filters | Keep local initially; decide separately whether they should sync |
| Audio | Preserve current behavior; cross-device playback time is out of scope |
| Downloads | Stay on the device; downloaded files and download selections do not sync |
| Other features | No passwords, paid tiers, social profiles, notes, or new bookmark system |

Product choices to settle before the sync milestone:

- Confirm the first-release synced fields above and the public support email.
- Confirm whether first login should offer to import this browser's saved data.
- Confirm the conflict policy below: keep the cloud value on a stale update and
  offer an explicit way to use the device's value.
- Confirm that logging out clears account-specific local data and resumes the
  separate anonymous profile. Explain that pending unsynced edits would be lost
  before clearing them.
- Confirm account deletion UX and the actual backup-retention period before
  publishing privacy copy.

## Google setup checklist

In [Google Auth Platform](https://console.cloud.google.com/auth/overview):

- [ ] Create/select a project for Cross Canon.
- [ ] Set app name to **Cross Canon**, audience to **External**, and support and
  developer contact emails to addresses Jackson monitors.
- [ ] Create a **Web application** OAuth client.
- [ ] Configure the authorized JavaScript origins below.
- [ ] For the proposed popup/JavaScript callback flow, leave redirect URIs empty.
- [ ] Copy the public Client ID ending in `.apps.googleusercontent.com`.
- [ ] Before launch, configure authorized domain `crosscanon.com`, homepage,
  published privacy-policy URL, and any required brand verification.
- [ ] Use only basic identity permissions: `openid`, `email`, `profile`.
- [ ] Review the console's audience/publishing status before opening sign-in to visitors.

Origins for initial setup:

```text
https://www.crosscanon.com
https://crosscanon.com
http://localhost
http://localhost:3005
```

Use `http://localhost:3005` for local Google testing, rather than the repository's
usual `127.0.0.1` address. Existing browser data is origin-specific; switching to
localhost will not automatically carry over data from 127.0.0.1.

The selected Google Identity Services flow needs a public Client ID, not a client
secret. If implementation changes to a server authorization-code flow, revise
the Google configuration and secret-handling plan before proceeding. Separate
development and production clients are a useful follow-up configuration choice.

Sources checked during planning:
[Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[server token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[publishing states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

## Current application and implementation seams

Read [architecture.md](architecture.md), [../README.md](../README.md),
[../CONTEXT.md](../CONTEXT.md), and
[the Reader Location ADR](adr/0001-reader-navigation-restores-reader-location.md).

The application uses Remix 2, React 18, and SQLite/libSQL, deployed as the
`cross-cannon` systemd service on port 3005. No authentication dependency is
currently listed in package.json. Keep this hosting arrangement.

| Existing file | Relevant responsibility |
| --- | --- |
| `app/root.tsx` | App providers and shared rendering |
| `app/features/reader-ui/ReaderControls.tsx` | Reader tools and account entry point |
| `app/features/reader-settings/reader-settings.ts` | Local reader preferences |
| `app/features/reader-position/reader-position.ts` | Version-2 Reader Location and legacy reads |
| `app/features/reader-navigation/useScriptureReaderNavigation.ts` | Scripture navigation and restoration |
| `app/features/early-christian-reader/useEarlyChristianReaderNavigation.ts` | Early Christian navigation |
| `app/features/early-christian-reader/favorite-books.ts` | Existing favorites in localStorage |
| `app/features/search/useSearchFilters.ts` | Existing device-local search filters |
| `public/cross-canon-sw.js` | Offline shell staging and request handling |
| `deploy.sh`, `cross-cannon.service` | Preserved storage and runtime environment |

Suggested new modules: `app/features/account/` for account UI and session state,
`app/features/reader-sync/` for account-scoped persistence and synchronization,
and server-only account/session/database modules behind thin Remix routes.
Use an internal user ID so future identity providers need not change saved data.

## Milestone 1 — Persistence and public-reader foundation

- [ ] Add separate `storage/accounts.db` storage using the existing SQLite/libSQL
  stack; keep it independent of scripture indexing and cache regeneration.
- [ ] Introduce an explicit, versioned account schema migration command, proposed
  name `npm run update-db:accounts`. It must target only the accounts database.
- [ ] Do not run migrations implicitly in normal startup, verify, ship, or deploy.
  Honor the repository's production DB-update guard for explicit maintenance.
- [ ] Add proposed configuration: `GOOGLE_CLIENT_ID`,
  `ACCOUNTS_DATABASE_URL=file:./storage/accounts.db`, and `ACCOUNTS_ENABLED=0|1`.
- [ ] Missing/disabled account configuration leaves the public reader usable.
  An unavailable account database disables account operations gracefully.

Proposed tables:

- `users`: internal ID, Google subject with a unique constraint, minimal display
  information, creation time. Retain email only if the account UI needs it.
- `sessions`: hash of a cryptographically random session token, user ID, expiry,
  creation time. Never store the raw bearer token in logs or the database.
- `reader_locations`: user ID plus corpus, validated Reader Location, revision.
- `reader_settings`: user ID, validated settings, revision.
- `favorite_works`: user ID plus Work ID, favorite state, revision; preserve a
  removal marker so an old offline device cannot resurrect a removed favorite.
- Schema migration metadata and, if needed, bounded mutation-deduplication data.

Completion: a fresh database can be created explicitly; existing public reading
and search work with accounts both disabled and unavailable.

## Milestone 2 — Optional Google login end to end

- [ ] Load Google's sign-in UI when the account panel is opened, using the official
  library and supported browser flow. Handle cancellation and blocked popups.
- [ ] POST the Google credential to a same-origin login endpoint. Verify signature,
  issuer, audience, and expiry with a maintained library. Use Google `sub` as the
  external identity; never trust client-supplied email or user ID as proof.
- [ ] Bind login to the initiating browser with a short-lived nonce/challenge and
  CSRF protection appropriate to the chosen callback transport. Do not assume
  Google's HTML-post CSRF mechanism automatically covers a custom JS fetch.
- [ ] Upsert the user safely, rotate/create the app session, and issue a host-only
  HttpOnly cookie, Secure in production, with an appropriate SameSite policy.
- [ ] Proposed session lifetime: 30 days; enforce expiry on the server. Use bounded
  cleanup for expired sessions. Google tokens are consumed for login, not stored
  as ongoing access credentials.
- [ ] Add account-state and POST logout endpoints. Invalidate the server session
  and clear its cookie on logout. Protect mutations against CSRF and rate-limit login.
- [ ] Keep the current Reader Location and scroll stable when signing in/out.
  Account menus should close on outside taps and support keyboard navigation.

Completion: real Google login, reload, logout, expiration, and anonymous use work
in a browser. The client never receives another user's data by choosing a user ID.

## Milestone 3 — Safe local profiles and offline behavior

The current service worker fetches and stores `/` and `/church-fathers` during
shell staging. Those requests can carry same-origin cookies. Cache Storage also
does not automatically enforce HTTP `no-store` when code explicitly calls put().

- [ ] Keep shared cached page HTML free of account identity and personal state.
  Fetch account data separately through private, `no-store` endpoints.
- [ ] Explicitly exclude account/auth routes from service-worker caching and
  navigation fallbacks; an offline account request must not return a reader page.
- [ ] Audit existing shell generations and make the update path safe for login.
- [ ] Keep the existing anonymous profile separate from account-scoped local
  preferences, Reader Locations, favorites, and pending mutations.
- [ ] On logout/account switch, cancel in-flight synchronization, ignore late
  responses, clear the outgoing account's private local state, and notify other tabs.
- [ ] Never label cached account state as proof of a current authenticated session.
  Offline reading still works; account actions require a valid server session.
- [ ] Handle offline logout honestly: clear local account state immediately and
  record pending server revocation, retrying it before any later sync. An HttpOnly
  server session cannot be revoked by offline JavaScript alone.
- [ ] Define handling for pending edits before logout; offer reconnect-and-sync or
  explicit discard rather than silently losing them.

Completion: account A, logout, and account B never share personal state; cached
reader shells and downloaded public texts remain usable.

## Milestone 4 — Reader sync

Use ordinary HTTP endpoints and a small durable queue; no realtime service is
required for the initial release. Keep local reading responsive during outages.

Proposed rules:

1. Persist locally first, debounce uploads, and coalesce repeated location updates.
   A page-close request is best effort, not the only way edits are saved.
2. Fetch account state after login, on reconnect, and when the app regains focus.
   Derive ownership from the server session, never the request body.
3. Give each mutation an ID and base revision. Apply changes transactionally.
   Retried requests are idempotent; stale writes return a conflict instead of
   blindly overwriting cloud data. Do not trust device clocks to order changes.
4. On first login, offer to import the anonymous profile. Import favorites once;
   initialize absent account values. Existing cloud values win by default where
   legacy local data has no trustworthy revision. Offer an explicit device-value choice.
5. A direct Reader Link takes priority over restored cloud location. A late sync
   response must never jump the user away from an active reading session. Offer
   a resume action when a different cloud location is available.
6. Resolve settings conflicts per field where practical, favorites per Work, and
   Reader Location per corpus. Preserve favorite removals across offline replay.
7. Bind every queue and request to the originating account. If a session expires,
   stop uploading and request sign-in; never replay A's edits under B's session.
8. Reuse the existing Reader Location shape and validation. Never sync raw scroll
   offsets or change chapter identity based on scroll pixels.

- [ ] Validate payload size, known settings, corpus, Chapter/Passage IDs, and Work IDs.
- [ ] Add a restrained saved/pending/sign-in-needed status to the account panel.
- [ ] Bound queue growth, retries, and server request rates.
- [ ] Test first import, two-device updates, stale offline writes, and account switching.

Completion: save a location/settings/favorite on device A and restore it on B;
offline edits synchronize safely without replacing newer state silently.

## Milestone 5 — Account lifecycle and operations

- [ ] Add account deletion with recent authentication and clear confirmation.
  Delete personal records and revoke all sessions transactionally; prevent stale
  offline queues from recreating deleted account data.
- [ ] Prepare privacy copy that matches actual stored data, Google identity use,
  sync behavior, support contact, deletion, and backup retention.
- [ ] Configure off-server backups for the accounts database using a SQLite-safe
  snapshot method. Test restoration and restrict backup access.
- [ ] Do not log Google credentials, session tokens, or personal saved state.
  Record enough status/error information to troubleshoot login and sync failures.
- [ ] Document config, migration, backup, restore, session revocation, and the
  account-disable switch. Add an account health check without exposing personal data.

## Verification matrix

| Scenario | Expected result |
| --- | --- |
| Accounts disabled, credentials missing, or Google unavailable | Public reading/search still work |
| Valid login, canceled login, expired or wrong-audience token | Session only for valid verified login |
| Forged mutation, expired session, cross-user request | Rejected without modifying another user's data |
| Server restart | Existing unexpired sessions and account data persist |
| Logout, second tab, and account switch | Outgoing private state and stale responses cannot leak |
| First login with existing local values | Clear import behavior without silent cloud overwrite |
| Two devices, offline replay, retries, wrong device clock | Revision-safe and idempotent synchronization |
| Direct Reader Link plus delayed sync | Requested Passage stays in view |
| Account deletion plus an old device reconnecting | Old sessions/queues cannot restore deleted data |
| Service-worker update while signed in | Shared cached HTML contains no personal state |
| Mobile Safari, desktop Chrome, installed PWA | Real sign-in journey tested; failures leave reader usable |

Use focused unit/integration tests for auth validation, sessions, ownership,
conflicts, import, and queue isolation. Browser tests should verify observable
journeys; mocked Google credentials do not replace a real Google smoke test.

Run `npm run verify`, relevant existing unit tests, and `npm run verify:offline`
after changes affecting offline behavior. Capture desktop/mobile previews under
`docs/screenshots/` and share them before deployment if preview is requested.

## Release and rollback

1. Verify locally, complete real Google browser testing, and review screenshots.
2. Confirm production Google origins/branding and publish the privacy page.
3. Prepare runtime config in the service environment; deploy first with accounts
   disabled if the production schema is not ready.
4. Run the explicit accounts migration as its own maintenance step, following
   the production DB-update guard. Test backups before storing real personal data.
5. Use the repository's `npm run ship` release path when deployment is requested.
   Its existing checks cover public behavior; add separate login/sync smoke checks.
6. Enable accounts after schema/configuration are ready, restart as appropriate,
   and test sign-in, persistence, logout, and the public reader on production.
7. Roll back by disabling accounts and returning to a compatible app build.
   Preserve the accounts database; do not overwrite it with development data.

Normal deploys preserve remote `storage/` and reject packages containing storage
data. No scripture database maintenance, scripture cache refresh, or audio rebuild
is needed for this feature. Keep migrations additive where possible so disabling
the feature does not require undoing stored user data.

## Work boundaries and remaining unknowns

- The checkout already contains unrelated tracked and untracked work, including
  continuous audio and a Capacitor plan. Inspect narrowly and preserve it; do not
  stage or commit all files indiscriminately.
- [The Capacitor plan](capacitor-plan.md) is a separate future effort. Browser
  Google login does not by itself implement native app login. Review provider,
  callback, and store requirements when that work is undertaken.
- OpenClaw has not been connected or inspected; no Google project/client has been
  created in this conversation. The only Docker mutation attempted was startup.
- No code, database, production configuration, or account data was changed by this
  planning task. The actual client ID, support email, and consent-screen status remain unknown.
- Earlier estimates were 1–2 focused days for login and roughly 3–5 days including
  basic sync. Treat those as rough estimates; offline conflicts, real-device testing,
  operational setup, and Google review can extend the schedule.

## Suggested skills when resuming

- `implement` when executing a defined milestone; follow repository issue conventions.
- `tdd` if implementing authentication and sync behavior test-first.
- `diagnosing-bugs` for a reproducible Docker, Google callback, or offline failure.
- `code-review` after implementation, before release.
- `render-preview-artifacts` when presenting desktop and mobile screenshots.

Implementation issues, if created, belong under
`.scratch/optional-google-login/issues/`; link back to this plan rather than
maintaining conflicting copies of its requirements.
