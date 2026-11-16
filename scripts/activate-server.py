#!/usr/bin/env python3
"""Activate a prebuilt Rust release with shared storage preservation and rollback."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
import uuid


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def validate_package(archive, expected_hash):
    if not re.fullmatch('[a-f0-9]{64}', expected_hash) or digest(archive) != expected_hash:
        raise ValueError('Artifact checksum mismatch')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate artifact files')
        for member in members:
            path = PurePosixPath(member.name)
            if (not member.isfile() or path.is_absolute() or '..' in path.parts
                    or 'storage' in path.parts or 'node_modules' in path.parts
                    or any(p == '.env' or p.startswith('.env.') for p in path.parts)
                    or re.search(r'\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$', path.name, re.I)
                    or not (member.name in {'manifest.json', 'unit.service', 'app/bin/cross-cannon', 'app/BUILD-INFO'}
                            or member.name.startswith('app/public/') or member.name.startswith('app/scripture-cache/'))):
                raise ValueError('Forbidden runtime package member: ' + member.name)
        manifest = json.load(tar.extractfile('manifest.json'))
        if (manifest['service'] != 'cross-cannon' or manifest['runtime'] != 'rust'
                or manifest['spec'] != {'name': 'cross-cannon', 'kind': 'rust', 'port': 3005}
                or manifest['artifact']['platform'] != 'linux/amd64'
                or manifest['artifact']['runtime'] != 'rust'):
            raise ValueError('Unexpected runtime manifest')
        files = manifest['artifact']['files']
        if set(files) | {'manifest.json'} != set(names):
            raise ValueError('Unexpected runtime file set')
        for name, expected in files.items():
            with tar.extractfile(name) as stream:
                value = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    value.update(block)
            if value.hexdigest() != expected:
                raise ValueError('Artifact file checksum mismatch: ' + name)
        header = tar.extractfile('app/bin/cross-cannon').read(20)
        if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 62:
            raise ValueError('Expected a Linux x86-64 server')
    return manifest


def configured_accounts_path(home):
    # Read only the path setting, never log the environment file or secrets.
    configured = None
    for environment in [home / '.ubuntu-env', home / '.cross-canon-auth.env']:
        if not environment.exists():
            continue
        for line in environment.read_text().splitlines():
            match = re.fullmatch(r'\s*ACCOUNTS_DATABASE_PATH\s*=\s*(.*?)\s*', line)
            if match:
                values = shlex.split(match[1])
                if len(values) != 1:
                    raise ValueError('Expected one explicit ACCOUNTS_DATABASE_PATH')
                configured = Path(values[0])
                if not configured.is_absolute():
                    configured = home / 'cross-cannon' / configured
    return configured


def relocate_accounts(home, deploy):
    """Move closed SQLite files together; retain the old path for rollback releases."""
    directory = deploy / 'shared/cross-cannon/accounts'
    if directory.is_symlink():
        raise ValueError('The dedicated accounts directory must not be a symlink')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    source = configured_accounts_path(home) or home / 'cross-cannon/storage/accounts.db'
    destination = directory / 'accounts.db'
    if source.resolve() == destination.resolve():
        return None
    existing = [suffix for suffix in ['', '-wal', '-shm', '-journal'] if Path(str(source) + suffix).exists()]
    if not existing:
        return None  # Accounts may be unconfigured; this never creates a database.
    if '' not in existing:
        raise ValueError('Orphaned account database sidecars; refusing migration')
    if any(Path(str(destination) + suffix).exists() for suffix in ['', '-wal', '-shm', '-journal']):
        raise ValueError('Both legacy and dedicated account databases exist; refusing to replace either')
    moved = []
    try:
        for suffix in existing:
            old, new = Path(str(source) + suffix), Path(str(destination) + suffix)
            if old.is_symlink() or not old.is_file():
                raise ValueError('Unexpected account database link/file: ' + str(old))
            old.rename(new)
            moved.append((old, new))
            new.chmod(0o600)
            old.symlink_to(new)
    except BaseException:
        for old, new in reversed(moved):
            if old.is_symlink():
                old.unlink()
            new.rename(old)
        raise
    return source, destination


def restore_accounts(migration):
    if migration is None:
        return
    source, destination = migration
    for suffix in ['', '-wal', '-shm', '-journal']:
        old, new = Path(str(source) + suffix), Path(str(destination) + suffix)
        if old.is_symlink() and old.resolve() == new.resolve():
            old.unlink()
        if new.exists():
            if old.exists():
                raise ValueError('Rollback would replace an account file: ' + str(old))
            new.rename(old)


def update_legacy_bridge(shared, system, release, source, name):
    """Retire only our known Node ExecStart override; retain auth environment drop-ins."""
    bridge = system.unit(name).parent / (name + '.service.d/30-rust-resources.conf')
    backup = release / 'previous-resource-bridge.conf'
    if source == release / 'unit.service':
        if bridge.exists():
            shutil.copy2(bridge, backup)
            shared.run(['sudo', 'rm', '-f', '--', bridge])
    elif backup.exists():
        shared.run(['sudo', 'install', '-m', '644', backup, bridge])


def verify_runtime(shared, release):
    def read(path, headers=None):
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3005' + path, headers=headers or {}), timeout=30) as response:
            return response.headers, response.read()
    for _ in range(90):
        try:
            headers, payload = read('/r/api/health')
            health = json.loads(payload)
            if (headers.get('X-Cross-Canon-Runtime') == 'rust' and health.get('runtime') == 'rust'
                    and health.get('accountBackend') is True and health.get('status') == 'ok'):
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise ValueError('Rust server did not become ready')
    pid = shared.run(['systemctl', 'show', 'cross-cannon', '-p', 'MainPID', '--value'], capture=True)
    actual = shared.run(['sudo', 'readlink', '-f', '/proc/' + pid + '/exe'], capture=True)
    if actual != str((release / 'app/bin/cross-cannon').resolve()):
        raise ValueError('The running service is not the packaged Rust executable')
    if shared.run(['systemctl', 'is-active', '--quiet', 'r-cross-cannon'], check=False) == 0:
        raise ValueError('Legacy Rust API service must not run a second Library')
    with urllib.request.urlopen('http://127.0.0.1:3006/r/api/health', timeout=30) as response:
        if json.load(response)['status'] != 'ok':
            raise ValueError('Compatibility listener is unavailable')
    _, shell = read('/')
    if b'id="app-canvas"' not in shell:
        raise ValueError('Reader shell is unavailable')
    headers, account = read('/api/account')
    if 'no-store' not in headers.get('Cache-Control', '') or 'configured' not in json.loads(account):
        raise ValueError('Account endpoint or privacy headers failed')
    for path in ['/account', '/account/native']:
        if not read(path)[1]:
            raise ValueError('Account document unavailable')
    browser = json.loads((release / 'app/public/browser/manifest.json').read_text())
    headers, worker = read('/cross-canon-sw.js')
    if 'no-cache' not in headers.get('Cache-Control', '') or hashlib.sha256(worker).hexdigest() != browser['worker']:
        raise ValueError('Service worker does not match the packaged browser artifact')
    scripture_root = release / 'app/scripture-cache'
    version = json.loads((scripture_root / 'manifest.json').read_text())['version']
    cache = json.loads((scripture_root / (version + '.json')).read_text())
    source = next(p['id'] for p in cache['passages'] if p['reference'].startswith('Genesis 1:'))
    request = urllib.request.Request('http://127.0.0.1:3005/r/api/search',
        data=json.dumps({'sourceId': source, 'corpus': 'scripture', 'books': ['John'], 'limit': 3}).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if len(json.load(response)['results']) != 3:
            raise ValueError('Existing-vector search failed')
    for corpus, author in [('early-christian', 'Clement of Rome'), ('christian-classics', 'Thomas à Kempis')]:
        request = urllib.request.Request('http://127.0.0.1:3005/r/api/search',
            data=json.dumps({'sourceId': source, 'corpus': corpus, 'web': True, 'authors': [author], 'limit': 3}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            hits = json.load(response)['results']
            if len(hits) != 3 or any(hit['author'] != author or not hit['highlightPassage']['text'] for hit in hits):
                raise ValueError('Work search contract failed: ' + corpus)
    headers, compressed = read('/scripture-cache/' + version + '.json', {'Accept-Encoding': 'gzip'})
    if headers.get('Content-Encoding') != 'gzip' or hashlib.sha256(compressed).hexdigest() != digest(scripture_root / (version + '.json.gz')):
        raise ValueError('Compressed Scripture resource mismatch')
    headers, audio = read('/audio/WEBD_AT/01_Genesis_01.mp3', {'Range': 'bytes=0-1023'})
    if len(audio) != 1024 or not headers.get('Content-Range', '').startswith('bytes 0-1023/'):
        raise ValueError('Audio byte-range contract failed')
    # Exercise the existing TLS edge and public compatibility form as well.
    with urllib.request.urlopen('https://www.crosscanon.com/', timeout=30) as response:
        if b'id="app-canvas"' not in response.read():
            raise ValueError('Public reader document failed')
    request = urllib.request.Request('https://www.crosscanon.com/?index', data=urllib.parse.urlencode({
        'intent': 'similar-passage', 'sourcePassageId': source, 'books': 'John', 'matchCount': '5'}).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if len(json.load(response)['results']) != 5:
            raise ValueError('Public compatibility search form failed')
    # No paid embedding request or production write is needed for release health.
    time.sleep(3)
    if (shared.run(['systemctl', 'show', 'cross-cannon', '-p', 'MainPID', '--value'], capture=True) != pid
            or shared.run(['systemctl', 'show', 'cross-cannon', '-p', 'NRestarts', '--value'], capture=True) != '0'):
        raise ValueError('Rust server restarted during verification')


def activate(archive_name, expected_hash, shared_module_path, expected_previous='', *, _shared=None):
    if _shared is None:
        spec = importlib.util.spec_from_file_location('shared_ship_remote', shared_module_path)
        shared = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(shared)
    else:
        shared = _shared
    archive = Path(archive_name)
    manifest = validate_package(archive, expected_hash)
    shared.DEPLOY.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (shared.DEPLOY / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = shared.DEPLOY / 'state/cross-cannon.json'
        previous = json.loads(state.read_text()) if state.exists() else None
        if (previous or {}).get('fingerprint', '') != expected_previous:
            raise ValueError('Server release changed; retry from the current release')
        release = shared.DEPLOY / 'releases/cross-cannon' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-rust-' + uuid.uuid4().hex[:8])
        release.mkdir(parents=True)
        migration = None
        legacy_active = shared.run(['systemctl', 'is-active', '--quiet', 'r-cross-cannon'], check=False) == 0
        old_active = shared.run(['systemctl', 'is-active', '--quiet', 'cross-cannon'], check=False) == 0
        started_activation = False

        class RustSystem(shared.System):
            prepared = False

            def stop(self, name):
                nonlocal migration
                # Never run a second full-library process during health checks.
                shared.run(['sudo', 'systemctl', 'stop', 'r-cross-cannon'], check=False)
                if shared.run(['systemctl', 'is-active', '--quiet', 'r-cross-cannon'], check=False) == 0:
                    raise ValueError('Could not stop the legacy Library process')
                super().stop(name)
                if not self.prepared:
                    migration = relocate_accounts(shared.HOME, shared.DEPLOY)
                    self.prepared = True

            def put_unit(self, source, name):
                update_legacy_bridge(shared, self, release, source, name)
                super().put_unit(source, name)

            def verify(self, _manifest):
                verify_runtime(shared, release)

        try:
            shared.extract(archive, release)
            for name, expected in manifest['artifact']['files'].items():
                if digest(release / name) != expected:
                    raise ValueError('Extracted runtime file mismatch: ' + name)
            binary = release / 'app/bin/cross-cannon'
            binary.chmod(0o755)
            dynamic = subprocess.run(['ldd', str(binary)], check=True, text=True, stdout=subprocess.PIPE).stdout
            if 'not found' in dynamic:
                raise ValueError('Linux runtime shared library missing')
            started_activation = True
            shared.activate(release, manifest, system=RustSystem())
        except BaseException:
            if started_activation:
                # shared.activate restored the prior app/unit first. Stop it
                # briefly before restoring files if accounts were relocated.
                if migration is not None:
                    shared.run(['sudo', 'systemctl', 'stop', 'cross-cannon'], check=False)
                    restore_accounts(migration)
                    if old_active:
                        shared.run(['sudo', 'systemctl', 'start', 'cross-cannon'])
                elif old_active:
                    shared.run(['sudo', 'systemctl', 'start', 'cross-cannon'])
                if legacy_active:
                    shared.run(['sudo', 'systemctl', 'start', 'r-cross-cannon'])
            # Retain the failed release and rollback backups for inspection.
            raise
        shared.run(['sudo', 'systemctl', 'disable', 'r-cross-cannon'], check=False)
        archive.unlink()
        shared.prune_releases('cross-cannon', release, (previous or {}).get('release'))
        print('Rust reader, auth, account and search server activated; no production build or Node runtime.', flush=True)


if __name__ == '__main__':
    activate(*sys.argv[1:])
