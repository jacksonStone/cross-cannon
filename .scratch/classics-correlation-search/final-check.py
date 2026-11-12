"""Run the final built service temporarily; always release its port/process."""
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

folder = Path(__file__).resolve().parent
origin = 'http://127.0.0.1:13012'
environment = {**os.environ, 'CROSS_CANON_DATA_DIR': str(Path.cwd()),
               'R_CROSS_CANNON_BIND': '127.0.0.1:13012'}
process = subprocess.Popen(['target/release/r-cross-cannon'], env=environment,
                           stdout=subprocess.DEVNULL)
try:
    for attempt in range(200):
        try:
            with urllib.request.urlopen(origin + '/r/api/health', timeout=1):
                break
        except OSError:
            assert process.poll() is None, 'Search service exited'
            time.sleep(.1)
    else:
        raise RuntimeError('Search service did not start')
    subprocess.run([sys.executable, str(folder / 'benchmark.py'), '--origin', origin,
                    '--baseline', str(folder / 'before.json'),
                    '--output', str(folder / 'after.json')], check=True)
    subprocess.run([sys.executable, str(folder / 'check-screenshot.py'), origin], check=True)
finally:
    process.terminate()
    process.wait(timeout=10)
