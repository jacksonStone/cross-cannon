"""Lossless, source-pinned storage and application of reviewed modernization."""
import difflib
import hashlib
import json
from pathlib import Path
import re

COMPACT_FIELDS = ('format', 'workId', 'chapterId', 'sourceSha256', 'resultSha256',
                  'reviewedSegments', 'legacyLayout', 'edits')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def overlay_bytes(overlay):
    if set(overlay) != set(COMPACT_FIELDS):
        raise ValueError('Invalid compact overlay fields')
    return encoded({key: overlay[key] for key in COMPACT_FIELDS}) + b'\n'


def _hash(records):
    return hashlib.sha256(encoded(records)).hexdigest()


def _number(value):
    return type(value) is int and value > 0


def _records(entries, field):
    return [[e['verse'], e[field]] for e in entries]


def _validate_entries(entries):
    if not isinstance(entries, list) or not entries:
        raise ValueError('Missing reviewed segments')
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'verse', 'originalText', 'modernizedText'}:
            raise ValueError('Invalid modernization entry')
        number = entry['verse']
        if not _number(number) or number in seen:
            raise ValueError('Invalid or duplicate reviewed segment')
        seen.add(number)
        if not isinstance(entry['originalText'], str):
            raise ValueError('Invalid original text')
        modern = entry['modernizedText']
        if not isinstance(modern, str) or not modern.strip():
            raise ValueError('Empty modernization')


def _patch(original, modern):
    # Token matching only chooses spans; offsets and replacements preserve all
    # original UTF-8 bytes, including punctuation, whitespace and non-Latin text.
    before = re.findall(r'\w+|\s+|[^\w\s]', original)
    after = re.findall(r'\w+|\s+|[^\w\s]', modern)
    offsets = [0]
    for token in before:
        offsets.append(offsets[-1] + len(token.encode('utf-8')))
    return [[offsets[a], offsets[b] - offsets[a], ''.join(after[c:d])]
            for kind, a, b, c, d in difflib.SequenceMatcher(
                None, before, after, autojunk=False).get_opcodes() if kind != 'equal']


def _apply_patch(original, operations):
    if not isinstance(operations, list) or not operations:
        raise ValueError('Empty or invalid patch')
    source = original.encode('utf-8')
    boundaries = {0}
    position = 0
    for char in original:
        position += len(char.encode('utf-8'))
        boundaries.add(position)
    parts, cursor, previous_start = [], 0, -1
    for operation in operations:
        if not isinstance(operation, list) or len(operation) != 3:
            raise ValueError('Invalid patch operation')
        start, delete, insert = operation
        if (type(start) is not int or type(delete) is not int or delete < 0
                or not isinstance(insert, str) or (delete == 0 and not insert)
                or start not in boundaries or start + delete not in boundaries
                or start < cursor or start <= previous_start):
            raise ValueError('Invalid, overlapping or non-UTF-8 patch span')
        parts.extend((source[cursor:start], insert.encode('utf-8')))
        cursor, previous_start = start + delete, start
    parts.append(source[cursor:])
    return b''.join(parts).decode('utf-8')


def compact_overlay(overlay):
    """Encode a complete legacy overlay as exact edits, retaining review identity."""
    if set(overlay) != {'workId', 'chapterId', 'entries'}:
        raise ValueError('Unsupported legacy overlay fields')
    entries = overlay['entries']
    _validate_entries(entries)
    order = list(overlay)
    if order not in (['workId', 'chapterId', 'entries'], ['chapterId', 'workId', 'entries']):
        raise ValueError('Unsupported legacy overlay layout')
    if any(list(e) != ['verse', 'originalText', 'modernizedText'] for e in entries):
        raise ValueError('Unsupported legacy entry layout')
    for key in ('workId', 'chapterId'):
        if not isinstance(overlay[key], str) or not overlay[key]:
            raise ValueError('Missing overlay identity')
    return {
        'format': 2,
        'workId': overlay['workId'],
        'chapterId': overlay['chapterId'],
        'sourceSha256': _hash(_records(entries, 'originalText')),
        'resultSha256': _hash(_records(entries, 'modernizedText')),
        'reviewedSegments': len(entries),
        'legacyLayout': 'chapter-first' if order[0] == 'chapterId' else 'work-first',
        'edits': [[e['verse'], _patch(e['originalText'], e['modernizedText'])]
                  for e in entries if e['originalText'] != e['modernizedText']],
    }


def expand_overlay(asset, work_id, overlay):
    """Validate the entire overlay before returning complete reviewed entries."""
    if overlay.get('workId') != work_id or overlay.get('chapterId') != asset['id']:
        raise ValueError('Modernization identity mismatch')
    verses = asset['verses']
    if (not isinstance(verses, list) or not verses
            or any(not _number(v['verse']) or not isinstance(v['text'], str) for v in verses)
            or len({v['verse'] for v in verses}) != len(verses)):
        raise ValueError('Invalid or duplicate original segment')
    if 'format' not in overlay:
        entries = overlay['entries']
        _validate_entries(entries)
        originals = {v['verse']: v['text'] for v in verses}
        if len(entries) != len(verses) or any(
                e['verse'] not in originals or e['originalText'] != originals[e['verse']] for e in entries):
            raise ValueError('Incomplete modernization or changed original')
        return overlay
    if (set(overlay) != set(COMPACT_FIELDS) or type(overlay['format']) is not int or overlay['format'] != 2
            or overlay['legacyLayout'] not in ('chapter-first', 'work-first')
            or type(overlay['reviewedSegments']) is not int
            or overlay['reviewedSegments'] != len(verses)
            or overlay['sourceSha256'] != _hash([[v['verse'], v['text']] for v in verses])):
        raise ValueError('Unsupported format, incomplete review or changed original')
    modern = {v['verse']: v['text'] for v in verses}
    seen = set()
    if not isinstance(overlay['edits'], list):
        raise ValueError('Invalid edits')
    for edit in overlay['edits']:
        if not isinstance(edit, list) or len(edit) != 2:
            raise ValueError('Invalid segment edit')
        number, operations = edit
        if not _number(number) or number not in modern or number in seen:
            raise ValueError('Unknown or duplicate edited segment')
        seen.add(number)
        updated = _apply_patch(modern[number], operations)
        if updated == modern[number] or not updated.strip():
            raise ValueError('Unchanged or empty segment edit')
        modern[number] = updated
    if _hash([[v['verse'], modern[v['verse']]] for v in verses]) != overlay['resultSha256']:
        raise ValueError('Modernization result hash mismatch')
    entries = [{'verse': v['verse'], 'originalText': v['text'], 'modernizedText': modern[v['verse']]}
               for v in verses]
    _validate_entries(entries)
    identity = {'workId': work_id, 'chapterId': asset['id']}
    if overlay['legacyLayout'] == 'chapter-first':
        identity = {'chapterId': asset['id'], 'workId': work_id}
    return {**identity, 'entries': entries}


def reviewed_overlay_bytes(asset, work_id, overlay, raw):
    """Recover the exact approved legacy bytes; never trust a claimed old hash."""
    expanded = expand_overlay(asset, work_id, overlay)
    if 'format' not in overlay:
        if json.loads(raw) != overlay:
            raise ValueError('Overlay bytes differ from reviewed data')
        return raw
    if raw != overlay_bytes(overlay):
        raise ValueError('Noncanonical compact overlay bytes')
    return (json.dumps(expanded, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def parse_overlay(raw):
    """Validate storage encoding before an approval tool can save these bytes."""
    overlay = json.loads(raw)
    if not isinstance(overlay, dict):
        raise ValueError('Invalid overlay document')
    if 'format' in overlay and raw != overlay_bytes(overlay):
        raise ValueError('Noncanonical compact overlay bytes')
    return overlay


def load_overlays(directory):
    overlays = {}
    for path in sorted(Path(directory).glob('*.json')):
        overlay = parse_overlay(path.read_bytes())
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
    expanded = expand_overlay(asset, work_id, overlay)
    by_number = {verse['verse']: verse for verse in asset['verses']}
    for entry in expanded['entries']:
        by_number[entry['verse']]['modernizedText'] = entry['modernizedText'].strip()
    return True
