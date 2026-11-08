"""Capture the apps' existing fresh-state QA presets; never save reader state."""
import os, pathlib, shutil, subprocess, time

root=pathlib.Path.cwd()
output=root/'docs/screenshots/cross-platform-2026-11-03'
report=root/'docs/test-reports/cross-platform-2026-11-03'
env={**os.environ,'DEVELOPER_DIR':'/Applications/Xcode.app/Contents/Developer'}
sim='E8E565D1-DC1B-4F37-AC82-547726509B99'
def simctl(*args,**kwargs):
    return subprocess.run(['xcrun','simctl',*args],env=env,**kwargs)
data=pathlib.Path(simctl('get_app_container',sim,'com.crosscanon.mobile','data',check=True,capture_output=True,text=True).stdout.strip())
scenes=[(p,p,'65400bc00676f9281b5b2eda') for p in ['search-results','jump','settings','reader']]
scenes += [(f'fathers-{p}',p,'anf09:xii.iv.i:1-3') for p in ['reader','jump','search']]
for label,preset,passage in scenes:
    existing=output/f'ios-{label}.png'
    if existing.exists() and existing.read_bytes().endswith(b'IEND\xaeB`\x82'): continue
    temporary=data/'tmp'/f'audit-{label}.png'
    if temporary.exists(): temporary.unlink()
    simctl('terminate',sim,'com.crosscanon.mobile',capture_output=True)
    launch={**env,'SIMCTL_CHILD_CROSS_CANON_FRESH':'1','SIMCTL_CHILD_CROSS_CANON_PREVIEW':preset,'SIMCTL_CHILD_CROSS_CANON_SCREENSHOT':str(temporary),'SIMCTL_CHILD_CROSS_CANON_PASSAGE':passage}
    subprocess.run(['xcrun','simctl','launch',sim,'com.crosscanon.mobile'],env=launch,check=True)
    for attempt in range(180):
        if temporary.exists() and temporary.read_bytes().endswith(b'IEND\xaeB`\x82'): break
        time.sleep(.25)
    else: raise RuntimeError(f'iOS screenshot timed out: {preset}')
    shutil.copyfile(temporary,output/f'ios-{label}.png')
    simctl('io',sim,'screenshot',str(output/f'ios-{label}-system.png'),check=True)
    print(f'Captured iOS {preset}',flush=True)
desktop_scenes=[(p,p,'65400bc00676f9281b5b2eda') for p in ['jump','settings']]
desktop_scenes += [(f'fathers-{p}',p,'anf09:xii.iv.i:1-3') for p in ['reader','jump','search']]
for label,preset,passage in desktop_scenes:
    existing=output/f'native-desktop-{label}.png'
    if existing.exists() and existing.read_bytes().endswith(b'IEND\xaeB`\x82'): continue
    with open(report/f'desktop-{label}-preview.log','w') as log:
        subprocess.run([str(root/'target/release/cross-canon-desktop')],env={**os.environ,'CROSS_CANON_FRESH':'1','CROSS_CANON_PREVIEW':preset,'CROSS_CANON_PASSAGE':passage,'CROSS_CANON_SCREENSHOT':str(output/f'native-desktop-{label}.png'),'CROSS_CANON_EXIT_AFTER_SCREENSHOT':'1'},stdout=log,stderr=log,check=True,timeout=60)
    print(f'Captured desktop {preset}',flush=True)
