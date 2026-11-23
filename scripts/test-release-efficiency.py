"""Release reuse and unchanged-runtime regressions; local Git fixtures only."""
import importlib.util
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import struct
import tempfile
from contextlib import redirect_stdout
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


release = load('efficient_release', 'release-server.py')
inspection = load('release_inspection', 'inspect-server-release.py')


class PublishedBuildReuseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'checkout'
        self.root.mkdir()
        self.origin = Path(self.tmp.name) / 'origin.git'
        self.env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull}
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        files = ['Cargo.toml', 'Cargo.lock', 'rust/core/src/lib.rs',
                 '.github/workflows/rust-server-release.yml', 'deploy.sh',
                 'scripts/release-server.py', 'scripts/activate-server.py', 'scripts/test-server-release.py',
                 'scripts/build-rust-server-container.sh', 'scripts/fetch-rust-server-release.py',
                 'scripts/validate-rust-server-artifact.py', 'scripts/rust-server-build.test.mjs',
                 'scripts/inspect-server-release.py', 'scripts/test-release-efficiency.py']
        for name in files:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture\n')
        shutil.copyfile(ROOT / 'scripts/publish-rust-server-build.sh', self.root / 'scripts/publish-rust-server-build.sh')
        helper = ROOT / 'scripts/lib/release_inputs.py'
        if helper.exists():
            (self.root / 'scripts/lib').mkdir()
            shutil.copyfile(helper, self.root / 'scripts/lib/release_inputs.py')
        self.git('add', '.')
        self.git('commit', '-qm', 'Initial fixture')
        self.command('git', 'clone', '-q', '--bare', str(self.root), str(self.origin))
        self.git('remote', 'add', 'origin', str(self.origin))
        self.first = self.publish()

    def command(self, *args):
        result = subprocess.run(args, cwd=self.root, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def git(self, *args):
        return self.command('git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', *args)

    def publish(self):
        return self.command('bash', 'scripts/publish-rust-server-build.sh')

    def test_maintenance_commit_reuses_published_build_revision(self):
        (self.root / 'README.md').write_text('Maintenance documentation changed.\n')
        self.git('add', 'README.md')
        self.git('commit', '-qm', 'Maintenance only')
        self.git('push', '-q', 'origin', 'main')
        self.assertEqual(self.publish(), self.first, 'Unchanged Linux inputs must reuse the existing artifact revision')

    def test_recipe_change_publishes_a_new_build_revision(self):
        (self.root / 'scripts/build-rust-server-container.sh').write_text('Changed compiler flags.\n')
        self.assertNotEqual(self.publish(), self.first)

    def test_uncommitted_rust_changes_build_without_mutating_head_or_index(self):
        (self.root / 'rust/core/src/lib.rs').write_text('Changed Rust source.\n')
        self.git('add', 'rust/core/src/lib.rs')
        before = self.git('rev-parse', 'HEAD'), self.git('write-tree')
        revision = self.publish()
        self.assertNotEqual(revision, self.first)
        self.assertEqual((self.git('rev-parse', 'HEAD'), self.git('write-tree')), before)

    def test_workflow_policy_change_and_new_rust_file_invalidate_reuse(self):
        (self.root / '.github/workflows/rust-server-release.yml').write_text('Changed test policy.\n')
        second = self.publish()
        self.assertNotEqual(second, self.first)
        (self.root / 'rust/core/src/new.rs').write_text('New compiler input.\n')
        self.assertNotEqual(self.publish(), second)

    def test_uncommitted_dockerignore_add_edit_and_delete_match_published_inputs(self):
        from lib.release_inputs import binary_inputs
        path = self.root / '.dockerignore'
        path.write_text('storage/\n')
        added = self.publish()
        self.assertEqual(binary_inputs(self.root), binary_inputs(self.root, added))
        self.git('add', '.dockerignore')
        self.git('commit', '-qm', 'Track context policy')
        self.git('push', '-q', 'origin', 'main')
        path.write_text('storage/\n.tmp/\n')
        edited = self.publish()
        self.assertNotEqual(edited, added)
        self.assertEqual(binary_inputs(self.root), binary_inputs(self.root, edited))
        path.unlink()
        deleted = self.publish()
        self.assertNotEqual(deleted, edited)
        self.assertEqual(binary_inputs(self.root), binary_inputs(self.root, deleted))


class RuntimeReuseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, text in {
            'cross-cannon.service': 'Fixture unit',
            'public/browser/index.html': 'Fixture reader',
            'public/browser/manifest.json': '{}',
            'public/cross-canon-rust-sw.js': 'Fixture worker',
            'scripture-cache/manifest.json': '{}',
        }.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        (self.root / 'scripts').mkdir()
        shutil.copyfile(ROOT / 'scripts/validate-rust-server-artifact.py', self.root / 'scripts/validate-rust-server-artifact.py')
        self.source = {'rust/core/src/lib.rs': 'source'}
        self.build = {**self.source, 'recipe': 'pinned compiler, image and Linux tests'}
        self.revision = 'a' * 40
        self.addCleanup(patch.stopall)
        patch.object(release, 'ROOT', self.root).start()
        patch.object(release, 'compiler_inputs', return_value=self.source).start()
        patch.object(release, 'binary_inputs', return_value=self.build).start()
        self.snapshot = release.runtime_snapshot()
        self.state = {'intact': True, 'build_info': f'platform=linux/amd64\nsource_revision={self.revision}\n',
                      'receipt': {'fingerprint': 'receipt', 'artifact': {
                          **self.snapshot, 'files': {**self.snapshot['files'],
                          'app/bin/cross-cannon': 'binary hash', 'app/BUILD-INFO': 'provenance hash'}}}}
        self.events = []
        self.server = SimpleNamespace(ssh=lambda *args, **kwargs: self.events.append('ssh mutation'),
                                      upload=lambda *args: self.events.append('upload'))
        self.args = SimpleNamespace(ship=True, plan=False, force=False, build_only=False, build_local=False, revision=None)

    def test_only_exact_intact_runtime_is_unchanged(self):
        self.assertTrue(release.unchanged_runtime(self.snapshot, self.state))
        for field in ['compiler_inputs', 'build_inputs', 'files']:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.snapshot)
                changed[field]['changed'] = 'different'
                self.assertFalse(release.unchanged_runtime(changed, self.state))
        damaged = copy.deepcopy(self.state)
        damaged['intact'] = False
        self.assertFalse(release.unchanged_runtime(self.snapshot, damaged))
        invalid_recipe = copy.deepcopy(self.state)
        invalid_recipe['receipt']['artifact']['build_inputs'] = {'unknown': 'recipe'}
        self.assertFalse(release.unchanged_runtime(self.snapshot, invalid_recipe))
        stale = copy.deepcopy(self.state)
        stale['receipt']['artifact']['files']['app/public/old.json'] = 'extra'
        self.assertFalse(release.unchanged_runtime(self.snapshot, stale))

    def test_legacy_receipt_requires_verified_provenance_and_matching_recipe(self):
        old = copy.deepcopy(self.state)
        del old['receipt']['artifact']['build_inputs']
        self.assertTrue(release.unchanged_runtime(self.snapshot, old))
        with patch.object(release, 'binary_inputs', return_value={'old': 'recipe'}):
            self.assertFalse(release.unchanged_runtime(self.snapshot, old))
        old['build_info'] = 'platform=linux/amd64\nsource_revision=untrusted\n'
        self.assertFalse(release.unchanged_runtime(self.snapshot, old))

    def test_runtime_file_edits_and_missing_generated_assets_force_release(self):
        (self.root / 'public/browser/index.html').write_text('Changed reader')
        self.assertFalse(release.unchanged_runtime(release.runtime_snapshot(), self.state))
        (self.root / 'public/browser/index.html').unlink()
        self.assertFalse(release.unchanged_runtime(release.runtime_snapshot(), self.state))
        with self.assertRaisesRegex(ValueError, 'Missing runtime file'):
            release.runtime_files()

    def test_planning_still_rejects_private_files_and_links(self):
        secret = self.root / 'public/hidden.sqlite'
        secret.write_text('private')
        with self.assertRaisesRegex(ValueError, 'Runtime data'):
            release.runtime_snapshot()
        secret.unlink()
        secret.symlink_to(self.root / 'cross-cannon.service')
        with self.assertRaisesRegex(ValueError, 'link'):
            release.runtime_snapshot()

    def run_release(self, states=None, run=None, current=True):
        shared = SimpleNamespace(Server=lambda: self.server)
        with patch.object(release, 'module', return_value=shared), \
                patch.object(release, 'remote_state', side_effect=states or [self.state, self.state]), \
                patch.object(release, 'browser_current', return_value=current), \
                patch.object(release.subprocess, 'run', side_effect=run), redirect_stdout(io.StringIO()):
            return release.release(self.args)

    def test_unchanged_ship_runs_tooling_but_no_build_archive_upload_or_restart(self):
        commands = []
        self.assertEqual(self.run_release(run=lambda args, **kw: commands.append(args)), 'unchanged')
        self.assertEqual(commands, [['npm', 'run', 'test:unit'], ['npm', 'run', 'typecheck']])
        self.assertEqual(self.events, [])
        self.assertEqual(list((self.root / '.tmp').glob('*.tar.gz')), [])

    def test_plan_is_read_only_and_force_disables_skip(self):
        self.args.plan = True
        commands = []
        self.assertEqual(self.run_release(run=lambda args, **kw: commands.append(args)), 'unchanged')
        self.args.force = True
        self.assertEqual(self.run_release(run=lambda args, **kw: commands.append(args)), 'changed')
        self.assertEqual(commands, [])
        self.assertEqual(self.events, [])

    def test_explicit_mismatched_revision_is_rejected_even_when_runtime_matches(self):
        self.args.revision = 'b' * 40
        def inputs(revision=None):
            return {'old': 'recipe'} if revision == self.args.revision else self.build
        with patch.object(release, 'binary_inputs', side_effect=inputs):
            with self.assertRaisesRegex(ValueError, 'does not match'):
                self.run_release()
        self.assertEqual(self.events, [])

    def test_tooling_failure_and_concurrent_remote_change_never_mutate_production(self):
        def fail(*args, **kwargs):
            raise subprocess.CalledProcessError(1, 'test:unit')
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_release(run=fail)
        changed = copy.deepcopy(self.state)
        changed['intact'] = False
        with self.assertRaisesRegex(ValueError, 'changed during verification'):
            self.run_release(states=[self.state, changed])
        self.assertEqual(self.events, [])

    def test_concurrent_local_change_cannot_receive_a_skip(self):
        def edit(*args, **kwargs):
            (self.root / 'public/browser/index.html').write_text('Changed during tests')
        with self.assertRaisesRegex(ValueError, 'changed during verification'):
            self.run_release(run=edit)
        self.assertEqual(self.events, [])

    def test_linux_build_starts_before_verification_and_is_fetched_only_after_success(self):
        self.args.build_only = True
        events = []
        def start(*args, **kwargs):
            events.append('start CI')
            return self.revision
        def command(args, **kwargs):
            events.append('verify' if args[:3] == ['npm', 'run', 'verify'] else 'fetch')
        def package(artifact, archive, *args):
            events.append('package')
            archive.write_bytes(b'fixture')
        with patch.object(release, 'cached_artifact', return_value=None), \
                patch.object(release.subprocess, 'check_output', side_effect=start), \
                patch.object(release, 'package_artifact', side_effect=package):
            self.assertEqual(self.run_release(run=command, current=False), 'packaged')
        self.assertEqual(events, ['start CI', 'verify', 'fetch', 'package'])

    def test_failed_full_verification_never_fetches_packages_or_uploads(self):
        commands = []
        def fail(args, **kwargs):
            commands.append(args)
            raise subprocess.CalledProcessError(1, args)
        with patch.object(release, 'cached_artifact', return_value=None), \
                patch.object(release, 'reusable_revision', return_value=self.revision), \
                patch.object(release, 'package_artifact') as package:
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_release(run=fail, current=False)
            package.assert_not_called()
        self.assertEqual(commands, [['npm', 'run', 'verify']])
        self.assertEqual(self.events, [])

    def test_cached_binary_must_match_recipe_checksums_revision_and_architecture(self):
        artifact = self.root / '.tmp/rust-server-linux-fixture/binary'
        (artifact / 'target/release').mkdir(parents=True)
        binary = bytearray(20)
        binary[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<H', binary, 18, 62)
        (artifact / 'target/release/r-cross-cannon').write_bytes(binary)
        (artifact / 'BUILD-INFO').write_text(self.state['build_info'])
        checksum = artifact / 'SHA256SUMS'
        checksum.write_text(''.join(hashlib.sha256((artifact / name).read_bytes()).hexdigest() + '  ' + name + '\n'
                                   for name in ['BUILD-INFO', 'target/release/r-cross-cannon']))
        self.assertEqual(release.cached_artifact(self.build), (artifact, self.revision))
        self.assertIsNone(release.cached_artifact({'different': 'recipe'}))
        self.assertIsNone(release.cached_artifact(self.build, 'b' * 40))
        (artifact / 'target/release/r-cross-cannon').write_bytes(b'corrupt')
        self.assertIsNone(release.cached_artifact(self.build))

    def test_runtime_mutation_while_waiting_for_ci_prevents_packaging(self):
        self.args.build_only = True
        def command(args, **kwargs):
            if 'scripts/fetch-rust-server-release.py' in ' '.join(args):
                (self.root / 'public/browser/index.html').write_text('Unverified asset')
        with patch.object(release, 'cached_artifact', return_value=None), \
                patch.object(release.subprocess, 'check_output', return_value=self.revision), \
                patch.object(release, 'package_artifact') as package:
            with self.assertRaisesRegex(ValueError, 'changed after verification'):
                self.run_release(run=command, current=False)
            package.assert_not_called()

    def test_ship_verifies_production_even_when_release_is_unchanged(self):
        with patch('sys.argv', ['release-server.py', '--ship']), \
                patch.object(release, 'release', return_value='unchanged'), \
                patch.object(release.tempfile, 'gettempdir', return_value=str(self.root)), \
                patch.object(release.subprocess, 'run') as command, \
                patch.dict(os.environ), redirect_stdout(io.StringIO()):
            release.main()
            command.assert_called_once_with(['npm', 'run', 'verify-prod'], cwd=self.root, check=True)


class ActiveReleaseInspectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.deploy = self.home / '.workspace-deploy'
        self.release = self.deploy / 'releases/cross-cannon/fixture'
        self.release.mkdir(parents=True)
        (self.deploy / 'state').mkdir()
        (self.deploy / 'lock').touch()
        files = {}
        for name in ['unit.service', 'app/bin/cross-cannon', 'app/BUILD-INFO', 'app/public/reader.json']:
            path = self.release / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('Fixture ' + name)
            files[name] = inspection.file_hash(path)
        self.receipt = {'service': 'cross-cannon', 'runtime': 'rust', 'release': str(self.release),
                        'artifact': {'platform': 'linux/amd64', 'runtime': 'rust', 'files': files}}
        (self.deploy / 'state/cross-cannon.json').write_text(json.dumps(self.receipt))
        (self.home / 'cross-cannon').symlink_to(self.release / 'app')
        self.unit = self.home / 'installed-unit.service'
        shutil.copyfile(self.release / 'unit.service', self.unit)

    def inspect(self, token=None):
        return inspection.inspect_release(self.deploy, token, self.unit)

    def test_intact_release_is_checked_without_modifying_receipt(self):
        before = (self.deploy / 'state/cross-cannon.json').read_bytes()
        state = self.inspect()
        self.assertTrue(state['intact'])
        self.assertEqual(state['receipt'], self.receipt)
        self.assertEqual((self.deploy / 'state/cross-cannon.json').read_bytes(), before)

    def test_changed_missing_linked_and_extra_static_files_prevent_skip(self):
        path = self.release / 'app/public/reader.json'
        original = path.read_bytes()
        path.write_text('Corrupted after deployment')
        self.assertFalse(self.inspect()['intact'])
        path.unlink()
        self.assertFalse(self.inspect()['intact'])
        path.symlink_to(self.release / 'app/BUILD-INFO')
        self.assertFalse(self.inspect()['intact'])
        path.unlink()
        path.write_bytes(original)
        (path.parent / 'unexpected.json').write_text('Unrecorded file')
        self.assertFalse(self.inspect()['intact'])

    def test_unexpected_active_link_is_not_unchanged(self):
        (self.home / 'cross-cannon').unlink()
        (self.home / 'cross-cannon').symlink_to(self.release)
        self.assertFalse(self.inspect()['intact'])

    def test_metadata_recheck_requires_prior_byte_proof_and_detects_restored_mtime(self):
        state = self.inspect()
        token = state['integrity_token']
        with patch.object(inspection, 'file_hash', side_effect=AssertionError('Must not rehash unchanged files')):
            self.assertTrue(self.inspect(token)['intact'])
        self.assertFalse(self.inspect('wrong token')['intact'])
        path = self.release / 'app/public/reader.json'
        old = path.stat()
        raw = path.read_bytes()
        path.write_bytes(b'x' * len(raw))
        os.utime(path, ns=(old.st_atime_ns, old.st_mtime_ns))
        self.assertFalse(self.inspect(token)['intact'])

    def test_full_inspection_checks_bytes_even_when_metadata_is_stable(self):
        with patch.object(inspection, 'file_hash', return_value='wrong hash'):
            self.assertFalse(self.inspect()['intact'])

    def test_installed_service_unit_drift_prevents_skip(self):
        token = self.inspect()['integrity_token']
        self.unit.write_text('Different ExecStart or memory policy')
        self.assertFalse(self.inspect()['intact'])
        self.assertFalse(self.inspect(token)['intact'])


if __name__ == '__main__':
    unittest.main()
