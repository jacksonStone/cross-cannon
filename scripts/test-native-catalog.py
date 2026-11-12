import json
from pathlib import Path
import tempfile
import unittest
from lib.native_catalog import build_native_catalog


class NativeCatalogTest(unittest.TestCase):
    def test_catalog_retains_editions_and_original_paragraph_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder in ['public/church-fathers-preview', 'public/christian-classics-text/chapters']:
                (root / folder).mkdir(parents=True)
            metadata = {'genre': 'Commentaries', 'tradition': 'Reformed', 'rights': 'Public domain'}
            (root / 'public/church-fathers-preview/books.json').write_text('{"books":[]}')
            index = {'books': [{'id': 'classics:henry', 'metadata': metadata,
                               'chapters': [{'assetPath': '/christian-classics-text/chapters/example.json'}]}]}
            (root / 'public/christian-classics-text/books.json').write_text(json.dumps(index))
            asset = {'id': 'classics:henry:Prov.16', 'scriptureReference': {'book': 'Proverbs', 'chapter': 16},
                     'verses': [{'verse': number, 'sourceParagraph': 1 if number < 4 else 2,
                                 'scriptureVerseStart': 1 if number < 4 else 2,
                                 'scriptureVerseEnd': 1 if number < 4 else 2,
                                 'text': 'Text is already bundled in the native library.'}
                                for number in range(1, 7)]}
            (root / 'public/christian-classics-text/chapters/example.json').write_text(json.dumps(asset))
            catalog = build_native_catalog(root)
            self.assertEqual(catalog['works']['classics:henry'], metadata)
            self.assertEqual(catalog['chapters'][asset['id']], {
                'scriptureReference': asset['scriptureReference'], 'paragraphs': [
                    {'start': 1, 'end': 3, 'scriptureStart': 1, 'scriptureEnd': 1},
                    {'start': 4, 'end': 6, 'scriptureStart': 2, 'scriptureEnd': 2}]})
            self.assertNotIn('Text is already bundled', json.dumps(catalog))

    def test_real_catalog_covers_every_classic_without_copying_text_or_embeddings(self):
        catalog = build_native_catalog(Path(__file__).resolve().parent.parent)
        self.assertEqual(len(catalog['chapters']), 2580)
        self.assertGreater(len(catalog['works']), 400)
        self.assertEqual(catalog['chapters']['classics:henry:Isa.1']['scriptureReference'], {'book': 'Isaiah', 'chapter': 1})
        self.assertTrue(catalog['chapters']['classics:henry:Isa.1']['paragraphs'])
        self.assertNotIn('embedding', json.dumps(catalog))


if __name__ == '__main__':
    unittest.main()
