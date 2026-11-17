"""Read pinned, UTF-8/ZIP/KJV zCom4 commentary packages off-server.

The module index stores (compressed block, byte offset, byte length) per KJV
key, including book/chapter introductions. Linked verses share one record;
emit its text once per chapter, retaining the complete linked verse range.
No SWORD executable or runtime dependency is needed.
"""
from collections import OrderedDict
from pathlib import PurePosixPath
import re
import struct
import zipfile
import zlib


def kjv_keys(canon):
    books = re.findall(r'\{"[^"]+", "([^"]+)", "[^"]+", (\d+)\}', canon)
    body = re.search(r'int vm\[\] = \{(.*?)\};', canon, re.S).group(1)
    body = re.sub(r'//[^\n]*|/\*.*?\*/', '', body, flags=re.S)
    counts = iter(map(int, re.findall(r'\d+', body)))
    keys = {}
    for testament, group in [('ot', books[:39]), ('nt', books[39:])]:
        result = [('', 0, 0), ('', 0, 0)]
        for code, chapters in group:
            result.append((code, 0, 0))
            for chapter in range(1, int(chapters) + 1):
                result.extend((code, chapter, verse) for verse in range(next(counts) + 1))
        keys[testament] = result
    assert len(books) == 66 and next(counts, None) is None
    assert len(keys['ot']) == 24115 and len(keys['nt']) == 8246
    return keys


def decode_records(index, block_index, compressed, keys):
    if len(index) != len(keys) * 12 or len(block_index) % 12:
        raise ValueError('Invalid zCom4 index size / KJV key count')
    blocks = []
    for offset, length, size in struct.iter_unpack('<III', block_index):
        block = zlib.decompress(compressed[offset:offset + length])
        if len(block) != size:
            raise ValueError('Invalid zCom4 decompressed block size')
        blocks.append(block)
    grouped = OrderedDict()
    for (code, chapter, verse), record in zip(keys, struct.iter_unpack('<III', index)):
        block, offset, length = record
        if not length:
            continue
        # Module/testament technical headers have no Bible book identity.
        if not code:
            continue
        if block >= len(blocks) or offset + length > len(blocks[block]):
            raise ValueError('zCom4 record exceeds its block')
        key = (code, chapter, record)
        if key not in grouped:
            grouped[key] = {'code': code, 'chapter': chapter, 'verses': [],
                            'xml': blocks[block][offset:offset + length].decode('utf-8')}
        grouped[key]['verses'].append(verse)
    return list(grouped.values())


def read_commentary(path, canon, module):
    keys = kjv_keys(canon)
    with zipfile.ZipFile(path) as archive:
        config = archive.read('mods.d/' + module.lower() + '.conf').decode('utf-8')
        settings = dict(re.findall(r'^([A-Za-z]+)=(.*)$', config, re.M))
        expected = {'ModDrv': 'zCom4', 'CompressType': 'ZIP', 'Encoding': 'UTF-8',
                    'Versification': 'KJV', 'SourceType': 'OSIS',
                    'DistributionLicense': 'Public Domain'}
        if any(settings.get(key) != value for key, value in expected.items()):
            raise ValueError('Unsupported source format or changed rights: ' + module)
        prefix = settings['DataPath'].removeprefix('./')
        if PurePosixPath(prefix).is_absolute() or '..' in PurePosixPath(prefix).parts:
            raise ValueError('Invalid source DataPath')
        result = []
        for testament in ['ot', 'nt']:
            result.extend(decode_records(
                archive.read(prefix + testament + '.bzv'),
                archive.read(prefix + testament + '.bzs'),
                archive.read(prefix + testament + '.bzz'), keys[testament]))
        return result
