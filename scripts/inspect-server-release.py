#!/usr/bin/env python3
"""Read and verify the active release under the shared deployment lock."""
import fcntl
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys


def file_hash(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def file_identity(stat):
    return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mode, stat.st_mtime_ns, stat.st_ctime_ns]


def inspect_release(deploy, expected_token=None, unit_path=Path('/etc/systemd/system/cross-cannon.service')):
    deploy = Path(deploy)
    state = deploy / 'state/cross-cannon.json'
    if not state.is_file():
        return {'receipt': None, 'intact': False, 'build_info': ''}
    # Concurrent activation is a retry, never evidence that nothing changed.
    with (deploy / 'lock').open('rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        receipt = json.loads(state.read_bytes())
        result = {'receipt': receipt, 'intact': False, 'build_info': ''}
        artifact = receipt.get('artifact', {})
        if (receipt.get('service') != 'cross-cannon' or receipt.get('runtime') != 'rust'
                or artifact.get('platform') != 'linux/amd64' or artifact.get('runtime') != 'rust'):
            return result
        release = Path(receipt.get('release', ''))
        releases = (deploy / 'releases/cross-cannon').resolve()
        if not release.is_absolute() or release.is_symlink() or release.resolve().parent != releases:
            return result
        app = deploy.parent / 'cross-cannon'
        if not app.is_symlink() or app.resolve() != (release / 'app').resolve():
            return result
        files = artifact.get('files', {})
        required = {'unit.service', 'app/bin/cross-cannon', 'app/BUILD-INFO'}
        if not required <= files.keys():
            return result
        expected_static = {name for name in files if name.startswith(('app/public/', 'app/scripture-cache/'))}
        actual_static = {path.relative_to(release).as_posix()
                         for directory in ('app/public', 'app/scripture-cache')
                         for path in (release / directory).rglob('*')
                         if path.is_file() or path.is_symlink()}
        if actual_static != expected_static:
            return result
        metadata = []
        unit_path = Path(unit_path)
        if not unit_path.is_file() or unit_path.is_symlink():
            return result
        paths = [(name, release / name, expected, False) for name, expected in sorted(files.items())]
        paths.append(('installed-unit', unit_path, files['unit.service'], True))
        for name, path, expected, installed_unit in paths:
            relative = PurePosixPath(name)
            if (not installed_unit and (relative.is_absolute() or '..' in relative.parts
                    or not (name in required or name.startswith(('app/public/', 'app/scripture-cache/')))
                    or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected))):
                return result
            if (not path.is_file() or path.is_symlink()
                    or (not installed_unit and not path.resolve().is_relative_to(release.resolve()))):
                return result
            before = path.stat()
            if expected_token is None and file_hash(path) != expected:
                return result
            after = path.stat()
            if file_identity(before) != file_identity(after):
                return result
            metadata.append([name, *file_identity(after)])
        token = hashlib.sha256(json.dumps([receipt, metadata], sort_keys=True).encode()).hexdigest()
        if expected_token is not None and token != expected_token:
            return result
        result['build_info'] = (release / 'app/BUILD-INFO').read_text()
        result['integrity_token'] = token
        result['intact'] = True
        return result


if __name__ == '__main__':
    print(json.dumps(inspect_release(Path.home() / '.workspace-deploy', sys.argv[1] if len(sys.argv) > 1 else None)))
