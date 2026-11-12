"""Validate a prebuilt web artifact, then reuse the shared reversible activation."""
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
import uuid

def activate(archive_name, expected_hash, shared_module_path):
    spec = importlib.util.spec_from_file_location('shared_ship_remote', shared_module_path)
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    archive = Path(archive_name)
    assert shared.sha256(archive) == expected_hash, 'Artifact checksum mismatch'
    with tarfile.open(archive, 'r:gz') as tar:
        manifest = json.load(tar.extractfile('manifest.json'))
    assert manifest['service'] == manifest['spec']['name'] == 'cross-cannon'
    artifact = manifest['artifact']
    assert artifact['platform'] == 'linux/amd64' and artifact['runtime'] == manifest['runtime']
    assert artifact['source_fingerprint'] == manifest['fingerprint']
    assert re.fullmatch(r'\d+\.\d+\.\d+', manifest['runtime'])
    shared.DEPLOY.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (shared.DEPLOY / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = shared.DEPLOY / 'state/cross-cannon.json'
        previous = json.loads(state.read_text()) if state.exists() else None
        assert (previous or {}).get('fingerprint') == manifest['previous'], 'Server release changed; rebuild/retry'
        release = shared.DEPLOY / 'releases/cross-cannon' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-docker-' + uuid.uuid4().hex[:8])
        release.mkdir(parents=True)
        try:
            shared.extract(archive, release)
            actual = {p.relative_to(release).as_posix(): p for p in release.rglob('*') if p.is_file()}
            assert set(actual) == set(artifact['files']) | {'manifest.json'}, 'Unexpected artifact files'
            for name, digest in artifact['files'].items():
                assert shared.sha256(actual[name]) == digest, 'Artifact file mismatch: ' + name
            app = release / 'app'
            node = shared.HOME / f".nvm/versions/node/v{manifest['runtime']}/bin/node"
            assert subprocess.check_output([node, '-p', 'process.platform+"/"+process.arch'], text=True).strip() == 'linux/x64'
            subprocess.run([node, '--check', app / 'build/server/index.js'], check=True)
            subprocess.run([node, '--input-type=module', '-e', "import 'better-auth'; import '@libsql/client';"], cwd=app, check=True)
            shared.activate(release, manifest)
        except shared.RollbackError:
            raise
        except BaseException:
            shutil.rmtree(release)
            raise
        archive.unlink()
        shared.prune_releases('cross-cannon', release, (previous or {}).get('release'))
        print('Docker-built web release activated and verified; no production compilation.', flush=True)

if __name__ == '__main__':
    activate(*sys.argv[1:])
