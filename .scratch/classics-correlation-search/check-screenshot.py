"""Replay the exact Matthew Henry excerpt shown in the user's screenshot."""
import json
import sys
import urllib.request

origin = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:13006'
body = {'sourceId': 'ccw:dc669b7be67d792c4a6b5211', 'corpus': 'scripture',
        'mode': 'semantic', 'canon': 'orthodox', 'web': True, 'limit': 1}
with urllib.request.urlopen(urllib.request.Request(origin + '/r/api/search',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})) as response:
    source = json.load(response)['source']
print(source['reference'])
print(source['text'][:100])
assert source['reference'] == 'Commentary on the Whole Bible · Proverbs 16:1'
assert not source['text'].startswith('17.')
assert source['text'].endswith('a blessing.')
print('Exact screenshot excerpt has its real Scripture reference and complete source paragraph.')
