#!/usr/bin/env python3
"""Package exactly the existing text/metadata artifacts; never generate data."""
import json
import shutil
import sys
from pathlib import Path

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
sources = [Path("scripture-cache/manifest.json"), Path(f"scripture-cache/{version}.json"),
           Path("public/continuous-audio.json")]
sources += [p.relative_to(repo) for p in (repo / "public/church-fathers-preview").rglob("*.json")]
# An incomplete copy fails before replacing an existing generated library.
for source in sources:
    if not (repo / source).is_file():
        raise SystemExit(f"Missing existing artifact: {source}")
if destination.exists():
    if destination.name != "library":
        raise SystemExit("Existing generated destination must be named library")
    shutil.rmtree(destination)
for source in sources:
    output = destination / source
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(repo / source, output)
print(f"Bundled {len(sources)} existing text/metadata files in {destination}")
