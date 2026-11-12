#!/usr/bin/env python3
"""Publish reviewed overlays without reimporting sources or changing old assets."""
import hashlib
import json
from pathlib import Path
from classics_modernization import apply_overlay, load_overlays

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/christian-classics-text'
SOURCE = ROOT / 'data/public-domain/christian-classics'


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def publish(out, overlays):
    index_path = out / 'books.json'
    index = json.loads(index_path.read_text())
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    pending = []
    found = set()
    for book in index['books']:
        for summary in book['chapters']:
            key = (book['id'], summary['id'])
            if key not in overlays:
                continue
            prefix = '/christian-classics-text/chapters/'
            asset_path = summary['assetPath']
            if not asset_path.startswith(prefix) or '/' in asset_path[len(prefix):]:
                raise ValueError(f'Invalid chapter path: {asset_path}')
            asset = json.loads((out / 'chapters' / asset_path[len(prefix):]).read_text())
            if asset['id'] != summary['id']:
                raise ValueError(f'Chapter ID mismatch: {key}')
            apply_overlay(asset, book['id'], overlays)
            data = encoded(asset)
            digest = hashlib.sha256(data).hexdigest()[:16]
            filename = f"{asset['id'].replace(':', '_')}.{digest}.json"
            target = out / 'chapters' / filename
            if target.exists() and target.read_bytes() != data:
                raise ValueError(f'Content hash collision: {target}')
            pending.append((target, data))
            summary['assetPath'] = prefix + filename
            found.add(key)
    missing = set(overlays) - found
    if missing:
        raise ValueError(f'Unknown overlay chapters: {sorted(missing)}')
    payload = encoded(index)
    manifest['version'] = hashlib.sha256(payload).hexdigest()[:16]
    for target, data in pending:
        if not target.exists():
            target.write_bytes(data)
    index_path.write_bytes(payload)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest['version']


if __name__ == '__main__':
    version = publish(OUT, load_overlays(SOURCE / 'modernization'))
    print(f'Published Classics modernization; version {version}')
