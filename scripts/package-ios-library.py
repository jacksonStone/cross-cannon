#!/usr/bin/env python3
"""Package all existing texts and audio metadata; audio downloads are opt-in. No DB access."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from lib.native_catalog import build_native_catalog

repo = Path(__file__).resolve().parent.parent
destination = Path(sys.argv[1]).resolve()
generated = any(repo / directory in destination.parents for directory in (".tmp", "dist", "target"))
if destination.name != "library" or not (generated or destination.parent.suffix == ".app"):
    raise SystemExit("Destination must be a generated library in .tmp, dist, target, or an app bundle.")
if destination == repo or destination in repo.parents or destination == repo / "library":
    raise SystemExit("Destination must be outside source data.")
manifest = json.loads((repo / "scripture-cache/manifest.json").read_text())
version = manifest["version"]
if not version or any(c not in "0123456789abcdefABCDEF" for c in version):
    raise SystemExit("Invalid scripture cache version")
sources = [Path("scripture-cache/manifest.json")]
# Native metadata points to the original MP3s for optional downloads/streaming.
# Recordings are intentionally excluded from the installation.
# An incomplete copy fails before replacing an existing generated library.
for source in sources:
    if not (repo / source).is_file():
        raise SystemExit(f"Missing existing artifact: {source}")
destination.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="native-library-", dir=destination.parent) as staging:
    staged = Path(staging) / "library"
    staged.mkdir()
    # Build the packer for the Mac, even when Xcode's other build is for iOS.
    env = dict(os.environ)
    env.pop("CARGO_BUILD_TARGET", None)
    subprocess.run([str(repo / "scripts/rust.sh"), "run", "--release", "--locked",
                    "-p", "cross-canon-core", "--example", "package_native", "--",
                    str(repo), str(staged / "native-library.bin"), "--original-bible-audio"], cwd=repo, env=env, check=True)
    (staged / 'catalog.json').write_text(json.dumps(build_native_catalog(repo), ensure_ascii=False,
                                                  separators=(',', ':')))
    for source in sources:
        output = staged / source
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / source, output)
    if destination.exists():
        shutil.rmtree(destination)
    staged.rename(destination)
size = sum(p.stat().st_size for p in destination.rglob("*") if p.is_file())
print(f"Bundled all texts and audio metadata, with no recordings ({size / 1e6:.1f} MB) in {destination}")
