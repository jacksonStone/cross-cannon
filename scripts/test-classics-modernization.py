import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('publisher', ROOT / 'scripts/publish-classics-modernization.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class ModernizationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.out = self.root / 'public/christian-classics-text'
        (self.out / 'chapters').mkdir(parents=True)
        self.chapter = {'id': 'classics:test:book-1.1', 'chapter': 1, 'title': 'First',
                        'verses': [{'verse': 1, 'text': 'Old words.'}, {'verse': 2, 'text': 'More words.'}]}
        self.original = json.dumps(self.chapter, separators=(',', ':')).encode()
        self.old = self.out / 'chapters/original.json'
        self.old.write_bytes(self.original)
        self.index = {'books': [{'id': 'classics:test', 'name': 'Test', 'chapters': [
            {'id': self.chapter['id'], 'assetPath': '/christian-classics-text/chapters/original.json'}]}]}
        (self.out / 'books.json').write_text(json.dumps(self.index))
        (self.out / 'manifest.json').write_text(json.dumps({'version': 'old'}))
        self.entries = [{'chapterId': self.chapter['id'], 'verse': v['verse'],
                         'originalText': v['text'], 'modernizedText': f"New {v['verse']}."}
                        for v in self.chapter['verses']]
        self.batch = self.root / 'batch.json'
        self.batch.write_text(json.dumps({'workId': 'classics:test', 'chapterStart': 1,
                                          'chapterEnd': 1, 'entries': self.entries}))
        self.overlay = self.root / 'overlay.json'

    def assemble(self):
        return subprocess.run(['node', '--import', str(ROOT / 'node_modules/tsx/dist/loader.mjs'),
            str(ROOT / 'scripts/apply-church-fathers-modernization.ts'), '--book-index',
            str(self.out / 'books.json'), '--work', 'classics:test', '--chapter', self.chapter['id'],
            '--input', str(self.batch), '--overlay', str(self.overlay), '--audit', str(self.root / 'audit.md')],
            cwd=self.root, capture_output=True, text=True)

    def test_complete_overlay_publishes_new_hash_without_mutating_old(self):
        result = self.assemble()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.old.read_bytes(), self.original)
        overlay = json.loads(self.overlay.read_text())
        version = publisher.publish(self.out, {(overlay['workId'], overlay['chapterId']): overlay})
        payload = (self.out / 'books.json').read_bytes()
        self.assertEqual(version, hashlib.sha256(payload).hexdigest()[:16])
        path = json.loads(payload)['books'][0]['chapters'][0]['assetPath']
        asset = json.loads((self.out / 'chapters' / path.split('/')[-1]).read_text())
        self.assertEqual(asset['verses'][0]['text'], 'Old words.')
        self.assertEqual(asset['verses'][0]['modernizedText'], 'New 1.')
        self.assertEqual(self.old.read_bytes(), self.original)
        self.assertEqual(publisher.publish(self.out, {(overlay['workId'], overlay['chapterId']): overlay}), version)

    def test_rejects_incomplete_and_changed_original(self):
        for entries in (self.entries[:1], [{**self.entries[0], 'originalText': 'changed'}, self.entries[1]]):
            self.batch.write_text(json.dumps({'workId': 'classics:test', 'chapterStart': 1,
                                             'chapterEnd': 1, 'entries': entries}))
            self.assertNotEqual(self.assemble().returncode, 0)
            self.assertFalse(self.overlay.exists())
            self.assertEqual(self.old.read_bytes(), self.original)

    def test_publisher_rejects_stale_overlay_before_writing(self):
        overlay = {'workId': 'classics:test', 'chapterId': self.chapter['id'], 'entries': [
            {'verse': 1, 'originalText': 'wrong', 'modernizedText': 'new'},
            {'verse': 2, 'originalText': 'More words.', 'modernizedText': 'new'}]}
        before = (self.out / 'books.json').read_bytes()
        with self.assertRaises(ValueError):
            publisher.publish(self.out, {('classics:test', self.chapter['id']): overlay})
        self.assertEqual((self.out / 'books.json').read_bytes(), before)
        self.assertEqual(self.old.read_bytes(), self.original)


if __name__ == '__main__':
    unittest.main()
