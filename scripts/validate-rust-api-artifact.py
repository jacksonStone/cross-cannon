#!/usr/bin/env python3
"""Validate the release boundary before any production upload."""
import hashlib
import pathlib
import re
import struct
import sys

FILES = {'target/release/r-cross-cannon', 'rust/deploy/r-cross-cannon.service', 'BUILD-INFO'}


def validate(root, revision=None):
    root = pathlib.Path(root)
    for name in FILES | {'SHA256SUMS'}:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('Missing or linked release file: ' + name)
    header = (root / 'target/release/r-cross-cannon').read_bytes()[:20]
    if len(header) < 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 62:
        raise ValueError('Expected a Linux x86-64 ELF binary')
    checksums = {}
    for line in (root / 'SHA256SUMS').read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
        if not match or match[2] in checksums:
            raise ValueError('Invalid release checksum manifest')
        checksums[match[2]] = match[1]
    if set(checksums) != FILES:
        raise ValueError('Unexpected release checksum files')
    for name, expected in checksums.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Release checksum mismatch: ' + name)
    if revision and ('source_revision=' + revision) not in (root / 'BUILD-INFO').read_text().splitlines():
        raise ValueError('Release does not match the requested source revision')


if __name__ == '__main__':
    validate(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print('Validated Linux x86-64 release at ' + sys.argv[1])
