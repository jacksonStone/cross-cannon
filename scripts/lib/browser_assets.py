"""Name the browser bootstrap graph by its bytes before publishing a release."""
import hashlib
import os
from pathlib import Path
import re


IMPORT = re.compile(r"(?P<prefix>\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(?P<quote>['\"])(?P<path>\.{1,2}/[^'\"]+\.js)(?P=quote)")


def version_assets(directory, version):
    root = Path(directory).resolve()
    renamed, visiting = {}, set()

    def rename(path, payload):
        target = path.with_name(path.stem + '.' + hashlib.sha256(payload).hexdigest()[:20] + path.suffix)
        target.write_bytes(payload)
        path.unlink()
        return target

    def javascript(path):
        path = path.resolve()
        if not path.is_relative_to(root):
            raise ValueError('Browser module is outside the release: ' + str(path))
        if path in renamed:
            return renamed[path]
        if path in visiting:
            raise ValueError('Cyclic browser bootstrap imports need bundling: ' + str(path))
        visiting.add(path)
        source = path.read_text().replace('__READER_VERSION__', version)

        def dependency(match):
            target = javascript(path.parent / match['path'])
            relative = os.path.relpath(target, path.parent).replace(os.sep, '/')
            if not relative.startswith('.'):
                relative = './' + relative
            return match['prefix'] + match['quote'] + relative + match['quote']

        source = IMPORT.sub(dependency, source)
        target = rename(path, source.encode())
        renamed[path] = target
        visiting.remove(path)
        return target

    urls = {}
    for path in list((root / 'fonts').glob('*.ttf')):
        urls['/browser/' + path.relative_to(root).as_posix()] = '/browser/' + rename(path, path.read_bytes()).relative_to(root).as_posix()
    style = root / 'reader.css'
    css = style.read_text()
    for old, new in urls.items():
        css = css.replace(old, new)
    style = rename(style, css.encode())
    start = javascript(root / 'start.js')
    urls.update({'/browser/start.js': '/browser/' + start.relative_to(root).as_posix(),
                 '/browser/reader.css': '/browser/' + style.relative_to(root).as_posix()})
    html = (root / 'index.html').read_text()
    for old, new in urls.items():
        html = html.replace(old, new)
    (root / 'index.html').write_text(html)
    shell = 'index.' + version + '.html'
    (root / shell).write_text(html)
    return {'start': urls['/browser/start.js'], 'style': urls['/browser/reader.css'], 'shell': '/browser/' + shell}
