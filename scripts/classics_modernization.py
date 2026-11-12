"""Validate and apply reviewed Classics modernization overlays."""
import json
from pathlib import Path


def load_overlays(directory):
    overlays = {}
    for path in sorted(Path(directory).glob('*.json')):
        overlay = json.loads(path.read_text())
        key = (overlay['workId'], overlay['chapterId'])
        if key in overlays:
            raise ValueError(f'Duplicate modernization overlay: {key}')
        overlays[key] = overlay
    return overlays


def apply_overlay(asset, work_id, overlays):
    key = (work_id, asset['id'])
    overlay = overlays.get(key)
    if overlay is None:
        return False
    entries = overlay['entries']
    verses = asset['verses']
    if len(entries) != len(verses):
        raise ValueError(f'Incomplete modernization overlay: {key}')
    seen = set()
    by_number = {verse['verse']: verse for verse in verses}
    if len(by_number) != len(verses):
        raise ValueError(f'Duplicate original verse: {key}')
    for entry in entries:
        number = entry['verse']
        verse = by_number.get(number)
        if number in seen or verse is None or entry['originalText'] != verse['text']:
            raise ValueError(f'Invalid original or duplicate verse: {key}:{number}')
        modern = entry['modernizedText']
        if not isinstance(modern, str) or not modern.strip():
            raise ValueError(f'Empty modernization: {key}:{number}')
        seen.add(number)
    for entry in entries:
        by_number[entry['verse']]['modernizedText'] = entry['modernizedText'].strip()
    return True
