"""Regression coverage for source-derived Scripture ranges, including Henry IV."""
import importlib.util
import json
from pathlib import Path
import unittest
from xml.etree import ElementTree as ET

spec = importlib.util.spec_from_file_location('classics_import', Path(__file__).with_name('import-christian-classics.py'))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class CommentaryTest(unittest.TestCase):
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
        content, ranges = importer.commentary_paragraphs(chapter)
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


if __name__ == '__main__':
    unittest.main()
