"""Read-only search latency regression loop; no query embedding/API calls."""
import argparse
import json
from pathlib import Path
import statistics
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--origin', default='http://127.0.0.1:13006')
parser.add_argument('--samples', type=int, default=3)
parser.add_argument('--max-ms', type=float, default=1000)
parser.add_argument('--output')
parser.add_argument('--baseline')
args = parser.parse_args()
request = json.loads(Path(__file__).with_name('request.json').read_text())
measurements = []
for corpus, authors in [('scripture', []), ('early-christian', []),
                        ('christian-classics', []),
                        ('christian-classics', ['Matthew Henry and continuators'])]:
    samples = []
    for i in range(args.samples):
        body = json.dumps({**request, 'corpus': corpus, 'authors': authors}).encode()
        start = time.perf_counter()
        with urllib.request.urlopen(urllib.request.Request(
                args.origin + '/r/api/search', data=body,
                headers={'Content-Type': 'application/json'}), timeout=60) as response:
            payload = json.load(response)
        elapsed = (time.perf_counter() - start) * 1000
        assert len(payload['results']) == request['limit'], payload
        samples.append(elapsed)
        print(f'{corpus} {authors} sample {i+1}: {elapsed:.1f} ms', flush=True)
    row = {'corpus': corpus, 'authors': authors, 'medianMs': statistics.median(samples), 'samplesMs': samples,
           'resultIds': [r.get('id', r.get('chapterId')) for r in payload['results']],
           'results': payload['results']}
    measurements.append(row)
if args.output:
    Path(args.output).write_text(json.dumps(measurements, indent=2) + '\n')
classic = measurements[-1]
if args.baseline:
    baseline = json.loads(Path(args.baseline).read_text())
    for before, after in zip(baseline, measurements):
        assert before['resultIds'] == after['resultIds'], 'Search ranking changed'
        assert [r['score'] for r in before['results']] == [r['score'] for r in after['results']], 'Search scores changed'
    speedup = baseline[-1]['medianMs'] / classic['medianMs']
    print(f'Exact IDs, order and scores preserved; Henry speedup {speedup:.2f}x')
    assert speedup >= 2, f'Expected at least 2x speedup, got {speedup:.2f}x'
else:
    assert classic['medianMs'] < args.max_ms, f"Classics median {classic['medianMs']:.1f} ms exceeds {args.max_ms} ms"
