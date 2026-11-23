#!/usr/bin/env python3
"""Build off-server and release one Rust server with its tested browser artifacts."""
import argparse
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
import uuid

from lib.release_inputs import binary_inputs as git_binary_inputs, compiler_inputs as git_compiler_inputs

ROOT = Path(__file__).resolve().parent.parent
ADMIN = ROOT.parent / 'administrative_stuff'


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def compiler_inputs(revision=None):
    return git_compiler_inputs(ROOT, revision)


def binary_inputs(revision=None):
    return git_binary_inputs(ROOT, revision)


@contextmanager
def stage(label):
    start = time.monotonic()
    print(f'==> {label}', flush=True)
    try:
        yield
    finally:
        print(f'    {label}: {time.monotonic() - start:.1f}s', flush=True)


def local_docker_context():
    if os.environ.get('DOCKER_HOST') and not os.environ['DOCKER_HOST'].startswith('unix://'):
        raise ValueError('Remote Docker engines are refused; builds must stay off production.')
    context = subprocess.check_output(['docker', 'context', 'show'], text=True).strip()
    endpoint = subprocess.check_output(['docker', 'context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
    if not endpoint.startswith('unix://'):
        raise ValueError('A local Docker context is required.')
    subprocess.run(['docker', '--context', context, 'info'], stdout=subprocess.DEVNULL, check=True)
    return context


def allowed_payload(name):
    parts = Path(name).parts
    return (parts and parts[0] == 'app' and 'storage' not in parts
            and 'node_modules' not in parts and 'build' not in parts
            and not any(part == '.env' or part.startswith('.env.') for part in parts)
            and not re.search(r'\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$', parts[-1], re.I)
            and (name in {'app/bin/cross-cannon', 'app/BUILD-INFO'}
                 or name.startswith('app/public/') or name.startswith('app/scripture-cache/')))


def runtime_files(require_complete=True):
    """One allowlisted file selection shared by planning and packaging."""
    files = {'unit.service': ROOT / 'cross-cannon.service'}
    for directory in ['public', 'scripture-cache']:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file() or path.is_symlink():
                name = 'app/' + path.relative_to(ROOT).as_posix()
                if path.is_symlink() or not allowed_payload(name):
                    raise ValueError('Runtime data, secret, link or unexpected file in artifact: ' + name)
                files[name] = path
    if require_complete:
        for name in ['app/public/browser/index.html', 'app/public/browser/manifest.json',
                     'app/public/cross-canon-rust-sw.js', 'app/scripture-cache/manifest.json']:
            if name not in files:
                raise ValueError('Missing runtime file: ' + name)
    return files


def runtime_snapshot():
    return {'compiler_inputs': compiler_inputs(), 'build_inputs': binary_inputs(),
            'files': {name: digest(path) for name, path in runtime_files(require_complete=False).items()}}


def browser_current():
    builder = module('browser_release_inputs', ROOT / 'scripts/build-browser.py')
    manifest = builder.valid_manifest()
    return bool(manifest and manifest.get('source') == builder.inputs())


def source_revision(build_info):
    revisions = re.findall(r'^source_revision=([a-f0-9]{40})$', build_info, re.M)
    if len(revisions) != 1 or 'platform=linux/amd64' not in build_info.splitlines():
        return None
    return revisions[0]


def reusable_revision(state, build_identity):
    if not state.get('intact'):
        return None
    receipt = state.get('receipt') or {}
    artifact = receipt.get('artifact', {})
    if 'build_inputs' in artifact and artifact['build_inputs'] != build_identity:
        return None
    revision = source_revision(state.get('build_info', ''))
    if not revision:
        return None
    try:
        if (binary_inputs(revision) == build_identity
                and compiler_inputs(revision) == artifact.get('compiler_inputs')):
            return revision
    except subprocess.CalledProcessError:
        # A machine without that Git object must build/validate normally.
        pass
    return None


def unchanged_runtime(snapshot, state):
    receipt = state.get('receipt') or {}
    artifact = receipt.get('artifact', {})
    if not state.get('intact') or artifact.get('compiler_inputs') != snapshot['compiler_inputs']:
        return False
    previous_files = {name: value for name, value in artifact.get('files', {}).items()
                      if name not in ('app/bin/cross-cannon', 'app/BUILD-INFO')}
    if snapshot['files'] != previous_files:
        return False
    if 'build_inputs' in artifact:
        return artifact['build_inputs'] == snapshot['build_inputs']
    # Compatibility with existing verified receipts: pin the actual BUILD-INFO
    # bytes on the host, then compare that revision's recipe as well as Rust.
    return reusable_revision(state, snapshot['build_inputs']) is not None


def remote_state(server, previous=None):
    code = (ROOT / 'scripts/inspect-server-release.py').read_text()
    args = ['python3', '-c', code]
    token = (previous or {}).get('integrity_token')
    if (previous or {}).get('intact') and isinstance(token, str) and re.fullmatch('[a-f0-9]{64}', token):
        # A successful byte check from this invocation is the only authority for
        # a metadata recheck; tokens are never persisted across ship commands.
        args.append(token)
    return json.loads(server.ssh(args, capture=True))


def inspect_inputs(server, previous=None):
    if not server:
        return runtime_snapshot(), {'receipt': None, 'intact': False, 'build_info': ''}, False
    with ThreadPoolExecutor(max_workers=1) as pool:
        remote = pool.submit(remote_state, server, previous)
        snapshot = runtime_snapshot()
        current = browser_current()
        return snapshot, remote.result(), current


def cached_artifact(build_identity, revision=None):
    validator = module('cached_rust_validator', ROOT / 'scripts/validate-rust-server-artifact.py')
    paths = sorted((ROOT / '.tmp').glob('rust-server-linux-*/binary'),
                   key=lambda path: path.stat().st_mtime, reverse=True)
    for path in paths:
        try:
            candidate = source_revision((path / 'BUILD-INFO').read_text())
            if not candidate or (revision and candidate != revision):
                continue
            if binary_inputs(candidate) != build_identity:
                continue
            validator.validate(path, candidate)
            return path, candidate
        except (ValueError, OSError, subprocess.CalledProcessError):
            continue  # A corrupt/stale cache never bypasses artifact validation.
    return None


def package_artifact(artifact_root, archive, source_identity, build_identity=None, verified_snapshot=None):
    verified_snapshot = runtime_snapshot() if verified_snapshot is None else verified_snapshot
    validator = module('rust_release_validator', ROOT / 'scripts/validate-rust-server-artifact.py')
    validator.validate(artifact_root)
    subprocess.run(['python3', str(ROOT / 'scripts/build-browser.py'), '--check'], cwd=ROOT, check=True)
    build_identity = binary_inputs() if build_identity is None else build_identity
    files = {**runtime_files(),
             'app/bin/cross-cannon': artifact_root / 'target/release/r-cross-cannon',
             'app/BUILD-INFO': artifact_root / 'BUILD-INFO'}
    checksums = {name: digest(path) for name, path in files.items()}
    selected_runtime = {name: value for name, value in checksums.items()
                        if name not in ('app/bin/cross-cannon', 'app/BUILD-INFO')}
    if source_identity != verified_snapshot['compiler_inputs']:
        raise ValueError('Rust sources changed during packaging; rebuild before releasing.')
    if build_identity != verified_snapshot['build_inputs']:
        raise ValueError('Linux build recipe changed during packaging; rebuild before releasing.')
    if selected_runtime != verified_snapshot['files']:
        raise ValueError('Runtime files changed after verification; retry.')
    manifest = {'service': 'cross-cannon', 'runtime': 'rust',
                'fingerprint': hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest(),
                'spec': {'name': 'cross-cannon', 'kind': 'rust', 'port': 3005},
                'artifact': {'platform': 'linux/amd64', 'runtime': 'rust',
                             'compiler_inputs': source_identity, 'build_inputs': build_identity,
                             'files': checksums}}
    archive.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(archive, 'w:gz', dereference=False) as tar:
            for name, path in sorted(files.items()):
                tar.add(path, arcname=name, recursive=False)
            payload = json.dumps(manifest, sort_keys=True).encode()
            import io
            entry = tarfile.TarInfo('manifest.json')
            entry.size = len(payload)
            entry.mode = 0o600
            tar.addfile(entry, io.BytesIO(payload))
        if any(digest(path) != checksums[name] for name, path in files.items()):
            raise ValueError('Runtime inputs changed during packaging; retry.')
        if compiler_inputs() != source_identity:
            raise ValueError('Rust sources changed during packaging; rebuild before releasing.')
        if binary_inputs() != build_identity:
            raise ValueError('Linux build recipe changed during packaging; rebuild before releasing.')
        if runtime_snapshot() != verified_snapshot:
            raise ValueError('Runtime files changed after verification; retry.')
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    return manifest


def release(args):
    server = None
    with stage('Inspect release inputs and active runtime'):
        if not args.build_only:
            shared = module('shared_ship', ADMIN / 'ship.py')
            server = shared.Server()
        initial, state, current = inspect_inputs(server)
        if args.revision and binary_inputs(args.revision) != initial['build_inputs']:
            raise ValueError('Hosted Rust revision does not match current compiler and build-recipe inputs.')
        unchanged = bool(server and not args.force and current and unchanged_runtime(initial, state))
    if args.plan:
        print('Runtime unchanged: no Linux build, archive, upload or restart.' if unchanged else
              'Runtime changed or cannot be proven unchanged: full verification and release required.', flush=True)
        return 'unchanged' if unchanged else 'changed'
    if unchanged:
        if args.ship:
            with stage('Verify maintenance tooling'):
                subprocess.run(['npm', 'run', 'test:unit'], cwd=ROOT, check=True)
                subprocess.run(['npm', 'run', 'typecheck'], cwd=ROOT, check=True)
        # Recheck after tests so concurrent edits or another deployment cannot
        # turn an earlier match into an unverified skip.
        with stage('Confirm unchanged runtime'):
            confirmed, current_state, current = inspect_inputs(server, state)
            if (confirmed != initial or not current or not unchanged_runtime(initial, current_state)):
                raise ValueError('Release inputs or production changed during verification; retry.')
        print('Runtime unchanged: no Linux build, archive, upload or restart.', flush=True)
        return 'unchanged'

    source_identity, build_identity = initial['compiler_inputs'], initial['build_inputs']
    revision, cached = args.revision, None
    if revision and binary_inputs(revision) != build_identity:
        raise ValueError('Hosted Rust revision does not match current compiler and build-recipe inputs.')
    if not args.build_local:
        with stage('Select or start verified Linux build'):
            cached = cached_artifact(build_identity, revision)
            if cached:
                artifact, revision = cached
                print(f'Reusing validated Linux artifact {revision[:12]}.', flush=True)
            else:
                revision = revision or reusable_revision(state, build_identity)
                if not revision:
                    revision = subprocess.check_output(
                        [str(ROOT / 'scripts/publish-rust-server-build.sh')], cwd=ROOT, text=True).strip()
                if binary_inputs(revision) != build_identity:
                    raise ValueError('Hosted Rust revision does not match current compiler and build-recipe inputs.')

    # Publishing the snapshot starts hosted CI before the local suite. Both must
    # succeed before packaging/upload; a local failure leaves production intact.
    with stage('Verify complete app' if args.ship else 'Prepare browser artifacts'):
        command = ['npm', 'run', 'verify'] if args.ship else ['python3', str(ROOT / 'scripts/build-browser.py')]
        subprocess.run(command, cwd=ROOT, check=True)
    if compiler_inputs() != source_identity or binary_inputs() != build_identity:
        raise ValueError('Compiler or build-recipe inputs changed during verification; retry.')
    verified_runtime = runtime_snapshot()

    output = ROOT / '.tmp' / ('rust-server-linux-' + uuid.uuid4().hex[:12])
    output.mkdir(parents=True)
    if not cached:
        artifact = output / 'binary'
        with stage('Build local Linux artifact' if args.build_local else 'Obtain verified Linux artifact'):
            if args.build_local:
                local_docker_context()
                subprocess.run([str(ROOT / 'scripts/build-rust-server-container.sh'), str(artifact)], cwd=ROOT, check=True)
            else:
                subprocess.run(['python3', str(ROOT / 'scripts/fetch-rust-server-release.py'),
                                revision, str(artifact), '--wait'], cwd=ROOT, check=True)
    archive = output / 'cross-cannon-linux-amd64.tar.gz'
    with stage('Validate and package runtime'):
        if runtime_snapshot() != verified_runtime:
            raise ValueError('Runtime files changed after verification; retry.')
        package_artifact(artifact, archive, source_identity, build_identity, verified_runtime)
    print(f'Validated Rust server artifact: {archive} ({archive.stat().st_size / 1024**2:.1f} MiB).', flush=True)
    if args.build_only:
        return 'packaged'
    # Reuse the existing storage-preserving atomic activation and rollback.
    # Production receives no source, package manager, Node or compiler.
    previous = (state.get('receipt') or {}).get('fingerprint', '')
    destination = '/home/ubuntu/.workspace-deploy/incoming/rust-server-' + uuid.uuid4().hex
    server.ssh(['mkdir', '-m', '700', '-p', destination])
    try:
        with stage('Upload runtime'):
            server.upload(archive, destination + '/app.tar.gz')
            server.upload(ADMIN / 'ship_remote.py', destination + '/ship_remote.py')
            server.upload(ROOT / 'scripts/activate-server.py', destination + '/activate.py')
        with stage('Activate and check release'):
            server.ssh(['python3', destination + '/activate.py', destination + '/app.tar.gz',
                        digest(archive), destination + '/ship_remote.py', previous])
    finally:
        server.ssh(['rm', '-rf', '--', destination])
    return 'deployed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ship', action='store_true', help='Verify, release if changed, and verify production')
    parser.add_argument('--plan', action='store_true', help='Read-only unchanged-runtime check; never build or upload')
    parser.add_argument('--force', action='store_true', help='Verify and activate even if runtime files match')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--build-local', action='store_true', help='Build the Linux binary in local Docker instead of hosted CI')
    parser.add_argument('--revision', help='Reuse a hosted revision with matching compiler and build-recipe inputs')
    args = parser.parse_args()
    if args.build_local and args.revision:
        parser.error('--build-local and --revision are mutually exclusive')
    if args.revision and not re.fullmatch('[a-f0-9]{40}', args.revision):
        parser.error('--revision requires a full Git commit SHA')
    if args.build_only and (args.ship or args.plan):
        parser.error('--build-only cannot be combined with --ship or --plan')
    os.environ['CROSS_CANNON_UPDATE_DB'] = '0'
    with stage('Release total'), open(Path(tempfile.gettempdir()) / 'cross-cannon-rust-release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        release(args)
        if args.ship and not args.plan:
            with stage('Verify production'):
                subprocess.run(['npm', 'run', 'verify-prod'], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
