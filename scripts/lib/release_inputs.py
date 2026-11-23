"""Exact source identities for portable Rust release artifacts."""
import argparse
import hashlib
from pathlib import Path
import subprocess

COMPILER_PATHS = ['Cargo.toml', 'Cargo.lock', 'rust']
# Changes to compilation, the pinned toolchain/image, Linux tests or validation
# policy invalidate reuse. Unrelated docs/content/tooling do not.
BINARY_PATHS = COMPILER_PATHS + [
    '.dockerignore', '.github/workflows/rust-server-release.yml',
    'scripts/build-rust-server-container.sh', 'scripts/rust-server-build.test.mjs',
    'scripts/validate-rust-server-artifact.py',
]


def git_inputs(root, paths, revision=None):
    if revision:
        output = subprocess.check_output(['git', 'ls-tree', '-rz', revision, '--', *paths], cwd=root)
        return {name.decode(): metadata.decode().split()[2]
                for record in output.split(b'\0') if record
                for metadata, name in [record.split(b'\t', 1)]}
    output = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *paths], cwd=root)
    result = {}
    for item in set(output.split(b'\0')) - {b''}:
        name = item.decode()
        path = Path(root) / name
        if path.is_symlink():
            raise ValueError('Linked compiler input: ' + name)
        if path.is_file():
            payload = path.read_bytes()
            result[name] = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
    return result


def compiler_inputs(root, revision=None):
    return git_inputs(root, COMPILER_PATHS, revision)


def binary_inputs(root, revision=None):
    return git_inputs(root, BINARY_PATHS, revision)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('revision')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    print('match' if binary_inputs(root) == binary_inputs(root, args.revision) else 'different')
