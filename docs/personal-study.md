# Notes, highlights and synchronization

Notes and highlights are shared across Scripture, Early Christian Works and
Christian Classics. Select a Passage to highlight it or open its notes. A
Passage keeps one optional yellow/green/blue highlight and multiple notes,
newest first. Creation dates stay fixed through edits; older undated notes say
“Earlier note.” Passage text appears once under a disclosure.

Notes support Markdown, inline formatting, bold/italic shortcuts and a rendered
preview. Headings, lists, quotes, code and links render; raw HTML never executes.
Empty untitled drafts are discarded when finished. New notes have no title
field, while existing titles remain stored and visible. Legacy bookmark and
notebook metadata remain compatible with the shared model.

## Local durability and offline reading

Edits save as you type. The shared Rust model prepares one revisioned checkpoint;
failed writes stay pending, keep drafts and show a storage error. Account uploads
wait for local durability.

The browser stores the RON reader/account/study checkpoint in localStorage. A
Web Lock permits one active reader tab per profile/origin; a waiting tab resumes
when the active reader closes. The one-time browser migration imports previous
IndexedDB study and other saved state without deleting the originals. Native
Apple apps use atomic `reader.ron` and `personal-study.ron` checkpoints in their
`Library/Application Support/CrossCanon` directory.

The complete staged browser reader supports offline study across the text
library; native apps bundle all text. Audio downloads are separate. Browser
storage remains subject to quota and eviction. There is no separate emergency
reader or second study writer. See [offline architecture](architecture.md).

Guest study remains on the device, separate from each account. A remembered
account can continue editing offline; a verified session is required to sync.
Signing out does not merge or discard another profile's drafts. Sign in again
after session expiry to resume uploads.

## Synchronization contract

The Rust server stores study in the dedicated accounts SQLite database;
Scripture/search indexes are untouched. `GET /api/study` returns the account ID
and revisioned records. `POST /api/study` sends the expected account ID, item and
base revision. Browser writes require the configured origin; native clients use
revocable bearer credentials. Responses are private and never enter offline
content caches.

Items retain a random ID, kind, stable Reader Location anchor, reference,
excerpt, optional title/Markdown body and creation time, color, legacy notebook
ID and deletion state. Writes use per-item compare-and-swap revisions. Different
items merge independently; competing edits to one item require an explicit
version choice. Tombstones remain so a disconnected device cannot resurrect a
deletion. An acknowledgement advances the base revision without erasing newer
local changes, and stale responses are ignored. Account-change checks prevent
writes into a different signed-in account.

Account schema work is explicit; ordinary builds/releases never apply it.
See [account setup](google-login.md) for initialization, storage and backups.

## Checks

```bash
npm run verify
npm run verify:offline
scripts/rust.sh test --locked -p cross-canon-desktop -- --test-threads=1
```

Verification uses temporary account databases, checks real browser/native
protocols, revision conflicts, account isolation and independent sign-out/
revocation. The full browser journey checks highlights, note formatting,
persistence, legacy import, waiting tabs and offline reload. Native tests cover
queued edits, checkpoint failure/retry, conflicts and phone/desktop layouts.
