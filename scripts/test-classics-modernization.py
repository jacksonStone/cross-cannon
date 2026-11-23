import hashlib
import copy
import importlib.util
import json
import random
from pathlib import Path
import subprocess
import tempfile
import unittest

from classics_modernization import (apply_overlay, compact_overlay, expand_overlay,
                                   load_overlays, overlay_bytes, reviewed_overlay_bytes)

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('publisher', ROOT / 'scripts/publish-classics-modernization.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
spec = importlib.util.spec_from_file_location('compactor', ROOT / 'scripts/compact-classics-modernization.py')
compactor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compactor)


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
        self.assertEqual(overlay['format'], 2)
        self.assertNotIn('entries', overlay)
        version = publisher.publish(self.out, {(overlay['workId'], overlay['chapterId']): overlay})
        payload = (self.out / 'books.json').read_bytes()
        self.assertEqual(version, hashlib.sha256(payload).hexdigest()[:16])
        path = json.loads(payload)['books'][0]['chapters'][0]['assetPath']
        asset = json.loads((self.out / 'chapters' / path.split('/')[-1]).read_text())
        self.assertEqual(asset['verses'][0]['text'], 'Old words.')
        self.assertEqual(asset['verses'][0]['modernizedText'], 'New 1.')
        self.assertEqual(self.old.read_bytes(), self.original)
        self.assertEqual(publisher.publish(self.out, {(overlay['workId'], overlay['chapterId']): overlay}), version)
        # The compact and legacy publishers must produce the same immutable bytes.
        legacy = {'workId': 'classics:test', 'chapterId': self.chapter['id'],
                  'entries': [{k: e[k] for k in ('verse', 'originalText', 'modernizedText')} for e in self.entries]}
        self.assertEqual(publisher.publish(self.out, {('classics:test', self.chapter['id']): legacy}), version)
        self.assertEqual((self.out / 'books.json').read_bytes(), payload)

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

    def test_corrupt_second_compact_chapter_prevents_all_publication_writes(self):
        first = {'workId': 'classics:test', 'chapterId': self.chapter['id'], 'entries': [
            {k: e[k] for k in ('verse', 'originalText', 'modernizedText')} for e in self.entries]}
        second_asset = copy.deepcopy(self.chapter)
        second_asset['id'] = 'classics:test:book-1.2'
        (self.out / 'chapters/second.json').write_bytes(publisher.encoded(second_asset))
        self.index['books'][0]['chapters'].append({'id': second_asset['id'],
            'assetPath': '/christian-classics-text/chapters/second.json'})
        (self.out / 'books.json').write_bytes(publisher.encoded(self.index))
        second = compact_overlay({**first, 'chapterId': second_asset['id']})
        second['resultSha256'] = 'wrong'
        before = {str(p.relative_to(self.out)): p.read_bytes() for p in self.out.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError, 'result hash'):
            publisher.publish(self.out, {('classics:test', self.chapter['id']): compact_overlay(first),
                                         ('classics:test', second_asset['id']): second})
        self.assertEqual({str(p.relative_to(self.out)): p.read_bytes() for p in self.out.rglob('*') if p.is_file()}, before)

    def durable_fixture(self):
        directory = self.root / 'data/public-domain/christian-classics/modernization'
        directory.mkdir(parents=True)
        legacy = {'workId': 'classics:test', 'chapterId': self.chapter['id'],
                  'entries': [{k: e[k] for k in ('verse', 'originalText', 'modernizedText')} for e in self.entries]}
        path = directory / 'first.json'
        raw = (json.dumps(legacy, ensure_ascii=False, indent=2) + '\n').encode()
        path.write_bytes(raw)
        return path, legacy, raw

    def test_directory_dry_run_migration_review_identity_and_idempotence(self):
        path, legacy, raw = self.durable_fixture()
        report = compactor.compact_directory(self.root)
        self.assertEqual(report['converted'], 1)
        self.assertFalse(report['written'])
        self.assertEqual(path.read_bytes(), raw)
        original_mode = path.stat().st_mode
        report = compactor.compact_directory(self.root, write=True)
        compact_bytes = path.read_bytes()
        overlay = json.loads(compact_bytes)
        self.assertTrue(report['written'])
        self.assertEqual(path.stat().st_mode, original_mode)
        self.assertEqual(expand_overlay(self.chapter, 'classics:test', overlay), legacy)
        self.assertEqual(reviewed_overlay_bytes(self.chapter, 'classics:test', overlay, compact_bytes), raw)
        self.assertEqual(load_overlays(path.parent)[('classics:test', self.chapter['id'])], overlay)
        self.assertEqual(compactor.compact_directory(self.root, write=True)['converted'], 0)
        self.assertEqual(path.read_bytes(), compact_bytes)
        self.assertEqual(self.old.read_bytes(), self.original)

    def test_migration_preflights_every_file_before_any_writes(self):
        path, legacy, raw = self.durable_fixture()
        bad = copy.deepcopy(legacy)
        bad['chapterId'] = 'unknown'
        (path.parent / 'last.json').write_text(json.dumps(bad))
        with self.assertRaises(ValueError):
            compactor.compact_directory(self.root, write=True)
        self.assertEqual(path.read_bytes(), raw)

    def test_migration_refuses_to_invent_original_approved_formatting(self):
        path, legacy, _ = self.durable_fixture()
        raw = json.dumps(legacy).encode()
        path.write_bytes(raw)
        with self.assertRaisesRegex(ValueError, 'exact approved bytes'):
            compactor.compact_directory(self.root, write=True)
        self.assertEqual(path.read_bytes(), raw)

    def test_loader_accepts_mixed_formats_but_rejects_duplicate_and_noncanonical_files(self):
        path, legacy, _ = self.durable_fixture()
        other = copy.deepcopy(legacy)
        other['chapterId'] = 'other'
        second = path.parent / 'second.json'
        second.write_bytes(overlay_bytes(compact_overlay(other)))
        self.assertEqual(len(load_overlays(path.parent)), 2)
        second.write_bytes(second.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'Noncanonical'):
            load_overlays(path.parent)
        second.write_bytes(overlay_bytes(compact_overlay(legacy)))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            load_overlays(path.parent)


class CompactOverlayTest(unittest.TestCase):
    def fixture(self, pairs, chapter_first=False):
        identity = {'workId': 'test', 'chapterId': 'test:1'}
        if chapter_first:
            identity = {'chapterId': 'test:1', 'workId': 'test'}
        legacy = {**identity, 'entries': [
            {'verse': n, 'originalText': before, 'modernizedText': after}
            for n, (before, after) in enumerate(pairs, 1)]}
        asset = {'id': 'test:1', 'verses': [
            {'verse': e['verse'], 'text': e['originalText'], 'metadata': 'preserved'} for e in legacy['entries']]}
        return asset, legacy

    def test_literal_utf8_patch_and_unchanged_reviewed_segment(self):
        asset, legacy = self.fixture([('é old 😇.', 'é new 😇.'), ('Same.', 'Same.')])
        compact = compact_overlay(legacy)
        self.assertEqual(compact['edits'], [[1, [[3, 3, 'new']]]])
        self.assertEqual(compact['reviewedSegments'], 2)
        self.assertEqual(expand_overlay(asset, 'test', compact), legacy)
        before = copy.deepcopy(asset)
        self.assertTrue(apply_overlay(asset, 'test', {('test', 'test:1'): compact}))
        self.assertEqual(asset['verses'][0]['modernizedText'], 'é new 😇.')
        self.assertEqual(asset['verses'][1]['modernizedText'], 'Same.')
        for old, new in zip(before['verses'], asset['verses']):
            self.assertEqual({k: v for k, v in new.items() if k != 'modernizedText'}, old)

    def test_both_legacy_layouts_recover_exact_approved_bytes(self):
        for chapter_first in (False, True):
            asset, legacy = self.fixture([('“λόγος” old.\nשָׁלוֹם', '“λόγος” new.\nשָׁלוֹם')], chapter_first)
            compact = compact_overlay(legacy)
            raw = (json.dumps(legacy, ensure_ascii=False, indent=2) + '\n').encode()
            restored = reviewed_overlay_bytes(asset, 'test', compact, overlay_bytes(compact))
            self.assertEqual(restored, raw)
            self.assertEqual(hashlib.sha256(restored).digest(), hashlib.sha256(raw).digest())
            with self.assertRaisesRegex(ValueError, 'Noncanonical'):
                reviewed_overlay_bytes(asset, 'test', compact, overlay_bytes(compact) + b' ')

    def test_insert_delete_multiple_spans_and_whitespace_preservation(self):
        pairs = [('', 'Inserted.'), ('Delete this prefix. Keep.', 'Keep.'),
                 ('Old prose.', 'New prose!'), ('a\tb\nc', 'a  b\n\nc'),
                 ('a', ' a '), ('Repeat repeat repeat.', 'Repeat repeat.')]
        asset, legacy = self.fixture(pairs)
        self.assertEqual(expand_overlay(asset, 'test', compact_overlay(legacy)), legacy)

    def test_zero_edits_means_all_segments_reviewed_unchanged(self):
        asset, legacy = self.fixture([('Same.', 'Same.'), ('Still same.', 'Still same.')])
        compact = compact_overlay(legacy)
        self.assertEqual(compact['edits'], [])
        self.assertEqual(compact['reviewedSegments'], 2)
        self.assertEqual(expand_overlay(asset, 'test', compact), legacy)

    def test_source_identity_numbering_order_and_unedited_text_are_pinned(self):
        asset, legacy = self.fixture([('Old.', 'New.'), ('Unchanged.', 'Unchanged.')])
        compact = compact_overlay(legacy)
        mutations = [lambda a: a.update(id='other'), lambda a: a['verses'].reverse(),
                     lambda a: a['verses'].pop(), lambda a: a['verses'].append(a['verses'][0]),
                     lambda a: a['verses'][1].update(text='Changed unedited source.'),
                     lambda a: a['verses'][1].update(verse=9)]
        for mutate in mutations:
            changed = copy.deepcopy(asset)
            mutate(changed)
            with self.assertRaises(ValueError):
                expand_overlay(changed, 'test', compact)
        with self.assertRaises(ValueError):
            expand_overlay(asset, 'other', compact)

    def test_corruption_is_rejected_before_any_asset_mutation(self):
        asset, legacy = self.fixture([('é old 😇.', 'é new 😇.'), ('Old.', 'New.')])
        compact = compact_overlay(legacy)
        mutations = [
            lambda c: c.update(format=3), lambda c: c.update(format=True),
            lambda c: c.update(reviewedSegments=True), lambda c: c.update(reviewedSegments=1),
            lambda c: c.update(sourceSha256='wrong'), lambda c: c.update(resultSha256='wrong'),
            lambda c: c.update(extra='unknown'), lambda c: c.update(legacyLayout='unknown'),
            lambda c: c['edits'].pop(), lambda c: c['edits'].append(c['edits'][0]),
            lambda c: c['edits'][0].__setitem__(0, 999),
            lambda c: c['edits'][0].__setitem__(0, True),
            lambda c: c['edits'][0].__setitem__(1, []),
            lambda c: c['edits'][1].__setitem__(1, [[0, 4, ' ']]),
        ]
        bad_operations = [None, [1], [[1, 1, 'x']], [[3, 5, 'x']], [[-1, 1, 'x']],
                          [[3, -1, 'x']], [[3.0, 3, 'x']], [[True, 1, 'x']],
                          [[3, 3, None]], [[3, 0, '']], [[3, 999, 'x']],
                          [[3, 3, 'x'], [4, 1, 'y']], [[7, 0, 'x'], [3, 0, 'y']],
                          [[3, 0, 'x'], [3, 0, 'y']], [[3, 3, 'old']]]
        mutations += [lambda c, ops=ops: c['edits'][0].__setitem__(1, ops) for ops in bad_operations]
        for i, mutate in enumerate(mutations):
            with self.subTest(mutation=i):
                broken = copy.deepcopy(compact)
                mutate(broken)
                before = copy.deepcopy(asset)
                with self.assertRaises(ValueError):
                    apply_overlay(asset, 'test', {('test', 'test:1'): broken})
                self.assertEqual(asset, before)

    def test_randomized_unicode_roundtrips_match_independent_original_strings(self):
        rng = random.Random(314159)
        alphabet = 'abc xyz\n\t.,“”éשָׁלוֹםλόγος😇\u0301\x00'
        for _ in range(600):
            original = ''.join(rng.choice(alphabet) for _ in range(rng.randrange(0, 180)))
            modern = original
            for _ in range(rng.randrange(1, 6)):
                start = rng.randrange(len(modern) + 1)
                end = rng.randrange(start, len(modern) + 1)
                insert = ''.join(rng.choice(alphabet) for _ in range(rng.randrange(12)))
                modern = modern[:start] + insert + modern[end:]
            if not modern.strip():
                modern += 'word'
            asset, legacy = self.fixture([(original, modern)])
            compact = compact_overlay(legacy)
            self.assertEqual(expand_overlay(asset, 'test', compact)['entries'][0]['modernizedText'], modern)

    def test_sparse_nonconsecutive_segment_numbers(self):
        asset, legacy = self.fixture([('Old.', 'New.'), ('Same.', 'Same.')])
        asset['verses'][1]['verse'] = legacy['entries'][1]['verse'] = 99
        self.assertEqual(expand_overlay(asset, 'test', compact_overlay(legacy)), legacy)


if __name__ == '__main__':
    unittest.main()
