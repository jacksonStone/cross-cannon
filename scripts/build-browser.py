"""Build the shared Rust reader for browsers from immutable text artifacts only.

No source downloads, database access, indexing, or production compilation.
Install wasm32-unknown-unknown and wasm-bindgen 0.2.130 explicitly beforehand.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'public/browser'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def inputs():
    paths = [ROOT/'Cargo.toml', ROOT/'Cargo.lock', ROOT/'scripture-cache/manifest.json',
             ROOT/'public/church-fathers-preview/manifest.json', ROOT/'public/church-fathers-preview/books.json',
             ROOT/'public/christian-classics-text/manifest.json', ROOT/'public/christian-classics-text/books.json',
             ROOT/'public/scripture-translations/msb.json', Path(__file__)]
    for folder in ['rust/core', 'rust/desktop', 'web']:
        paths += [p for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in {'.rs','.toml','.m','.ttf','.js','.css','.html'}]
    paths += [ROOT/'scripts/lib/native_catalog.py', ROOT/'scripts/precompress-browser.mjs']
    value = hashlib.sha256()
    for path in sorted(set(paths)):
        value.update(str(path.relative_to(ROOT)).encode()); value.update(bytes.fromhex(digest(path)))
    return value.hexdigest()

def valid_manifest():
    try:
        manifest = json.loads((OUTPUT/'manifest.json').read_text())
        for name, expected in manifest['files'].items():
            if digest(OUTPUT/name) != expected:
                return None
        if digest(ROOT/'public/cross-canon-rust-sw.js') != manifest['worker']:
            return None
        if gzip.decompress((OUTPUT/'manifest.json.gz').read_bytes()) != (OUTPUT/'manifest.json').read_bytes():
            return None
        return manifest
    except (OSError, ValueError, KeyError):
        return None

def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)

def main():
    existing = valid_manifest()
    # Prebuilt runtime packages intentionally omit compiler inputs. They carry
    # the exact tested browser artifact, with a receipt covering every file.
    if not (ROOT/'Cargo.toml').is_file():
        if existing:
            print('Validated prebuilt Rust browser artifact.'); return
        raise SystemExit('Missing/invalid prebuilt Rust browser artifact; build off-server first.')
    fingerprint = inputs()
    if existing and existing['source'] == fingerprint:
        print('Rust browser artifact matches current sources.'); return
    if '--check' in sys.argv:
        raise SystemExit('Rust browser artifact is stale. Run npm run build:browser.')
    candidates = [os.environ.get('WASM_BINDGEN'), shutil.which('wasm-bindgen')]
    candidates += [str(p) for p in (ROOT/'.tmp').glob('wasm-bindgen-0.2.130-*/wasm-bindgen')]
    bindgen = next((p for p in candidates if p and Path(p).is_file()), None)
    if not bindgen:
        raise SystemExit('Install wasm-bindgen-cli 0.2.130 (or set WASM_BINDGEN) before building the browser app.')
    version = subprocess.check_output([bindgen,'--version'], text=True).strip()
    if version != 'wasm-bindgen 0.2.130':
        raise SystemExit('Browser build requires wasm-bindgen 0.2.130; found ' + version)
    (ROOT/'.tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='browser-build-',dir=ROOT/'.tmp') as directory:
        staging = Path(directory)
        run(ROOT/'scripts/rust.sh','rustc','--crate-type','cdylib','--locked','--release','--lib','-p','cross-canon-desktop','--target','wasm32-unknown-unknown')
        run(bindgen,ROOT/'target/wasm32-unknown-unknown/release/cross_canon_desktop.wasm','--target','web','--out-dir',staging,'--out-name','reader')
        run(ROOT/'scripts/rust.sh','run','--locked','--release','-p','cross-canon-core','--example','package_browser','--',ROOT,staging)
        run(sys.executable,ROOT/'scripts/lib/native_catalog.py',ROOT,staging/'catalog.json')
        for source in (ROOT/'web').iterdir():
            if source.is_file(): shutil.copy2(source,staging/source.name)
        (staging/'fonts').mkdir()
        for name in ['SourceSerif4-Semibold.ttf','SourceSerif4-Bold.ttf']:
            shutil.copy2(ROOT/'rust/desktop/fonts'/name,staging/'fonts'/name)
        shutil.copy2(ROOT/'rust/desktop/fonts/Inter.ttf',staging/'fonts/Inter.ttf')
        archive = json.loads((staging/'archive.json').read_text())
        renamed = {}
        for path in sorted((staging/'chunks').iterdir()):
            relative = str(path.relative_to(staging))
            target = path.with_name(path.stem+'.'+digest(path)[:20]+path.suffix)
            path.rename(target)
            renamed[relative] = '/browser/'+str(target.relative_to(staging))
        for source in archive.values():
            source['text'] = renamed[source['text']]
            if source.get('reading'): source['reading'] = renamed[source['reading']]
        (staging/'archive.json').write_text(json.dumps(archive,separators=(',',':')))
        manifest = {'source':fingerprint,'version':fingerprint[:20]}
        for key, name in [('module','reader.js'),('wasm','reader_bg.wasm'),('library','library.bin'),('catalog','catalog.json'),('archive','archive.json')]:
            path = staging/name; hashed=path.stem+'.'+digest(path)[:20]+path.suffix
            path.rename(staging/hashed); manifest[key]='/browser/'+hashed
        worker = (ROOT/'web/service-worker.js').read_text().replace('__READER_VERSION__',manifest['version'])
        manifest['worker'] = hashlib.sha256(worker.encode()).hexdigest()
        # Runtime servers stream these build-time encodings without recompressing.
        # The compressed files are covered by the receipt, but are not separate
        # offline entries: Fetch decodes them into the original resource's cache.
        for path in list(staging.rglob('*')):
            if path.is_file() and path.suffix in {'.wasm','.js','.css','.json','.html','.ttf','.bin'}:
                raw = path.read_bytes()
                compressed = gzip.compress(raw, compresslevel=6, mtime=0)
                if len(compressed) < len(raw):
                    path.with_name(path.name+'.gz').write_bytes(compressed)
        run('node',ROOT/'scripts/precompress-browser.mjs',staging)
        manifest['files']={str(p.relative_to(staging)):digest(p) for p in staging.rglob('*') if p.is_file() and p.suffix != '.ts'}
        manifest['sizes']={str(p.relative_to(staging)):p.stat().st_size for p in staging.rglob('*') if p.is_file() and p.suffix != '.ts'}
        for path in staging.glob('*.ts'): path.unlink()
        (staging/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        # Its encoding is verified by exact decompressed equality to the receipt,
        # avoiding a self-referential hash inside manifest.files.
        (staging/'manifest.json.gz').write_bytes(gzip.compress((staging/'manifest.json').read_bytes(), compresslevel=6, mtime=0))
        # The manifest is outside its own receipt; gzip is validated above, and
        # its Brotli encoding is intentionally omitted to avoid circular hashes.
        if inputs() != fingerprint:
            raise SystemExit('Sources changed during browser build; retry before publishing.')
        # Publish only a complete build. Keep prior immutable assets available
        # for open tabs; deploy packaging may carry both versions safely.
        OUTPUT.mkdir(parents=True,exist_ok=True)
        keep = set(manifest['files']) | set((existing or {}).get('files', {})) | {'manifest.json', 'manifest.json.gz'}
        # A newly incompressible mutable asset must not retain an older encoding.
        keep -= {name for name in keep if name.endswith('.gz') and name[:-3] in manifest['files'] and name not in manifest['files']}
        for path in OUTPUT.rglob('*'):
            if path.is_file() and str(path.relative_to(OUTPUT)) not in keep:
                path.unlink()
        # A mutable file may stop benefiting from either compression format.
        # Never let a retained previous encoding shadow its new identity bytes.
        for relative in manifest['files']:
            if relative.endswith(('.gz', '.br')):
                continue
            for extension in ('.gz', '.br'):
                if relative + extension not in manifest['files']:
                    (OUTPUT / (relative + extension)).unlink(missing_ok=True)
        for path in staging.rglob('*'):
            if path.is_file() and path.name != 'manifest.json':
                target=OUTPUT/path.relative_to(staging);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
        shutil.copy2(staging/'manifest.json',OUTPUT/'manifest.json')
        worker = (ROOT/'web/service-worker.js').read_text().replace('__READER_VERSION__',manifest['version'])
        (ROOT/'public/cross-canon-rust-sw.js').write_text(worker)
        print('Rust browser build ready:',manifest['version'])

if __name__ == '__main__': main()
