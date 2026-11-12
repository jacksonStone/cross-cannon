"""Small offline work metadata and original paragraph boundaries for native UI."""
import itertools
import json


def build_native_catalog(root):
    catalog = {'works': {}, 'chapters': {}}
    for path in ['public/church-fathers-preview/books.json',
                 'public/christian-classics-text/books.json']:
        index = json.loads((root / path).read_text())
        for work in index['books']:
            catalog['works'][work['id']] = work.get('metadata', {})
            if not work['id'].startswith('classics:'):
                continue
            for entry in work['chapters']:
                asset_path = entry['assetPath']
                if not asset_path.startswith('/christian-classics-text/chapters/') or '..' in asset_path:
                    raise ValueError(f'Invalid Classics chapter path: {asset_path}')
                asset = json.loads((root / 'public' / asset_path.lstrip('/')).read_text())
                verses = asset['verses']
                if not verses or any('sourceParagraph' not in v for v in verses):
                    continue
                paragraphs = []
                for _, group in itertools.groupby(verses, key=lambda v: v['sourceParagraph']):
                    group = list(group)
                    starts = [v['scriptureVerseStart'] for v in group if 'scriptureVerseStart' in v]
                    ends = [v.get('scriptureVerseEnd', v['scriptureVerseStart'])
                            for v in group if 'scriptureVerseStart' in v]
                    paragraphs.append({'start': group[0]['verse'], 'end': group[-1]['verse'],
                                       'scriptureStart': min(starts) if starts else None,
                                       'scriptureEnd': max(ends) if ends else None})
                catalog['chapters'][asset['id']] = {
                    'scriptureReference': asset.get('scriptureReference'),
                    'paragraphs': paragraphs,
                }
    return catalog


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(build_native_catalog(args.root), ensure_ascii=False,
                                     separators=(',', ':')))
