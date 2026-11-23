#!/usr/bin/env python3
"""Compact durable overlays after proving exact source, result and review bytes.

Defaults to a dry run. This only changes overlay storage, never published assets,
review evidence, databases or indexes. Mixed legacy/compact directories can resume.
"""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

from classics_modernization import compact_overlay, expand_overlay, overlay_bytes, parse_overlay, reviewed_overlay_bytes


def compact_directory(root, write=False):
    root = Path(root).resolve()
    out = root / 'public/christian-classics-text'
    directory = root / 'data/public-domain/christian-classics/modernization'
    if not directory.is_dir():
        raise ValueError(f'Missing overlay directory: {directory}')
    index = json.loads((out / 'books.json').read_bytes())
    sources = {}
    prefix = '/christian-classics-text/chapters/'
    for book in index['books']:
        for chapter in book['chapters']:
            path = chapter['assetPath']
            if not path.startswith(prefix) or '/' in path[len(prefix):] or path[len(prefix):] in ('', '.', '..'):
                raise ValueError(f'Invalid chapter path: {path}')
            key = (book['id'], chapter['id'])
            if key in sources:
                raise ValueError(f'Duplicate chapter: {key}')
            sources[key] = out / 'chapters' / path[len(prefix):]
    pending, seen = [], set()
    before = after = segments = changed = count = 0
    for path in sorted(directory.glob('*.json')):
        raw = path.read_bytes()
        overlay = parse_overlay(raw)
        key = (overlay['workId'], overlay['chapterId'])
        if key in seen or key not in sources:
            raise ValueError(f'Duplicate or unknown overlay: {key}')
        seen.add(key)
        asset = json.loads(sources[key].read_bytes())
        expanded = expand_overlay(asset, key[0], overlay)
        compact = overlay if 'format' in overlay else compact_overlay(overlay)
        result = overlay_bytes(compact)
        if expand_overlay(asset, key[0], compact) != expanded:
            raise ValueError(f'Compaction changed reviewed entries: {path}')
        approved = reviewed_overlay_bytes(asset, key[0], compact, result)
        if reviewed_overlay_bytes(asset, key[0], overlay, raw) != approved:
            raise ValueError(f'Cannot preserve exact approved bytes: {path}')
        before += len(raw)
        after += len(result)
        count += 1
        segments += len(expanded['entries'])
        changed += len(compact['edits'])
        if raw != result:
            pending.append((path, raw, result))
    # Preflight the whole directory before writing anything. Each replacement is
    # atomic, and both formats are readable if interrupted between replacements.
    if write:
        for path, raw, _ in pending:
            if path.read_bytes() != raw:
                raise ValueError(f'Overlay changed during compaction: {path}')
        for path, _, result in pending:
            descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
            try:
                with os.fdopen(descriptor, 'wb') as stream:
                    os.fchmod(stream.fileno(), stat.S_IMODE(path.stat().st_mode))
                    stream.write(result)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                Path(temporary).unlink(missing_ok=True)
    return {'chapters': count, 'reviewedSegments': segments, 'editedSegments': changed,
            'beforeBytes': before, 'afterBytes': after, 'converted': len(pending), 'written': write}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--stdin', action='store_true', help='Encode one complete reviewed overlay from stdin')
    args = parser.parse_args()
    if args.stdin:
        sys.stdout.buffer.write(overlay_bytes(compact_overlay(json.load(sys.stdin))))
    else:
        print(json.dumps(compact_directory(args.root, args.write), indent=2))


if __name__ == '__main__':
    main()
