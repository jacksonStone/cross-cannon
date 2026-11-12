"""Build/test a Linux web artifact locally in Docker and activate it on Ubuntu."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
ADMIN = ROOT.parent / 'administrative_stuff'

def load_ship():
    spec = importlib.util.spec_from_file_location('shared_ship', ADMIN / 'ship.py')
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    return shared

def local_docker_context():
    if os.environ.get('DOCKER_HOST') and not os.environ['DOCKER_HOST'].startswith('unix://'):
        raise ValueError('Remote Docker engines are refused; builds must stay off production.')
    context = subprocess.check_output(['docker', 'context', 'show'], text=True).strip()
    endpoint = subprocess.check_output(['docker', 'context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
    if not endpoint.startswith('unix://'):
        raise ValueError('A local Docker context is required.')
    subprocess.run(['docker', '--context', context, 'info'], stdout=subprocess.DEVNULL, check=True)
    return context

def package_artifact(shared, manifest, artifact_root, unit, archive):
    files = {'unit.service': unit}
    for path in (artifact_root / 'app').rglob('*'):
        if path.is_file():
            if path.is_symlink() and not path.resolve().is_relative_to((artifact_root / 'app').resolve()):
                raise ValueError('Artifact symlink escapes the app: ' + str(path))
            name = path.relative_to(artifact_root).as_posix()
            parts = path.relative_to(artifact_root).parts
            if 'storage' in parts or any(part == '.env' or part.startswith('.env.') for part in parts) or re.search(r'\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$', path.name, re.I):
                raise ValueError('Runtime data or secrets in artifact: ' + name)
            files[name] = path
    for name in ['app/build/server/serve.mjs', 'app/build/server/index.js', 'app/package.json', 'app/node_modules/better-auth/package.json', 'app/scripts/update-accounts-db.mjs']:
        if name not in files:
            raise ValueError('Missing runtime file: ' + name)
    manifest['artifact'] = {'platform': 'linux/amd64', 'runtime': manifest['runtime'], 'build_runtime': manifest.get('build_runtime', manifest['runtime']),
        'source_fingerprint': manifest['fingerprint'], 'files': {name: shared.digest_file(path) for name, path in files.items()}}
    with tarfile.open(archive, 'w:gz', dereference=True) as tar:
        for name, path in sorted(files.items()):
            tar.add(path, arcname=name, recursive=False)
        metadata = archive.with_suffix('.manifest.json')
        metadata.write_text(json.dumps(manifest, sort_keys=True))
        tar.add(metadata, arcname='manifest.json')
        metadata.unlink()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--build-node-version', default='24.13.0', help='Pinned builder; production still uses .nvmrc')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.build_node_version):
        raise ValueError('Pin the Docker builder to an exact Node patch version.')
    shared = load_ship()
    context = local_docker_context()
    service = next(service for service in shared.SERVICES if service['name'] == 'cross-cannon')
    manifest, files = shared.collect(service)
    with open(Path(tempfile.gettempdir()) / 'cross-cannon-docker-web.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        server = None if args.build_only else shared.Server()
        previous = server.receipts().get('cross-cannon') if server else None
        manifest.update(spec=service, previous=(previous or {}).get('fingerprint'), build_runtime=args.build_node_version)
        output = ROOT / '.tmp' / ('web-linux-' + uuid.uuid4().hex[:12])
        source = output / 'source'
        source.mkdir(parents=True)
        for name, path in files.items():
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            if shared.digest_file(target) != manifest['files'][name]['sha256']:
                raise ValueError('Source changed during snapshot; retry: ' + name)
        print('Building and testing isolated source in local Linux/amd64 Docker.', flush=True)
        archive = output / 'cross-cannon-linux-amd64.tar.gz'
        # Export one tar stream, then unpack outside synced Desktop folders.
        # Exporting thousands of individual files there can stall file-provider
        # coordination even after the container tests have already passed.
        with tempfile.TemporaryDirectory(prefix='cross-cannon-web-runtime-') as temporary:
            runtime = Path(temporary)
            artifact = runtime / 'artifact'
            artifact.mkdir()
            exported = runtime / 'runtime.tar'
            subprocess.run(['docker', '--context', context, 'buildx', 'build', '--builder', context,
                '--platform', 'linux/amd64', '--build-arg', 'NODE_VERSION=' + args.build_node_version,
                '--file', str(source / 'scripts/web-release.Dockerfile'), '--target', 'artifact',
                '--output', 'type=tar,dest=' + str(exported), str(source)], check=True)
            # This is our local Docker scratch image, not an uploaded archive.
            # The final packager also rejects escaping links and private data.
            subprocess.run(['tar', '-xf', str(exported), '-C', str(artifact)], check=True)
            # Refuse a receipt for source different from the tested snapshot.
            if shared.collect(service)[0]['fingerprint'] != manifest['fingerprint']:
                raise ValueError('Deployment inputs changed during Docker build; retry.')
            package_artifact(shared, manifest, artifact, source / 'cross-cannon.service', archive)
        print(f'Validated Docker artifact: {archive.stat().st_size / 1024**2:.1f} MiB.', flush=True)
        if args.build_only:
            print(archive)
            return
        destination = '/home/ubuntu/.workspace-deploy/incoming/docker-web-' + uuid.uuid4().hex
        server.ssh(['mkdir', '-m', '700', '-p', destination])
        try:
            server.upload(archive, destination + '/app.tar.gz')
            server.upload(ADMIN / 'ship_remote.py', destination + '/ship_remote.py')
            server.upload(ROOT / 'scripts/activate-web-container.py', destination + '/activate.py')
            server.ssh(['python3', destination + '/activate.py', destination + '/app.tar.gz', shared.digest_file(archive), destination + '/ship_remote.py'])
        finally:
            server.ssh(['rm', '-rf', '--', destination])
        subprocess.run(['npm', 'run', 'verify-prod'], cwd=ROOT, check=True)

if __name__ == '__main__':
    main()
