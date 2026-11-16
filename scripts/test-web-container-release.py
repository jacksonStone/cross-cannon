import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('web_release', Path(__file__).with_name('ship-web-container.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class WebContainerReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.artifact = self.root / 'artifact'
        self.unit = self.root / 'unit.service'
        self.unit.write_text('test unit')
        for name in ['build/server/serve.mjs', 'build/server/index.js', 'package.json',
                     'node_modules/better-auth/package.json', 'scripts/update-accounts-db.mjs']:
            path = self.artifact / 'app' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture')
        self.archive = self.root / 'release.tar.gz'
        self.manifest = {'runtime': '26.13.0', 'build_runtime': '24.13.0', 'fingerprint': 'tested-source'}
        self.shared = SimpleNamespace(digest_file=lambda path: hashlib.sha256(path.read_bytes()).hexdigest())

    def package(self):
        release.package_artifact(self.shared, self.manifest, self.artifact, self.unit, self.archive)

    def test_remote_docker_is_rejected_before_engine_or_server_contact(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'ssh://production.example'}), patch.object(release.subprocess, 'check_output') as called:
            with self.assertRaisesRegex(ValueError, 'Remote Docker'):
                release.local_docker_context()
            called.assert_not_called()

    def test_runtime_data_and_env_files_never_reach_an_archive(self):
        for name in ['storage/private.db', '.env.production', 'private.sqlite-wal']:
            with self.subTest(name=name):
                path = self.artifact / 'app' / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('private')
                with self.assertRaisesRegex(ValueError, 'Runtime data or secrets'):
                    self.package()
                self.assertFalse(self.archive.exists())
                path.unlink()

    def test_symlinks_cannot_escape_the_artifact(self):
        private = self.root / 'private'
        private.write_text('secret')
        (self.artifact / 'app' / 'escape').symlink_to(private)
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.package()

    def test_archive_is_regular_files_with_hashes_and_tested_source_identity(self):
        link = self.artifact / 'app/node_modules/internal-link'
        link.symlink_to('better-auth/package.json')
        self.package()
        with tarfile.open(self.archive) as archive:
            members = archive.getmembers()
            self.assertTrue(all(member.isfile() for member in members))
            manifest = json.load(archive.extractfile('manifest.json'))
            self.assertEqual(manifest['artifact']['platform'], 'linux/amd64')
            self.assertEqual(manifest['artifact']['build_runtime'], '24.13.0')
            self.assertEqual(manifest['artifact']['runtime'], '26.13.0')
            self.assertEqual(manifest['artifact']['source_fingerprint'], 'tested-source')
            for member in members:
                if member.name != 'manifest.json':
                    digest = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
                    self.assertEqual(digest, manifest['artifact']['files'][member.name])

if __name__ == '__main__':
    unittest.main()
