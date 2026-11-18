"""Bootstrap addresses must change with their dependencies and release manifest."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('browser_assets', Path(__file__).parent / 'lib/browser_assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class BrowserAssetsTests(unittest.TestCase):
    def build(self, directory, version='a' * 20, platform='export const value=1;'):
        root = Path(directory)
        (root / 'fonts').mkdir(exist_ok=True)
        (root / 'fonts/reader.ttf').write_bytes(b'font')
        (root / 'reader.css').write_text("@font-face{src:url('/browser/fonts/reader.ttf')}")
        (root / 'platform.js').write_text(platform)
        (root / 'start.js').write_text("import {value} from './platform.js';const manifest='/browser/manifest.__READER_VERSION__.json';")
        (root / 'index.html').write_text('<link href="/browser/reader.css"><script type="module" src="/browser/start.js"></script>')
        return assets.version_assets(root, version)

    def test_dependency_bytes_and_manifest_version_change_the_bootstrap_address(self):
        with tempfile.TemporaryDirectory() as directory:
            first = self.build(directory)
            changed = self.build(directory, platform='export const value=2;')
            release = self.build(directory, version='b' * 20, platform='export const value=2;')
            self.assertNotEqual(first['start'], changed['start'])
            self.assertNotEqual(changed['start'], release['start'])
            self.assertEqual(first['style'], changed['style'])
            for url in [release['start'], release['style']]:
                path = Path(directory) / url.removeprefix('/browser/')
                self.assertIn(hashlib.sha256(path.read_bytes()).hexdigest()[:20], path.name)
            source = (Path(directory) / release['start'].removeprefix('/browser/')).read_text()
            self.assertNotIn("'./platform.js'", source)
            self.assertIn('/browser/manifest.' + 'b' * 20 + '.json', source)
            html = (Path(directory) / 'index.html').read_text()
            self.assertIn(release['start'], html)
            self.assertIn(release['style'], html)
            self.assertEqual(html, (Path(directory) / release['shell'].removeprefix('/browser/')).read_text())

    def test_nested_side_effect_and_dynamic_imports_are_versioned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.build(directory)
            (root / 'nested').mkdir()
            (root / 'nested/side.js').write_text('export const side=1;')
            result = self.build(directory, platform="import './nested/side.js';export const value=import('./nested/side.js');")
            start = (root / result['start'].removeprefix('/browser/')).read_text()
            import re
            dependency = re.search(r"from '(\./[^']+)'", start)[1]
            source = (root / dependency).read_text()
            self.assertNotIn("'./nested/side.js'", source)
            self.assertIn('side.', source)


if __name__ == '__main__':
    unittest.main()
