#!/usr/bin/env python3
"""Prepare public-domain MSB reading text. Never opens or modifies an index/database."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

SOURCE_URL = 'https://ebible.org/Scriptures/engmsb_usfm.zip'
SOURCE_SHA256 = '8224adbd55ddde440d2461234590caf01c3c91b2d0a260b6c00703769077384b'
ROOT = Path(__file__).resolve().parent.parent


def parse_archive(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('MSB archive differs from the reviewed source. Review before changing the pinned hash.')
    chapters = {}
    books = set()
    with ZipFile(path) as archive:
        for name in sorted(archive.namelist()):
            if not name.endswith('.usfm'):
                continue
            source = archive.read(name).decode('utf-8-sig')
            book = re.search(r'^\\h (.+)', source, re.M)[1].strip()
            book = {'Psalm': 'Psalms', 'Song of Solomon': 'Song of Songs'}.get(book, book)
            books.add(book)
            chapter = None
            for line in source.splitlines():
                if line.startswith('\\c '):
                    chapter = int(line[3:].strip())
                    chapters[f'{book}:{chapter}'] = []
                elif line.startswith('\\v '):
                    match = re.fullmatch(r'\\v (\d+) (.+)', line)
                    if not match or chapter is None:
                        raise ValueError(f'Unexpected verse format: {name}: {line[:80]}')
                    # This pinned distribution uses only word/Strong's markup in verses.
                    text = re.sub(r'\\w ([^|]+)\|[^\\]+\\w\*', r'\1', match[2])
                    text = re.sub(r'\s+', ' ', text).strip()
                    if not text:
                        # The source keeps empty numbered slots for four omitted readings.
                        continue
                    if '\\' in text or '|strong=' in text:
                        raise ValueError(f'Unparsed markup: {name}: {line[:80]}')
                    verses = chapters[f'{book}:{chapter}']
                    number = int(match[1])
                    if verses and number <= verses[-1]['number']:
                        raise ValueError(f'Duplicate/out-of-order verse: {name}:{chapter}:{number}')
                    verses.append({'number': number, 'text': text})
    if len(books) != 66 or len(chapters) != 1189 or sum(map(len, chapters.values())) != 31098:
        raise ValueError('Incomplete MSB Bible')
    return {'translation': 'msb', 'chapters': chapters}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help=f'Pinned archive downloaded from {SOURCE_URL}')
    args = parser.parse_args()
    payload = parse_archive(args.archive)
    output = ROOT / 'public/scripture-translations'
    output.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
    version = hashlib.sha256(data).hexdigest()[:16]
    (output / 'msb.json').write_bytes(data)
    manifest = {
        'translation': 'msb', 'name': 'Majority Standard Bible', 'version': version,
        'url': f'/scripture-translations/msb.json?version={version}',
        'sourceUrl': SOURCE_URL, 'sourceSha256': SOURCE_SHA256,
        'rights': 'Public domain', 'rightsUrl': 'https://berean.bible/terms.htm',
        'bookCount': 66, 'chapterCount': 1189, 'verseCount': 31098,
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Prepared MSB reading text: 66 books, 1189 chapters, 31098 nonempty verses; version {version}. No indexing.')


if __name__ == '__main__':
    main()
