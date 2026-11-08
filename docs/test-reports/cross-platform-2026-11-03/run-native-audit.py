"""Run audit assertions in a disposable source copy; three failures are expected."""
import os, pathlib, shutil, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[3]
stage=pathlib.Path(tempfile.mkdtemp(prefix='crosscanon-audit-',dir='/private/tmp'))
for part in ['core','desktop']:
    shutil.copytree(root/'rust'/part,stage/'rust'/part)
(stage/'Cargo.toml').write_text((root/'Cargo.toml').read_text().replace('"rust/core", "rust/api", "rust/desktop"','"rust/core", "rust/desktop"'))
shutil.copy2(root/'Cargo.lock',stage/'Cargo.lock')
for part in ['public','scripture-cache','data','storage']:
    (stage/part).symlink_to(root/part,target_is_directory=True)
source=stage/'rust/desktop/src/lib.rs'
source.write_text(source.read_text()+'\n'+pathlib.Path(__file__).with_name('audit-native.rs').read_text())
print(f'Audit-only source copy: {stage}',flush=True)
result=subprocess.run([str(root/'scripts/rust.sh'),'test','--manifest-path',str(stage/'Cargo.toml'),'--offline','-p','cross-canon-desktop','audit_20261103','--','--nocapture'],cwd=root,env={**os.environ,'CARGO_TARGET_DIR':str(root/'target')})
raise SystemExit(result.returncode)
