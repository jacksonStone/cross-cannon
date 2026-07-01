#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


DEFAULT_INPUT_DIR = Path("data/public-domain/church-fathers/ccel/raw/xml")
DEFAULT_OUTPUT = Path("data/public-domain/church-fathers/ccel/parsed/church-fathers.json")

SKIP_INLINE_TAGS = {"note", "index", "pb"}
EDITORIAL_PATTERNS = [
    r"\btitle page\b",
    r"\btable of contents\b",
    r"\bcontents\b",
    r"\bsubject index",
    r"\bindexes?\b",
    r"\bbibliograph",
    r"\bprolegomena\b",
    r"\belucidations?\b",
    r"\bintroductory (note|notice)\b",
    r"\btranslator[’']?s preface\b",
    r"\beditor[’']?s preface\b",
    r"\bpreface by the editor\b",
    r"\badvertisement\b",
    r"\bopinion of st\.? augustin\b",
]
EDITORIAL_RE = re.compile("|".join(EDITORIAL_PATTERNS), re.IGNORECASE)
DIV_RE = re.compile(r"^div\d*$")
BOOK_RE = re.compile(
    r"^\s*book\s+([ivxlcdm]+|\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b",
    re.IGNORECASE,
)
CHAPTER_RE = re.compile(r"^\s*(chapter|chap\.|homily|sermon)\b", re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
SENTENCE_END_RE = re.compile(r"(?<=[.!?])([\"”’)\]]*)\s+(?=[\"“‘([]?[A-Z0-9])")

ABBREVIATIONS = [
    "A.D.",
    "B.C.",
    "e.g.",
    "i.e.",
    "etc.",
    "St.",
    "Dr.",
    "Mr.",
    "Mrs.",
    "Rev.",
    "Prof.",
    "Vol.",
    "No.",
    "viz.",
]
PERIOD_PLACEHOLDER = "∯"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse CCEL Early Church Fathers ThML/XML into JSON grouped by works, chapters, and sentence verses."
    )
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--indent", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None, help="Parse only the first N XML files.")
    args = parser.parse_args()

    xml_files = sorted(args.input_dir.glob("*.xml"))
    if args.limit is not None:
        xml_files = xml_files[: args.limit]

    if not xml_files:
        print(f"No XML files found in {args.input_dir}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)

    with args.output.open("w", encoding="utf-8") as handle:
        handle.write("{\n")
        write_json_field(handle, "source", "CCEL Early Church Fathers ThML/XML", indent=2)
        handle.write(",\n")
        write_json_field(handle, "generatedAt", datetime.now(timezone.utc).isoformat(), indent=2)
        handle.write(",\n")
        write_json_field(handle, "inputDir", str(args.input_dir), indent=2)
        handle.write(",\n")
        handle.write('  "volumes": [\n')

        for index, xml_file in enumerate(xml_files):
            volume = parse_volume(xml_file)
            if index:
                handle.write(",\n")
            handle.write(indent_json(volume, base_indent=4, indent=args.indent))
            print(
                f"{xml_file.name}: {len(volume['works'])} works, "
                f"{sum(len(work['chapters']) for work in volume['works'])} chapters",
                file=sys.stderr,
            )

        handle.write("\n  ]\n")
        handle.write("}\n")

    print(f"Wrote {args.output}", file=sys.stderr)
    return 0


def parse_volume(xml_file: Path) -> dict:
    volume_id = xml_file.stem
    tree = ET.parse(xml_file)
    root = tree.getroot()
    parent_map = {child: parent for parent in root.iter() for child in parent}
    body = root.find("ThML.body")
    if body is None:
        raise ValueError(f"Missing ThML.body in {xml_file}")

    volume_title = first_text(root, "DC.Title") or volume_id
    works_by_id: dict[str, dict] = {}
    work_order: list[str] = []

    for leaf in iter_leaf_divs(body):
        ancestors = div_ancestors(leaf, parent_map, body)
        if not ancestors:
            continue

        if any(is_editorial_div(div, is_top_level=(index == 0)) for index, div in enumerate(ancestors)):
            continue

        paragraphs = extract_paragraphs(leaf)
        if not paragraphs:
            continue

        verses = sentence_verses(paragraphs)
        if not verses:
            continue

        work_div, book_div = select_work_and_book(ancestors)
        work_id = f"{volume_id}:{work_div.attrib.get('id', stable_slug(title_of(work_div)))}"
        top_title = title_of(ancestors[0])
        work_title = title_of(work_div)
        chapter_title = title_of(leaf)

        if work_id not in works_by_id:
            works_by_id[work_id] = {
                "id": work_id,
                "title": work_title,
                "authorOrSection": None if work_div is ancestors[0] else top_title,
                "sourceVolumeId": volume_id,
                "chapters": [],
            }
            work_order.append(work_id)

        chapter = {
            "id": f"{volume_id}:{leaf.attrib.get('id', stable_slug(chapter_title))}",
            "title": chapter_title,
            "book": title_of(book_div) if book_div is not None else None,
            "lineage": [title_of(div) for div in ancestors],
            "verses": verses,
        }
        works_by_id[work_id]["chapters"].append(chapter)

    return {
        "id": volume_id,
        "title": clean_text(volume_title),
        "sourceXml": str(xml_file),
        "sourceUrl": f"https://www.ccel.org/ccel/schaff/{volume_id}.xml",
        "works": [works_by_id[work_id] for work_id in work_order],
    }


def iter_leaf_divs(body: ET.Element):
    for element in body.iter():
        if not is_div(element):
            continue
        if any(is_div(descendant) for descendant in list(element.iter())[1:]):
            continue
        yield element


def div_ancestors(leaf: ET.Element, parent_map: dict, body: ET.Element) -> list[ET.Element]:
    ancestors = []
    current = leaf
    while current is not None and current is not body:
        if is_div(current):
            ancestors.append(current)
        current = parent_map.get(current)
    ancestors.reverse()
    return ancestors


def select_work_and_book(ancestors: list[ET.Element]) -> tuple[ET.Element, ET.Element | None]:
    leaf = ancestors[-1]
    if len(ancestors) == 1:
        return leaf, None

    parent = ancestors[-2]
    grandparent = ancestors[-3] if len(ancestors) >= 3 else None

    if is_book_like(parent) and grandparent is not None:
        return grandparent, parent

    if not is_chapter_like(leaf) and is_author_like(parent):
        return leaf, None

    return parent, None


def extract_paragraphs(element: ET.Element) -> list[str]:
    paragraphs = []
    heading = title_of(element)
    for paragraph in iter_paragraphs(element):
        text = clean_text(element_text(paragraph))
        if is_editorial_paragraph(text):
            continue
        text = remove_leading_bracket_note(text)
        if is_heading_duplicate(text, heading):
            continue
        if len(text) >= 20:
            paragraphs.append(text)
    return paragraphs


def iter_paragraphs(element: ET.Element):
    for child in list(element):
        if child.tag in SKIP_INLINE_TAGS:
            continue
        if child.tag == "p":
            yield child
            continue
        yield from iter_paragraphs(child)


def is_editorial_paragraph(text: str) -> bool:
    if not text.startswith("["):
        return False
    if text.endswith("]"):
        return True
    return bool(re.search(r"\b(elucidation|publication|to be noted|see elucidation)\b", text[:300], re.IGNORECASE))


def remove_leading_bracket_note(text: str) -> str:
    if not text.startswith("["):
        return text
    match = re.match(r"^\[[^\]]{1,120}\]\s*(.*)$", text)
    if not match:
        return text
    remainder = match.group(1).lstrip(" .—-")
    return remainder if len(remainder) >= 20 else text


def is_heading_duplicate(text: str, heading: str) -> bool:
    if not text or not heading:
        return False

    normalized_text = normalize_heading_text(text)
    normalized_heading = normalize_heading_text(heading)
    return normalized_text == normalized_heading


def normalize_heading_text(text: str) -> str:
    text = clean_text(text).lower()
    text = re.sub(r"^(chapter|chap\.)\s+[ivxlcdm\d]+[.—\-\s:]+", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return clean_text(text)


def element_text(element: ET.Element) -> str:
    parts = [element.text or ""]
    for child in list(element):
        if child.tag in SKIP_INLINE_TAGS:
            parts.append(child.tail or "")
            continue
        parts.append(element_text(child))
        parts.append(child.tail or "")
    return "".join(parts)


def sentence_verses(paragraphs: list[str]) -> list[dict]:
    sentences = []
    for paragraph in paragraphs:
        protected = protect_abbreviations(paragraph)
        pieces = SENTENCE_END_RE.sub(r"\1\n", protected).splitlines()
        for piece in pieces:
            text = clean_text(piece.replace(PERIOD_PLACEHOLDER, "."))
            if len(text) >= 12:
                sentences.append(text)
    return [{"number": index + 1, "text": sentence} for index, sentence in enumerate(sentences)]


def protect_abbreviations(text: str) -> str:
    protected = text
    for abbreviation in ABBREVIATIONS:
        protected = protected.replace(abbreviation, abbreviation.replace(".", PERIOD_PLACEHOLDER))
    return protected


def is_div(element: ET.Element) -> bool:
    return bool(DIV_RE.match(element.tag))


def is_editorial_div(element: ET.Element, is_top_level: bool = False) -> bool:
    title = title_of(element)
    if not title:
        return False
    if is_top_level and re.fullmatch(r"preface", title.strip(), re.IGNORECASE):
        return True
    return bool(EDITORIAL_RE.search(title))


def is_book_like(element: ET.Element) -> bool:
    return bool(BOOK_RE.match(title_of(element)) or BOOK_RE.match(element.attrib.get("shorttitle", "") or ""))


def is_chapter_like(element: ET.Element) -> bool:
    return bool(CHAPTER_RE.match(title_of(element)) or CHAPTER_RE.match(element.attrib.get("shorttitle", "") or ""))


def is_author_like(element: ET.Element) -> bool:
    title = title_of(element)
    letters = [char for char in title if char.isalpha()]
    return bool(letters) and title.upper() == title and len(title.split()) <= 6


def title_of(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return clean_text(element.attrib.get("title") or element.attrib.get("shorttitle") or element.attrib.get("id") or "")


def first_text(root: ET.Element, tag: str) -> str | None:
    element = root.find(f".//{tag}")
    if element is None:
        return None
    return "".join(element.itertext())


def clean_text(text: str) -> str:
    return WHITESPACE_RE.sub(" ", text.replace("\u00a0", " ")).strip()


def stable_slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "untitled"


def write_json_field(handle, key: str, value, indent: int) -> None:
    handle.write(" " * indent)
    handle.write(json.dumps(key, ensure_ascii=False))
    handle.write(": ")
    handle.write(json.dumps(value, ensure_ascii=False))


def indent_json(value, base_indent: int, indent: int | None) -> str:
    if indent is None:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return " " * base_indent + text

    text = json.dumps(value, ensure_ascii=False, indent=indent)
    return "\n".join((" " * base_indent + line if line else line) for line in text.splitlines())


if __name__ == "__main__":
    raise SystemExit(main())
