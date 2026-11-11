#!/usr/bin/env python3
"""Download a commit-specific public CI artifact; no Mac Docker or CI secrets."""
import hashlib
import io
import pathlib
import re
import sys
import tarfile
import time
import urllib.error
import urllib.request
import importlib.util

revision, destination = sys.argv[1:3]
wait = sys.argv[3:] == ['--wait']
deadline = time.monotonic() + 2400
if not re.fullmatch(r'[a-f0-9]{40}', revision):
    raise SystemExit('Expected a full Git commit SHA for the hosted release')
origin = 'https://github.com/jacksonStone/cross-cannon/releases/download/rust-api-' + revision
name = 'r-cross-cannon-linux-amd64.tar.gz'


def download(filename):
    while True:
        try:
            request = urllib.request.Request(origin + '/' + filename, headers={'User-Agent': 'cross-cannon-release'})
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            if not wait or time.monotonic() >= deadline:
                raise SystemExit('Hosted Rust release is not ready for ' + revision +
                                 '. Check https://github.com/jacksonStone/cross-cannon/actions')
            print('Waiting for hosted Rust build '+revision[:12]+'...', file=sys.stderr, flush=True)
            time.sleep(30)


payload = download(name)
expected = download(name + '.sha256').decode().split()[0]
if not re.fullmatch(r'[a-f0-9]{64}', expected) or hashlib.sha256(payload).hexdigest() != expected:
    raise SystemExit('Downloaded release archive failed checksum verification')
root = pathlib.Path(destination)
root.mkdir(parents=True, exist_ok=False)
files = {'target/release/r-cross-cannon', 'rust/deploy/r-cross-cannon.service', 'BUILD-INFO', 'SHA256SUMS'}
with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
    members = archive.getmembers()
    if len(members) != len(files) or {item.name for item in members} != files or not all(item.isfile() for item in members):
        raise SystemExit('Unexpected hosted release contents')
    # Exact regular-file allowlist works on macOS Python 3.9 as well as Linux.
    for member in members:
        target = root / member.name
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.extractfile(member) as source:
            target.write_bytes(source.read())
        target.chmod(0o755 if member.name.startswith('target/') else 0o644)
spec = importlib.util.spec_from_file_location('rust_artifact', pathlib.Path(__file__).with_name('validate-rust-api-artifact.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
validator.validate(root, revision)
print('Downloaded and verified hosted Rust release ' + revision)
