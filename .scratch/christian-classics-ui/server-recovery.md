# Production recovery — 2026-11-11

User scope: restore the server and complete the production release. Phone work
is on hold.

## Recovery progress

- User-triggered EC2 reboot restored SSH and public HTTP 200 at approximately
  20:15 UTC. Both managed services started; the current symlink still pointed to
  the old release, confirming the failed smoke startup had not activated it.
- The previous boot's journal ends shortly after the staged startup. There is
  no retained OOM entry for this incident, so memory exhaustion remains the
  leading explanation, not a confirmed kernel diagnosis.
- Removed inactive Rust releases `20261031T212008Z` and `20261031T220516Z`;
  preserved the old active release, another rollback release, and the new one.
- Added `/swapfile-cross-cannon` (1 GiB, mode 0600), enabled it, and added its
  unique `/etc/fstab` entry. Disk remained approximately 2.5 GiB available.
- Reuploaded the original source archive (the reboot removed `/tmp`), verified
  its SHA256 and every regular source file's bytes against the compiled release.
  An initial comparison stopped before activation because tar compared macOS
  UID/GID with Ubuntu ownership; the content comparison resolved that mismatch.
- Activated `20261111T193616Z` using the verification and rollback block directly
  from `scripts/deploy-rust-api.sh`. Both Work collection searches, Scripture
  gzip bytes, audio range delivery, and Classics chapter counts passed.
- Applied persistent `MemoryMax=1200M` with `systemctl set-property` and recorded
  the same limit in the checked-in service unit. No automatic Rust restarts.
- `VERIFY_PORT=3016 npm run ship`: local verification passed; web upload/build
  reached the remote build, which stopped before activation with inotify
  `ENOSPC: System limit for number of file watchers reached`. Disk was not full.
  The server remained reachable with no Rust restarts. The failed staged web
  release was automatically removed and production stayed on the old web app.
- Raised `fs.inotify.max_user_watches` from 15,217 to 65,536, persisted in
  `/etc/sysctl.d/60-cross-cannon-build.conf`, and resumed `./deploy.sh` followed
  by `npm run verify-prod`. No application inputs changed after local verify.
  The retry built and activated `20261111T202411-3a42cef495` at 20:25 UTC.
- `npm run verify-prod` passed all service, homepage, cross-collection search,
  immutable text/gzip, audio range, and direct Rust edge checks.
- Live desktop/mobile browser checks passed the four-Work library, Work reader,
  and original-commentary dialog with all three commentators and no page errors.
  Six production screenshots are saved in `docs/screenshots/christian-classics/`.
- Both production services are active with zero automatic restarts. Final host
  check: approximately 975 MiB available RAM, 498 MiB unused swap, 1.9 GiB disk
  free, and zero memory-pressure average over the last ten seconds. No further
  reboot or phone action is required for this server release.

## Initial outage observations

- HTTPS times out; SSH connects at TCP level but times out waiting for a banner.
- The host had 1,907 MiB RAM and no swap. The existing Rust process used about
  476 MiB; the new three-collection service measured 848 MiB in isolation locally.
- The remote release compiled successfully at
  `/home/ubuntu/r-cross-cannon/releases/20261111T193616Z`.
- The outage began during its unmanaged smoke startup on port 13006, alongside
  the existing production service. Memory exhaustion is the leading hypothesis;
  kernel logs have not been available to confirm it.
- No successful symlink activation, service restart, or web release was observed.
- The separately provisioned Classics database passed transfer SHA256 and vector
  counts (2,580 Chapters and 165,097 Passages). Existing databases were preserved.
- AWS credentials/CLI are unavailable locally. A console reboot was requested;
  no reboot confirmation has been received.
- Increasing SSH's connection timeout to 120 seconds still ended in a banner
  timeout. HTTPS also failed its 120-second TLS connection window; DNS resolves
  to the expected IP. A second SSH attempt carrying a narrowly scoped cleanup
  (exact staged executable + working directory, excluding systemd MainPID) also
  timed out before authentication. The cleanup did not execute. There is no
  other existing local SSH/mosh session to reuse.

## Recovery sequence after access returns

1. Check `uptime`, `free -m`, `df -h /`, active service status, the current Rust
   symlink, and service MainPID. Prioritize restoring the previous production
   service before publishing the feature.
2. Inspect kernel logs from the previous boot (`sudo journalctl -k -b -1`) for
   OOM evidence, if retained, and the last Rust service logs. Check
   `/tmp/r-cross-cannon-smoke.log` if it survived reboot.
3. If the host recovered without reboot and the staged process persists, identify
   it by exact `/proc/<pid>/exe` and `/proc/<pid>/cwd` pointing to the release
   above. Exclude the systemd MainPID. Terminate only that verified staged PID;
   never use a name-wide `pkill` pattern.
4. Confirm the old production site is healthy and memory/disk capacity is adequate
   before proceeding. Reuse the compiled release if intact, or use the updated
   release helper. It restarts the single managed service before checking health,
   both Work collections, Scripture bytes, audio ranges, and the Classics manifest;
   it restores the prior symlink and restarts on failed verification. Do not start
   another full-library smoke process alongside production.
5. Complete the web release with `VERIFY_PORT=3016 npm run ship`. Watch host memory
   during remote build; do not proceed if capacity remains inadequate.
6. Run `.tmp/capture-production-classics.mjs` only after production is healthy.
   Record the verified release state and any confirmed outage cause here.

The revised release helper passed `bash -n`; its single-managed-instance
activation and successful verification path were exercised on production. The
automatic rollback failure path was not deliberately triggered on the live host.
