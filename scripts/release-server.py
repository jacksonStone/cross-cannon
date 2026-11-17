#!/usr/bin/env python3
"""Build off-server and release one Rust server with its tested browser artifacts."""
import argparse
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
import uuid

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
    """Compare the exact published Rust tree, including uncommitted source files."""
    paths = ['Cargo.toml', 'Cargo.lock', 'rust']
    if revision:
        output = subprocess.check_output(['git', 'ls-tree', '-rz', revision, '--', *paths], cwd=ROOT)
        return {name.decode(): metadata.decode().split()[2]
                for record in output.split(b'\0') if record
                for metadata, name in [record.split(b'\t', 1)]}
    output = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *paths], cwd=ROOT)
    result = {}
    for item in set(output.split(b'\0')) - {b''}:
        name = item.decode()
        path = ROOT / name
        if path.is_file():
            if path.is_symlink():
                raise ValueError('Linked compiler input: ' + name)
            payload = path.read_bytes()
            result[name] = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
    return result


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


def package_artifact(artifact_root, archive, source_identity):
    validator = module('rust_release_validator', ROOT / 'scripts/validate-rust-server-artifact.py')
    validator.validate(artifact_root)
    subprocess.run(['python3', str(ROOT / 'scripts/build-browser.py'), '--check'], cwd=ROOT, check=True)
    files = {'unit.service': ROOT / 'cross-cannon.service',
             'app/bin/cross-cannon': artifact_root / 'target/release/r-cross-cannon',
             'app/BUILD-INFO': artifact_root / 'BUILD-INFO'}
    for directory in ['public', 'scripture-cache']:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file() or path.is_symlink():
                name = 'app/' + path.relative_to(ROOT).as_posix()
                if path.is_symlink() or not allowed_payload(name):
                    raise ValueError('Runtime data, secret, link or unexpected file in artifact: ' + name)
                files[name] = path
    for name in ['app/public/browser/index.html', 'app/public/browser/manifest.json',
                 'app/public/cross-canon-rust-sw.js', 'app/scripture-cache/manifest.json']:
        if name not in files:
            raise ValueError('Missing runtime file: ' + name)
    checksums = {name: digest(path) for name, path in files.items()}
    manifest = {'service': 'cross-cannon', 'runtime': 'rust',
                'fingerprint': hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest(),
                'spec': {'name': 'cross-cannon', 'kind': 'rust', 'port': 3005},
                'artifact': {'platform': 'linux/amd64', 'runtime': 'rust',
                             'compiler_inputs': source_identity, 'files': checksums}}
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
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--build-local', action='store_true', help='Build the Linux binary in local Docker instead of hosted CI')
    parser.add_argument('--revision', help='Use a hosted revision whose Rust inputs exactly match this checkout')
    args = parser.parse_args()
    if args.build_local and args.revision:
        parser.error('--build-local and --revision are mutually exclusive')
    os.environ['CROSS_CANNON_UPDATE_DB'] = '0'
    subprocess.run(['python3', str(ROOT / 'scripts/build-browser.py')], cwd=ROOT, check=True)
    source_identity = compiler_inputs()
    with open(Path(tempfile.gettempdir()) / 'cross-cannon-rust-release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        output = ROOT / '.tmp' / ('rust-server-linux-' + uuid.uuid4().hex[:12])
        output.mkdir(parents=True)
        artifact = output / 'binary'
        if args.build_local:
            local_docker_context()
            subprocess.run([str(ROOT / 'scripts/build-rust-server-container.sh'), str(artifact)], cwd=ROOT, check=True)
        else:
            revision = args.revision or subprocess.check_output([str(ROOT / 'scripts/publish-rust-server-build.sh')], cwd=ROOT, text=True).strip()
            if compiler_inputs(revision) != source_identity:
                raise ValueError('Hosted Rust revision does not match current compiler inputs.')
            subprocess.run(['python3', str(ROOT / 'scripts/fetch-rust-server-release.py'), revision, str(artifact), '--wait'], cwd=ROOT, check=True)
        archive = output / 'cross-cannon-linux-amd64.tar.gz'
        package_artifact(artifact, archive, source_identity)
        print(f'Validated Rust server artifact: {archive} ({archive.stat().st_size / 1024**2:.1f} MiB).', flush=True)
        if args.build_only:
            return
        for name in ['EC2_PEM_PATH', 'EC2_PUBLIC_IP']:
            if not os.environ.get(name):
                raise ValueError('Set ' + name + ' before deploying.')
        # Reuse the existing storage-preserving symlink activation and rollback.
        # Its generic build stage is never called; production receives no source,
        # package manager, Node modules, or compiler.
        shared = module('shared_ship', ADMIN / 'ship.py')
        server = shared.Server()
        previous = server.receipts().get('cross-cannon', {}).get('fingerprint', '')
        destination = '/home/ubuntu/.workspace-deploy/incoming/rust-server-' + uuid.uuid4().hex
        server.ssh(['mkdir', '-m', '700', '-p', destination])
        try:
            server.upload(archive, destination + '/app.tar.gz')
            server.upload(ADMIN / 'ship_remote.py', destination + '/ship_remote.py')
            server.upload(ROOT / 'scripts/activate-server.py', destination + '/activate.py')
            server.ssh(['python3', destination + '/activate.py', destination + '/app.tar.gz', digest(archive), destination + '/ship_remote.py', previous])
        finally:
            server.ssh(['rm', '-rf', '--', destination])


if __name__ == '__main__':
    main()
