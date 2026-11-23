"""Regression coverage for source-derived Scripture ranges, including Henry IV."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import struct
import zlib
from xml.etree import ElementTree as ET
from contextlib import redirect_stdout
from unittest.mock import patch

from classics_modernization import compact_overlay, overlay_bytes

spec = importlib.util.spec_from_file_location('classics_import', Path(__file__).with_name('import-christian-classics.py'))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
from lib.sword_commentary import decode_records, kjv_keys


class CommentaryTest(unittest.TestCase):
    def test_import_main_reapplies_legacy_and_compact_overlays_identically(self):
        # Bounded parser output isolates storage/reapplication from the large
        # pinned-source parser tests below. Exercise the real import assembly,
        # sentence identities, coverage, metadata, hashes and output catalogs.
        chapter = importer.chapter('Ps', 1, 'Psalm 1', [
            'The old account. Further old prose.', '“Keep this quotation.”'],
            ranges=[[1, 2], [3, 3]], quotations=[False, True])
        slugs = ['imitation', 'catena', 'henry', 'wesley', 'jfb', 'keil-delitzsch', 'treasury-of-david']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, out = root / 'source', root / 'out'
            overlays = source / 'modernization'
            overlays.mkdir(parents=True)
            (source / 'sources.json').write_text('{"sources":[]}')
            legacy = []
            for slug in slugs:
                overlay = {'workId': f'classics:{slug}', 'chapterId': f'classics:{slug}:Ps.1', 'entries': [
                    {'verse': 1, 'originalText': 'The old account.', 'modernizedText': 'The modern account.'},
                    {'verse': 2, 'originalText': 'Further old prose.', 'modernizedText': 'Further modern prose.'},
                    {'verse': 3, 'originalText': '“Keep this quotation.”', 'modernizedText': '“Keep this quotation.”'}]}
                legacy.append(overlay)
                (overlays / f'{slug}.json').write_text(json.dumps(overlay))
            parsers = {name: lambda *args: [chapter] for name in (
                'imitation', 'catena', 'henry', 'wesley', 'jfb', 'sword_commentary')}
            with patch.multiple(importer, SOURCE=source, OUT=out, **parsers), \
                    patch('sys.argv', ['import-christian-classics.py']), redirect_stdout(io.StringIO()):
                importer.main()
                baseline = {str(p.relative_to(out)): p.read_bytes() for p in out.rglob('*') if p.is_file()}
                for overlay, slug in zip(legacy, slugs):
                    (overlays / f'{slug}.json').write_bytes(overlay_bytes(compact_overlay(overlay)))
                importer.main()
                self.assertEqual({str(p.relative_to(out)): p.read_bytes() for p in out.rglob('*') if p.is_file()}, baseline)
                for book in json.loads((out / 'books.json').read_bytes())['books']:
                    asset = json.loads((out / 'chapters' / book['chapters'][0]['assetPath'].split('/')[-1]).read_bytes())
                    self.assertEqual(asset['verses'][0]['text'], 'The old account.')
                    self.assertEqual(asset['verses'][0]['modernizedText'], 'The modern account.')
                    self.assertEqual(asset['verses'][0]['sourceParagraph'], 1)
                    self.assertTrue(asset['verses'][2]['scriptureQuotation'])
                    self.assertEqual(asset['verses'][0]['scriptureVerseStart'], 1)
                    self.assertEqual(asset['verses'][0]['scriptureVerseEnd'], 2)

    def test_sword_linked_verses_keep_one_text_and_their_full_range(self):
        body = '<p>One discussion of three verses.</p>'.encode()
        packed = zlib.compress(body)
        block_index = struct.pack('<III', 0, len(packed), len(body))
        record = struct.pack('<III', 0, 0, len(body))
        keys = [('Ps', 23, n) for n in [1, 2, 3]]
        decoded = decode_records(record * 3, block_index, packed, keys)
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0]['verses'], [1, 2, 3])
        self.assertEqual(decoded[0]['xml'], body.decode())
        with self.assertRaises(ValueError):
            decode_records(record, block_index, packed, keys)
        with self.assertRaises(ValueError):
            decode_records(struct.pack('<III', 0, 1, len(body)), block_index, packed, keys[:1])

    def test_osis_milestones_keep_paragraphs_headings_and_inline_notes(self):
        raw = '''<title>EXPOSITION</title><div type="x-p" sID="p1"/>
        <hi type="bold">Verse 1.</hi> A <hi>shepherd</hi> cares.
        <note>Source explanation.</note><div type="x-p" eID="p1"/>
        <div type="x-p" sID="p2"/>Next paragraph.<div type="x-p" eID="p2"/>'''
        self.assertEqual(importer.osis_paragraphs(raw), [
            'EXPOSITION', 'Verse 1. A shepherd cares. (Source explanation.)', 'Next paragraph.'])

    @unittest.skipUnless((importer.SOURCE / 'raw/KD.zip').is_file(), 'Pinned import source')
    def test_keil_delitzsch_ranges_use_leading_source_reference_not_index_endpoint(self):
        chapters = importer.sword_commentary('KD')
        self.assertEqual(len(chapters), 929)
        psalm = next(c for c in chapters if c['code'] == 'Ps' and c['number'] == 23)
        found = [(p, r) for p, r in zip(psalm['paragraphs'], psalm['ranges']) if 'The poet calls Jahve' in p]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][1], [1, 3])
        self.assertTrue(any('רע' in p for p in psalm['paragraphs']))

    @unittest.skipUnless((importer.SOURCE / 'raw/TDavid.zip').is_file(), 'Pinned import source')
    def test_spurgeon_has_all_psalms_and_actual_verse_notes(self):
        chapters = importer.sword_commentary('TDavid')
        self.assertEqual([c['number'] for c in chapters], list(range(1, 151)))
        psalm = next(c for c in chapters if c['number'] == 23)
        first = [(p, r) for p, r in zip(psalm['paragraphs'], psalm['ranges']) if 'What condescension is this' in p]
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0][1], [1, 1])
        self.assertTrue(any(r and r[0] == 6 for r in psalm['ranges']))
        longest = next(c for c in chapters if c['number'] == 119)
        self.assertGreater(len(longest['paragraphs']), 176)
        opening = [(p, r) for p, r in zip(longest['paragraphs'], longest['ranges']) if 'The Psalmist is so enraptured' in p]
        self.assertEqual(len(opening), 1)
        self.assertEqual(opening[0][1], [1, 1])
        abbreviated = [(p, r) for p, r in zip(longest['paragraphs'], longest['ranges']) if p.startswith('Ver. 2. Blessed are they')]
        self.assertEqual(abbreviated[0][1], [2, 2])
        limits = {(code, ch): v for keys in kjv_keys((importer.SOURCE / 'raw/canon.h').read_text()).values() for code, ch, v in keys}
        for c in chapters:
            self.assertTrue(all(r is None or 1 <= r[0] <= r[1] <= limits['Ps', c['number']] for r in c['ranges']))

    @unittest.skipUnless((importer.SOURCE / 'raw/jfb.xml').is_file(), 'Pinned import source')
    def test_jfb_covers_all_bible_chapters_and_retains_verse_linked_exposition(self):
        chapters = importer.jfb()
        self.assertEqual(len(chapters), 1189)
        self.assertEqual(len({(c['code'], c['number']) for c in chapters}), 1189)
        matthew = next(c for c in chapters if c['code'] == 'Matt' and c['number'] == 11)
        found = [(p, r) for p, r in zip(matthew['paragraphs'], matthew['ranges']) if 'Incomparable, ravishing sounds' in p]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][1], [28, 28])

    def test_source_scripture_blocks_are_flagged_without_flagging_inline_citations(self):
        element = ET.fromstring('''<div2><div id="Bible:Acts.6.1-Acts.6.7">
          <p class="passage">1 And in those days. 2 Then the twelve.</p>
          <p class="indent">A note quoting <scripRef>the twelve</scripRef>.</p>
        </div></div2>''')
        content, ranges, quotations = importer.commentary_paragraphs(element)
        self.assertEqual(quotations, [True, False])
        self.assertEqual(ranges, [[1, 7], [1, 7]])
        self.assertEqual(content[1], 'A note quoting the twelve.')

    def test_sentence_positions_retain_original_paragraph_boundaries(self):
        verses = importer.sentences(['A complete thought. Another sentence.', 'Next paragraph.'])
        self.assertEqual([v['verse'] for v in verses], [1, 2, 3])
        self.assertEqual([v['sourceParagraph'] for v in verses], [1, 1, 2])

    def test_sibling_markers_apply_to_the_following_commentary_block(self):
        chapter = ET.fromstring('''<div2>
          <p>Chapter introduction.</p>
          <scripCom osisRef="Bible:Isa.1"/>
          <scripCom osisRef="Bible:Isa.1.2-Isa.1.9"/>
          <div class="Commentary"><p>First note <scripRef osisRef="Bible:John.3.16">citing John</scripRef>.</p>
            <div><p>Continuation.</p></div></div>
          <scripCom osisRef="Bible:Isa.1.10-Isa.1.15"/>
          <div class="Commentary"><p>Second note.</p></div>
          <p>Unrelated trailing paragraph.</p>
        </div2>''')
        content, ranges, _ = importer.commentary_paragraphs(chapter)
        self.assertEqual(len(content), 5)
        self.assertEqual(ranges, [None, [2, 9], [2, 9], [10, 15], None])

    def test_existing_wrapped_ranges_and_catena_are_preserved(self):
        for xml, osis in [
            ('<div2><div id="Bible:John.3.1-John.3.21"><p>A note.</p></div></div2>', False),
            ('<chapter><div annotateType="commentary" annotateRef="John.3.1-John.3.21"><p>A note.</p></div></chapter>', True),
        ]:
            self.assertEqual(importer.commentary_paragraphs(ET.fromstring(xml), osis=osis)[1], [[1, 21]])

    @unittest.skipUnless(
        all((importer.SOURCE / f'raw/mhc{volume}.xml').is_file() for volume in range(1, 7)),
        'Pinned XML sources are local import fixtures, excluded from application releases',
    )
    def test_pinned_henry_source_has_verse_mappings_in_every_chapter(self):
        chapters = importer.henry()
        self.assertEqual(len(chapters), 1189)
        self.assertEqual([c['reference'] for c in chapters if not any(c['ranges'])], [])
        isaiah = next(c for c in chapters if c['code'] == 'Isa' and c['number'] == 1)
        self.assertIn([16, 20], isaiah['ranges'])

    def test_shipped_henry_assets_have_coverage_without_raw_sources(self):
        index = json.loads((importer.OUT / 'books.json').read_text())
        henry = next(work for work in index['books'] if work['id'] == 'classics:henry')
        self.assertEqual(len(henry['chapters']), 1189)
        for chapter in henry['chapters']:
            asset = json.loads((importer.ROOT / 'public' / chapter['assetPath'].lstrip('/')).read_text())
            self.assertTrue(any('scriptureVerseStart' in verse for verse in asset['verses']), chapter['id'])
            expected = {v['verse'] for v in asset['verses'] if v.get('scriptureQuotation')}
            actual = {number for start, end in chapter.get('quotationSentenceRanges', []) for number in range(start, end + 1)}
            self.assertEqual(actual, expected, chapter['id'])


if __name__ == '__main__':
    unittest.main()
