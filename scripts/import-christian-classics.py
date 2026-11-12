#!/usr/bin/env python3
"""Explicit, reproducible text import. Never touches a database or calls a model."""
from pathlib import Path
from xml.etree import ElementTree as ET
import argparse, concurrent.futures, hashlib, importlib.util, json, re, urllib.request
from classics_modernization import apply_overlay, load_overlays

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data/public-domain/christian-classics"
OUT = ROOT / "public/christian-classics-text"
spec = importlib.util.spec_from_file_location(
    "fathers_parser", ROOT / "scripts/parse-church-fathers.py"
)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
clean = shared.clean_text
BOOK_NAMES = (
    "Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation"
).split("|")
BOOK_CODES = "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev".split()
BOOKS = dict(zip(BOOK_CODES, BOOK_NAMES))
ROMAN = re.compile(r"^[IVXLCDM]+$")


def roman(text):
    if not ROMAN.fullmatch(text):
        return None
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    return sum(
        (
            -values[c]
            if i + 1 < len(text) and values[c] < values[text[i + 1]]
            else values[c]
        )
        for i, c in enumerate(text)
    )


def text(element):
    return clean(shared.element_text(element))


def sentences(paragraphs):
    # Same sentence splitter as the Fathers import, retaining short sentences too.
    result = []
    for paragraph_number, paragraph in enumerate(paragraphs, 1):
        for item in shared.SENTENCE_END_RE.sub(
            r"\1\n", shared.protect_abbreviations(paragraph)
        ).splitlines():
            value = clean(item.replace(shared.PERIOD_PLACEHOLDER, "."))
            if value:
                result.append({"verse": len(result) + 1, "text": value, "sourceParagraph": paragraph_number})
    return result


def paragraphs(element):
    return [text(p) for p in shared.iter_paragraphs(element) if text(p)]


def notes(element):
    return [
        {"id": n.get("id", f"note-{i+1}"), "text": clean("".join(n.itertext()))}
        for i, n in enumerate(element.iter("note"))
    ]


def chapter(
    code,
    number,
    title,
    content,
    *,
    reference=None,
    lineage=None,
    footnotes=None,
    ranges=None,
):
    return {
        "code": code,
        "number": number,
        "title": title,
        "paragraphs": content,
        "reference": reference or f"{BOOKS.get(code,code)} {number}",
        "lineage": lineage or [],
        "notes": footnotes or [],
        "ranges": ranges or [],
    }


def commentary_paragraphs(element, *, osis=False):
    parents = {child: parent for parent in element.iter() for child in parent}
    # Henry IV places empty scripCom markers before their Commentary divs,
    # unlike the enclosing Bible:<range> divs used in the other volumes.
    sibling_ranges = {}
    for parent in element.iter():
        pending = None
        for child in parent:
            if child.tag == "scripCom":
                numbers = [
                    int(n)
                    for n in re.findall(
                        r"[1-3]?[A-Za-z]+\.\d+\.(\d+)", child.get("osisRef", "")
                    )
                ]
                pending = [min(numbers), max(numbers)] if numbers else None
            elif child.tag == "div" and child.get("class", "").lower() == "commentary":
                if pending:
                    sibling_ranges[child] = pending
                pending = None
            else:
                pending = None
    content = []
    ranges = []
    for p in shared.iter_paragraphs(element):
        value = clean("".join(p.itertext())) if osis else text(p)
        if not value:
            continue
        ancestor = p
        scripture_range = None
        while ancestor is not None:
            if ancestor in sibling_ranges:
                scripture_range = sibling_ranges[ancestor]
                break
            reference = ancestor.get("annotateRef", "") or ancestor.get("id", "")
            if ancestor.get("annotateType") == "commentary" or reference.startswith(
                "Bible:"
            ):
                numbers = [
                    int(n)
                    for n in re.findall(r"[1-3]?[A-Za-z]+\.\d+\.(\d+)", reference)
                ]
                if numbers:
                    scripture_range = [min(numbers), max(numbers)]
                    break
            ancestor = parents.get(ancestor)
        content.append(value)
        ranges.append(scripture_range)
    return content, ranges


def imitation():
    raw = (SOURCE / "raw/imitation.txt").read_text().replace("\r", "")
    body = raw[
        raw.index("\nTHE FIRST BOOK\n") : raw.index("*** END OF THE PROJECT GUTENBERG")
    ]
    books = list(
        re.finditer(r"^THE (FIRST|SECOND|THIRD|FOURTH) BOOK[^\n]*$", body, re.M)
    )
    result = []
    for book_index, match in enumerate(books):
        block = body[
            match.end() : (
                books[book_index + 1].start()
                if book_index + 1 < len(books)
                else len(body)
            )
        ]
        chapters = list(re.finditer(r"^CHAPTER ([IVXLCDM]+)\s*$", block, re.M))
        for i, m in enumerate(chapters):
            value = block[
                m.end() : (
                    chapters[i + 1].start() if i + 1 < len(chapters) else len(block)
                )
            ].strip()
            title, *parts = re.split(r"\n\s*\n", value)
            content = []
            footnotes = []
            for part in parts:
                value = clean(part)
                if not value:
                    continue
                if re.match(r"^\(\d+\)", value):
                    footnotes.append({"id": f"notes-{len(footnotes)+1}", "text": value})
                    continue
                # Plain-text italic markers are formatting, not words. Keep note markers.
                content.append(re.sub(r"^\d+\.\s+", "", value).replace("_", ""))
            n = roman(m.group(1))
            result.append(
                chapter(
                    f"book-{book_index+1}",
                    n,
                    clean(title),
                    content,
                    reference=f"Book {book_index+1} · Chapter {n}",
                    lineage=[f"Book {book_index+1}"],
                    footnotes=footnotes,
                )
            )
    assert len(result) == 114, f"Imitation coverage changed: {len(result)}"
    return result


def henry():
    result = []
    for volume in range(1, 7):
        root = ET.parse(SOURCE / f"raw/mhc{volume}.xml").getroot()
        assert "Public domain" in root.find(".//DC.Rights").text
        for book in root.iter("div1"):
            for div in book.findall("div2"):
                heading = div.get("title", "")
                if not heading.startswith("Chapter "):
                    continue
                number = roman(heading.removeprefix("Chapter ").strip())
                marker = next(
                    (s for s in div.iter("scripCom") if s.get("parsed")), None
                )
                if (
                    marker is None
                ):  # A handful of chapters omit scripCom; the enclosing book id is stable.
                    code = book.get("id")
                else:
                    code = marker.get("parsed").split("|")[1]
                assert code in BOOKS and number, (volume, code, heading)
                content, ranges = commentary_paragraphs(div)
                result.append(
                    chapter(
                        code,
                        number,
                        f"{BOOKS[code]} {number}",
                        content,
                        footnotes=notes(div),
                        ranges=ranges,
                    )
                )
    assert (
        len(result) == 1189 and len({x["code"] for x in result}) == 66
    ), f"Henry coverage changed: {len(result)}"
    return result


def wesley():
    root = ET.parse(SOURCE / "raw/wesley.xml").getroot()
    assert root.find(".//DC.Rights").text.strip() == "Public Domain"
    result = []
    for book in root.iter("div2"):
        markers = [
            s.get("parsed", "").split("|")
            for s in book.iter("scripCom")
            if s.get("parsed")
        ]
        if not markers and "OBADIAH" not in book.get("title", ""):
            continue
        code = markers[0][1] if markers else "Obad"
        if code not in BOOKS:
            continue
        chapters = {}
        chapter_ranges = {}
        current = 1 if code in ["Obad", "Phlm", "2John", "3John", "Jude"] else None
        current_range = None

        def walk(node):
            nonlocal current, current_range
            tag = node.tag
            if tag == "note":
                return
            heading = clean(node.get("title", ""))
            heading = re.sub(r"^PSALM\s+", "", heading, flags=re.I)
            if tag == "div3" and roman(heading):
                current = roman(heading)
                current_range = None
            if tag == "div3" and heading.isdigit():
                current = int(heading)
                current_range = None
            if tag == "p":
                value = text(node)
                # Source defect: Proverbs XI–XXX are p headings nested under chapter X.
                if code == "Prov" and roman(value) in range(11, 31):
                    current = roman(value)
                    current_range = None
                    return
                if current and value:
                    marker = re.match(r"^(\d+)(?:\s*[-–]\s*(\d+))?\.\s", value)
                    if marker and not node.get("class", "").lower().startswith("list"):
                        current_range = [
                            int(marker.group(1)),
                            int(marker.group(2) or marker.group(1)),
                        ]
                    chapters.setdefault(current, []).append(value)
                    chapter_ranges.setdefault(current, []).append(current_range)
                return
            for child in node:
                walk(child)

        walk(book)
        for number, content in sorted(chapters.items()):
            result.append(
                chapter(
                    code,
                    number,
                    f"{BOOKS[code]} {number}",
                    content,
                    ranges=chapter_ranges[number],
                )
            )
    assert (
        len(result) == 1188 and len({x["code"] for x in result}) == 66
    ), f"Wesley coverage changed: {len(result)}"
    assert len([x for x in result if x["code"] == "Prov"]) == 31
    return result


def catena():
    raw = (SOURCE / "raw/catena.xml").read_text()
    # Upstream commit aebb0f6 has one extra closing p. Fail if the documented fix drifts.
    broken = "saying, My God shall be my strength. And he said, &amp;c.</p>\n</p><p>"
    assert raw.count(broken) == 1
    raw = raw.replace(
        broken, "saying, My God shall be my strength. And he said, &amp;c.</p>\n<p>"
    )
    root = ET.fromstring(raw)
    for el in root.iter():
        el.tag = el.tag.rsplit("}", 1)[-1]
    result = []
    for div in root.iter("chapter"):
        code, num = div.get("osisID").split(".")
        content, ranges = commentary_paragraphs(div, osis=True)
        result.append(
            chapter(code, int(num), f"{BOOKS[code]} {num}", content, ranges=ranges)
        )
    assert len(result) == 89 and {x["code"] for x in result} == {
        "Matt",
        "Mark",
        "Luke",
        "John",
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((SOURCE / "sources.json").read_text())

    def source(item):
        target = SOURCE / "raw" / item["file"]
        if args.download:
            target.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(item["url"], timeout=90) as response:
                data = response.read()
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError(f"Upstream source changed: {item['file']}")
            target.write_bytes(data)
        assert (
            hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"]
        ), f"Source hash mismatch: {target}"

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(source, manifest["sources"]))
    specs = [
        (
            "imitation",
            "The Imitation of Christ",
            "Thomas à Kempis",
            "15th century",
            "Spiritual Reading",
            "Catholic",
            "William Benham",
            "Historic Benham translation",
            "Public domain in the USA",
            "https://www.gutenberg.org/ebooks/1653",
            imitation,
        ),
        (
            "catena",
            "Catena Aurea",
            "Thomas Aquinas",
            "13th century",
            "Commentaries",
            "Catholic",
            "Oxford translation edited by J. H. Newman",
            "1841–1845 translation; John preface supplied under CC0",
            "Public-domain historic translation; repository contributions CC0-1.0",
            "https://github.com/Isidore-Guild/catena",
            catena,
        ),
        (
            "henry",
            "Commentary on the Whole Bible",
            "Matthew Henry and continuators",
            "18th century",
            "Commentaries",
            "Reformed",
            None,
            "Complete six-volume CCEL text",
            "Public domain. May be copied and distributed freely.",
            "https://www.ccel.org/ccel/henry/mhc.html",
            henry,
        ),
        (
            "wesley",
            "Notes on the Bible",
            "John Wesley",
            "18th century",
            "Commentaries",
            "Methodist",
            None,
            "CCEL edition; source omits 2 Samuel 24",
            "Public Domain",
            "https://www.ccel.org/ccel/wesley/notes.html",
            wesley,
        ),
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "chapters").mkdir(exist_ok=True)
    books = []
    provenance = []
    overlays = load_overlays(SOURCE / "modernization")
    applied_overlays = set()
    for (
        slug,
        title,
        author,
        date,
        genre,
        tradition,
        translator,
        edition,
        rights,
        url,
        parse,
    ) in specs:
        work_id = f"classics:{slug}"
        metadata = {
            "author": author,
            "authorshipDateRange": date,
            "genre": genre,
            "tradition": tradition,
            "translator": translator,
            "edition": edition,
            "rights": rights,
            "source": {
                "id": slug,
                "provider": (
                    "Project Gutenberg"
                    if slug == "imitation"
                    else "Isidore Guild" if slug == "catena" else "CCEL"
                ),
                "sourceUrl": url,
                "title": title,
            },
        }
        classification = {
            "bucket": f"Christian Classics / {genre}",
            "canonicalStatus": "noncanonical",
            "contentKind": "commentary" if genre == "Commentaries" else "primary",
            "cautionReason": "",
            "doctrinalStatus": "historical",
            "labels": ["christian-classics", genre.lower()],
            "severity": 0,
        }
        summaries = []
        for value in parse():
            chapter_id = f"{work_id}:{value['code']}.{value['number']}"
            verses = sentences(value["paragraphs"])
            if value["ranges"]:
                position = 0
                assert len(value["paragraphs"]) == len(value["ranges"])
                for paragraph, scripture_range in zip(
                    value["paragraphs"], value["ranges"]
                ):
                    count = len(sentences([paragraph]))
                    if scripture_range:
                        for verse in verses[position : position + count]:
                            verse["scriptureVerseStart"], verse["scriptureVerseEnd"] = (
                                scripture_range
                            )
                    position += count
            assert verses, f"Empty chapter {chapter_id}"
            asset = {
                "author": author,
                "book": title,
                "chapter": len(summaries) + 1,
                "classification": classification,
                "id": chapter_id,
                "lineage": value["lineage"],
                "metadata": metadata,
                "originalBook": BOOKS.get(value["code"]),
                "sourceVolumeId": slug,
                "source": {"id": slug, "sourceUrl": url, "title": title},
                "title": value["title"],
                "reference": value["reference"],
                "notes": value["notes"],
                "verses": verses,
            }
            if genre == "Commentaries":
                asset["scriptureReference"] = {
                    "book": BOOKS[value["code"]],
                    "chapter": value["number"],
                }
            if apply_overlay(asset, work_id, overlays):
                applied_overlays.add((work_id, chapter_id))
            encoded = json.dumps(
                asset, ensure_ascii=False, separators=(",", ":")
            ).encode()
            digest = hashlib.sha256(encoded).hexdigest()[:16]
            filename = f"{chapter_id.replace(':','_')}.{digest}.json"
            asset_path = f"/christian-classics-text/chapters/{filename}"
            target = OUT / "chapters" / filename
            if target.exists() and target.read_bytes() != encoded:
                raise ValueError(f"Content hash collision: {target}")
            if not target.exists():
                target.write_bytes(encoded)
            summaries.append(
                {key: asset[key] for key in ["id", "title", "chapter", "reference"]}
                | {"assetPath": asset_path, "verseCount": len(verses)}
                | (
                    {"scriptureReference": asset["scriptureReference"]}
                    if "scriptureReference" in asset
                    else {}
                )
            )
        books.append(
            {
                "author": author,
                "book": title,
                "chapters": summaries,
                "classification": classification,
                "id": work_id,
                "metadata": metadata,
                "name": title,
            }
        )
        provenance.append(
            {
                "id": work_id,
                "chapterCount": len(summaries),
                "source": url,
                "rights": rights,
                "knownSourceGaps": ["2 Samuel 24"] if slug == "wesley" else [],
            }
        )
        print(f"{title}: {len(summaries)} chapters")
    if set(overlays) != applied_overlays:
        raise ValueError(f"Unknown overlay chapters: {set(overlays) - applied_overlays}")
    index = {
        "books": books,
        "defaultWorkId": "classics:imitation",
        "source": "Christian Classics · verified historical English editions",
        "generatedAt": "2026-11-11T00:00:00.000Z",
    }
    payload = json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode()
    version = hashlib.sha256(payload).hexdigest()[:16]
    (OUT / "books.json").write_bytes(payload)
    (OUT / "manifest.json").write_text(
        json.dumps(
            {
                "bookCount": len(books),
                "bookIndexPath": "/christian-classics-text/books.json",
                "chapterCount": sum(len(b["chapters"]) for b in books),
                "generatedAt": index["generatedAt"],
                "source": index["source"],
                "version": version,
            },
            indent=2,
        )
        + "\n"
    )
    (SOURCE / "import-report.json").write_text(
        json.dumps({"version": version, "works": provenance}, indent=2) + "\n"
    )
    print(f"Wrote {OUT}; version {version}")


if __name__ == "__main__":
    main()
