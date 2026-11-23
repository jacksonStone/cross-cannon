"""Release boundary and stopped-database migration checks; no Docker or SSH."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


release = load('rust_server_release', 'release-server.py')
activation = load('rust_server_activation', 'activate-server.py')
REAL_ROOT = release.ROOT


class RustServerReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.artifact = self.root / 'binary'
        self.archive = self.root / 'release.tar.gz'
        for name, contents in {
            'cross-cannon.service': 'ExecStart=/home/ubuntu/cross-cannon/bin/cross-cannon\n',
            'public/browser/index.html': '<html>fixture</html>',
            'public/browser/manifest.json': '{}',
            'public/cross-canon-rust-sw.js': '// fixture worker',
            'scripture-cache/manifest.json': '{"version":"fixture"}',
        }.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents)
        binary = bytearray(20)
        binary[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<H', binary, 18, 62)
        for name, payload in {'target/release/r-cross-cannon': binary,
                              'BUILD-INFO': b'platform=linux/amd64\n'}.items():
            path = self.artifact / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        (self.artifact / 'SHA256SUMS').write_text(''.join(
            hashlib.sha256((self.artifact / name).read_bytes()).hexdigest() + '  ' + name + '\n'
            for name in sorted(['target/release/r-cross-cannon', 'BUILD-INFO'])))
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/validate-rust-server-artifact.py').write_bytes((REAL_ROOT / 'scripts/validate-rust-server-artifact.py').read_bytes())
        self.addCleanup(patch.stopall)
        patch.object(release, 'ROOT', self.root).start()
        patch.object(release, 'compiler_inputs', return_value={'rust/core/src/lib.rs': 'fixture'}).start()
        patch.object(release, 'binary_inputs', return_value={'recipe': 'fixture'}).start()
        patch.object(release.subprocess, 'run').start()

    def package(self):
        return release.package_artifact(self.artifact, self.archive, release.compiler_inputs())

    def test_remote_docker_is_rejected_before_contact(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'ssh://production.invalid'}), patch.object(release.subprocess, 'check_output') as contact:
            with self.assertRaisesRegex(ValueError, 'Remote Docker'):
                release.local_docker_context()
            contact.assert_not_called()

    def test_archive_contains_only_rust_and_static_runtime_and_validates_remotely(self):
        # Extra builder files are never selected into the runtime payload.
        (self.artifact / 'storage').mkdir()
        (self.artifact / 'storage/private.db').write_text('private')
        manifest = self.package()
        actual = activation.validate_package(self.archive, release.digest(self.archive))
        self.assertEqual(actual, manifest)
        with tarfile.open(self.archive) as archive:
            self.assertTrue(all(member.isfile() for member in archive))
            self.assertFalse(any('node_modules' in name or 'package.json' in name for name in archive.getnames()))
            self.assertIn('app/bin/cross-cannon', archive.getnames())
            self.assertNotIn('storage/private.db', archive.getnames())

    def test_private_data_and_links_in_public_tree_are_rejected(self):
        for name in ['public/storage/private.db', 'public/.env.production', 'public/hidden.sqlite-wal']:
            with self.subTest(name=name):
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('private')
                with self.assertRaisesRegex(ValueError, 'Runtime data'):
                    self.package()
                self.assertFalse(self.archive.exists())
                path.unlink()
        (self.root / 'public/linked').symlink_to(self.artifact / 'BUILD-INFO')
        with self.assertRaisesRegex(ValueError, 'link'):
            self.package()

    def test_changed_input_cannot_receive_a_valid_release(self):
        with patch.object(release, 'compiler_inputs', return_value={'changed': 'source'}):
            with self.assertRaisesRegex(ValueError, 'Rust sources changed'):
                release.package_artifact(self.artifact, self.archive, {'original': 'source'})
        self.assertFalse(self.archive.exists())

    def test_unverified_file_cannot_enter_package_after_validation_started(self):
        from types import SimpleNamespace
        before = release.runtime_snapshot()
        def inject(*args):
            (self.root / 'public/unverified.js').write_text('Added after app verification')
        with patch.object(release, 'module', return_value=SimpleNamespace(validate=inject)):
            with self.assertRaisesRegex(ValueError, 'Runtime files changed after verification'):
                release.package_artifact(self.artifact, self.archive, release.compiler_inputs(),
                                         verified_snapshot=before)
        self.assertFalse(self.archive.exists())

    def test_remote_rejects_unlisted_or_duplicate_members_before_extraction(self):
        self.package()
        with tarfile.open(self.archive) as archive:
            files = [(member.name, archive.extractfile(member).read()) for member in archive]
        for unexpected in ['app/storage/private.db', 'app/node_modules/runtime.js', '../escape', 'manifest.json']:
            with self.subTest(unexpected=unexpected):
                with tarfile.open(self.archive, 'w:gz') as archive:
                    for name, payload in files + [(unexpected, b'bad')]:
                        member = tarfile.TarInfo(name)
                        member.size = len(payload)
                        archive.addfile(member, io.BytesIO(payload))
                with self.assertRaises(ValueError):
                    activation.validate_package(self.archive, release.digest(self.archive))


    def activate_fixture(self, fail=False):
        """Exercise the actual shared atomic activation with simulated systemd."""
        helper = REAL_ROOT.parent / 'administrative_stuff/ship_remote.py'
        if not helper.is_file():
            self.skipTest('The shared deployment helper lives in the sibling administrative workspace')
        spec = importlib.util.spec_from_file_location('shared_activation_fixture', helper)
        shared = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(shared)
        home = self.root / 'ubuntu'
        app = home / 'cross-cannon'
        storage = app / 'storage'
        storage.mkdir(parents=True)
        (storage / 'accounts.db').write_bytes(b'original account database')
        (storage / 'accounts.db-wal').write_bytes(b'original committed WAL')
        (storage / 'crosscannon.db').write_bytes(b'unchanged vector database')
        unit = self.root / 'units/cross-cannon.service'
        unit.parent.mkdir()
        unit.write_text('old Node service')
        dropins = unit.parent / 'cross-cannon.service.d'
        dropins.mkdir()
        (dropins / '30-rust-resources.conf').write_text('old Node ExecStart')
        (dropins / '20-auth.conf').write_text('private auth EnvironmentFile')
        active = {'cross-cannon': True, 'r-cross-cannon': True}
        events = []
        def run(args, capture=False, check=True):
            args = list(map(str, args))
            if args[0] == 'sudo':
                args = args[1:]
            if args[0] == 'systemctl':
                operation = args[1]
                if operation == 'is-active':
                    return 0 if active.get(args[-1], False) else 3
                if operation in {'stop', 'start', 'restart'}:
                    active[args[-1]] = operation != 'stop'
                    events.append((operation, args[-1]))
                return 0
            if args[0] == 'install':
                import shutil
                shutil.copy2(args[-2], args[-1])
                return 0
            if args[0] == 'rm':
                Path(args[-1]).unlink(missing_ok=True)
                return 0
            self.fail('Unexpected remote command in fixture: ' + str(args))
        shared.HOME = home
        shared.DEPLOY = home / '.workspace-deploy'
        shared.run = run
        shared.System.unit = lambda self, name: unit.parent / (name + '.service')
        destination = shared.DEPLOY / 'shared/cross-cannon/accounts/accounts.db'
        def verify(_shared, _release):
            self.assertFalse(active['r-cross-cannon'], 'A second Library must never run during replacement checks')
            self.assertEqual(destination.read_bytes(), b'original account database')
            self.assertEqual(Path(str(destination) + '-wal').read_bytes(), b'original committed WAL')
            self.assertFalse((dropins / '30-rust-resources.conf').exists())
            if fail:
                destination.write_bytes(b'account data changed before health failure')
                raise ValueError('simulated health failure')
        self.package()
        from types import SimpleNamespace
        with patch.object(activation, 'verify_runtime', side_effect=verify), patch.object(activation.subprocess, 'run', return_value=SimpleNamespace(stdout='libc available')):
            if fail:
                with self.assertRaisesRegex(ValueError, 'simulated health failure'):
                    activation.activate(self.archive, release.digest(self.archive), helper, _shared=shared)
            else:
                activation.activate(self.archive, release.digest(self.archive), helper, _shared=shared)
        self.assertEqual((storage / 'crosscannon.db').read_bytes(), b'unchanged vector database')
        self.assertEqual((dropins / '20-auth.conf').read_text(), 'private auth EnvironmentFile')
        if fail:
            self.assertFalse(app.is_symlink())
            self.assertEqual(unit.read_text(), 'old Node service')
            self.assertEqual((dropins / '30-rust-resources.conf').read_text(), 'old Node ExecStart')
            self.assertTrue(active['cross-cannon'])
            self.assertTrue(active['r-cross-cannon'])
            self.assertEqual((storage / 'accounts.db').read_bytes(), b'account data changed before health failure')
            self.assertFalse((storage / 'accounts.db').is_symlink())
            self.assertFalse(destination.exists())
            self.assertFalse((shared.DEPLOY / 'state/cross-cannon.json').exists())
        else:
            self.assertTrue(app.is_symlink())
            self.assertTrue((app / 'bin/cross-cannon').is_file())
            self.assertTrue(active['cross-cannon'])
            self.assertFalse(active['r-cross-cannon'])
            self.assertEqual((storage / 'accounts.db').read_bytes(), b'original account database')
            self.assertTrue((storage / 'accounts.db').is_symlink())
            self.assertEqual(json.loads((shared.DEPLOY / 'state/cross-cannon.json').read_text())['runtime'], 'rust')
        self.assertLess(events.index(('stop', 'r-cross-cannon')), events.index(('restart', 'cross-cannon')))

    def test_real_shared_activation_stops_legacy_process_and_commits_one_rust_release(self):
        self.activate_fixture()

    def test_real_shared_activation_failure_restores_services_unit_dropin_and_account_data(self):
        self.activate_fixture(fail=True)


class LegacyBridgeTransitionTest(unittest.TestCase):
    def test_node_override_is_removed_and_restored_without_changing_auth(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            units = root / 'systemd/system'
            dropins = units / 'cross-cannon.service.d'
            dropins.mkdir(parents=True)
            bridge = dropins / '30-rust-resources.conf'
            bridge.write_text('ExecStart=/usr/bin/env node old-server.mjs')
            auth = dropins / '20-auth.conf'
            auth.write_text('EnvironmentFile=/private/auth.env')
            release_dir = root / 'release'
            release_dir.mkdir()
            def run(args):
                if args[1] == 'rm':
                    Path(args[-1]).unlink()
                elif args[1] == 'install':
                    import shutil
                    shutil.copyfile(args[-2], args[-1])
                else:
                    self.fail('Unexpected service mutation: ' + str(args))
            shared = SimpleNamespace(run=run)
            system = SimpleNamespace(unit=lambda name: units / (name + '.service'))
            activation.update_legacy_bridge(shared, system, release_dir, release_dir / 'unit.service', 'cross-cannon')
            self.assertFalse(bridge.exists())
            self.assertEqual(auth.read_text(), 'EnvironmentFile=/private/auth.env')
            activation.update_legacy_bridge(shared, system, release_dir, release_dir / 'previous.service', 'cross-cannon')
            self.assertIn('node old-server.mjs', bridge.read_text())
            self.assertEqual(auth.read_text(), 'EnvironmentFile=/private/auth.env')


class AccountsDirectoryMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.deploy = self.home / '.workspace-deploy'
        self.source = self.home / 'cross-cannon/storage/accounts.db'
        self.source.parent.mkdir(parents=True)
        self.destination = self.deploy / 'shared/cross-cannon/accounts/accounts.db'

    def test_database_and_all_sidecars_move_intact_and_rollback_preserves_new_data(self):
        for suffix in ['', '-wal', '-shm', '-journal']:
            Path(str(self.source) + suffix).write_bytes(('private' + suffix).encode())
        migration = activation.relocate_accounts(self.home, self.deploy)
        for suffix in ['', '-wal', '-shm', '-journal']:
            old = Path(str(self.source) + suffix)
            self.assertTrue(old.is_symlink())
            self.assertEqual(old.read_bytes(), ('private' + suffix).encode())
        self.assertIsNone(activation.relocate_accounts(self.home, self.deploy))
        self.destination.write_bytes(b'updated while new server ran')
        activation.restore_accounts(migration)
        self.assertEqual(self.source.read_bytes(), b'updated while new server ran')
        self.assertFalse(self.source.is_symlink())
        self.assertFalse(self.destination.exists())

    def test_existing_distinct_account_database_is_never_overwritten(self):
        self.source.write_text('legacy')
        self.destination.parent.mkdir(parents=True)
        self.destination.write_text('dedicated')
        with self.assertRaisesRegex(ValueError, 'Both legacy'):
            activation.relocate_accounts(self.home, self.deploy)
        self.assertEqual(self.source.read_text(), 'legacy')
        self.assertEqual(self.destination.read_text(), 'dedicated')

    def test_partial_move_failure_restores_the_original_database(self):
        self.source.write_text('original')
        original_chmod = Path.chmod
        destination = self.destination
        def fail_file_chmod(path, mode, **kwargs):
            if path == destination:
                raise OSError('simulated metadata failure')
            return original_chmod(path, mode, **kwargs)
        with patch.object(Path, 'chmod', fail_file_chmod):
            with self.assertRaisesRegex(OSError, 'metadata failure'):
                activation.relocate_accounts(self.home, self.deploy)
        self.assertEqual(self.source.read_text(), 'original')
        self.assertFalse(self.source.is_symlink())
        self.assertFalse(self.destination.exists())

    def test_unconfigured_accounts_create_no_database(self):
        self.assertIsNone(activation.relocate_accounts(self.home, self.deploy))
        self.assertFalse(self.destination.exists())

    def test_custom_account_path_and_rollback_are_preserved(self):
        custom = self.home / 'custom accounts.db'
        custom.write_text('custom')
        (self.home / '.ubuntu-env').write_text('UNRELATED_SECRET=do-not-print\nACCOUNTS_DATABASE_PATH="' + str(custom) + '"\n')
        migration = activation.relocate_accounts(self.home, self.deploy)
        self.assertTrue(custom.is_symlink())
        self.assertEqual(self.destination.read_text(), 'custom')
        activation.restore_accounts(migration)
        self.assertEqual(custom.read_text(), 'custom')
        self.assertFalse(custom.is_symlink())


if __name__ == '__main__':
    unittest.main()
