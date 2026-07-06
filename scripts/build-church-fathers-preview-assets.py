#!/usr/bin/env python3
import json
import re
import shutil
from pathlib import Path


INPUT = Path("data/public-domain/church-fathers/ccel/parsed/church-fathers.json")
OUTPUT_DIR = Path("public/church-fathers-preview")
CHAPTERS_DIR = OUTPUT_DIR / "chapters"
BOOK_INDEX_PATH = OUTPUT_DIR / "books.json"
AUDIO_SOURCES_PATH = Path("data/public-domain/church-fathers/audio-sources.json")

DEFAULT_CLASSIFICATION = {
    "bucket": "Patristic / broadly orthodox",
    "canonicalStatus": "patristic",
    "contentKind": "primary",
    "cautionReason": "No major mainstream heresy warning is attached by the preview classifier.",
    "doctrinalStatus": "orthodox",
    "labels": ["patristic"],
    "severity": 0,
}

EXCLUDED_SOURCE_VOLUME_IDS = {"anf01"}
EXCLUDED_WORK_IDS = {
    "anf07:x": "duplicate/work",
    "npnf101:vii": "editorial/reference",
    "npnf205:ix.ii": "editorial/reference",
    "npnf205:x.ii": "editorial/reference",
}

AUTHOR_LABEL_OVERRIDES = {
    "appendix": "Anonymous",
    "arian history. (historia arianorum ad monachos.)": "Athanasius of Alexandria",
    "apology to the emperor. (apologia ad constantium.)": "Athanasius of Alexandria",
    "ascetic and moral treatises": "Gregory of Nyssa",
    "athenagoras": "Athenagoras of Athens",
    "clement of alexandria": "Clement of Alexandria",
    "circular to bishops of egypt and libya. (ad episcopos ægypti et libyæ epistola encyclica.)": "Athanasius of Alexandria",
    "circular to bishops of egypt and libya. (ad episcopos aegypti et libyae epistola encyclica.)": "Athanasius of Alexandria",
    "dogmatic treatises": "Gregory of Nyssa",
    "doctrinal treatises of st. augustin": "Augustine of Hippo",
    "encyclical letter. (epistola encyclica.)": "Athanasius of Alexandria",
    "jerome and gennadius. lives of illustrious men": "Jerome / Gennadius",
    "john of damascus: exposition of the orthodox faith": "John of Damascus",
    "life and works of rufinus with jerome's apology against rufinus": "Rufinus / Jerome",
    "memoirs of edessa and other ancient syriac documents": "Syriac documents / mixed",
    "moral treatises of st. augustin": "Augustine of Hippo",
    "select letters of saint gregory nazianzen": "Gregory Nazianzen",
    "selections from the hymns and homilies of ephraim the syrian and from the demonstrations of aphrahat the persian sage": "Ephraim the Syrian / Aphrahat",
    "the book of pastoral rule, and selected epistles, of gregory the great": "Gregory the Great",
    "the ecclesiastical history, dialogues, and letters of theodoret": "Theodoret of Cyrus",
    "the letters and sermons of leo the great": "Leo the Great",
    "the life of constantine with orations of constantine and eusebius": "Eusebius of Caesarea",
    "the teaching of the twelve apostles": "Didache / unknown",
    "theophilus": "Theophilus of Antioch",
    "the works of john cassian": "John Cassian",
    "the works of sulpitius severus": "Sulpitius Severus",
    "treatises": "Jerome",
}

AUTHOR_TITLE_PATTERNS = [
    ("peter of alexandria", "Peter of Alexandria"),
    ("caius", "Caius"),
    ("archelaus", "Archelaus"),
    ("venantius", "Venantius"),
    ("victorinus", "Victorinus"),
    ("melito", "Melito of Sardis"),
    ("hegesippus", "Hegesippus"),
    ("hermas", "Hermas"),
    ("tatian", "Tatian"),
    ("diatessaron", "Tatian"),
    ("aristides", "Aristides"),
    ("cyprian", "Cyprian of Carthage"),
    ("gregory thaumaturgus", "Gregory Thaumaturgus"),
    ("dionysius the great", "Dionysius of Alexandria"),
    ("dionysius of alexandria", "Dionysius of Alexandria"),
    ("dionysius", "Dionysius of Alexandria"),
    ("julius africanus", "Julius Africanus"),
    ("anatolius", "Anatolius of Alexandria"),
    ("methodius", "Methodius of Olympus"),
    ("arnobius", "Arnobius"),
    ("lactantius", "Lactantius"),
    ("origen", "Origen"),
    ("socrates scholasticus", "Socrates Scholasticus"),
    ("sozomen", "Sozomen"),
    ("cyril of jerusalem", "Cyril of Jerusalem"),
    ("s. cyril", "Cyril of Jerusalem"),
    ("saint gregory nazianzen", "Gregory Nazianzen"),
    ("gregory nazianzen", "Gregory Nazianzen"),
    ("hilary of poitiers", "Hilary of Poitiers"),
    ("john of damascus", "John of Damascus"),
    ("vincent of lérins", "Vincent of Lerins"),
    ("vincent of lerins", "Vincent of Lerins"),
    ("leo the great", "Leo the Great"),
    ("gregory the great", "Gregory the Great"),
    ("ephraim", "Ephraim the Syrian"),
    ("aphrahat", "Aphrahat"),
    ("theodoret", "Theodoret of Cyrus"),
    ("memoirs of edessa", "Syriac documents / mixed"),
    ("early liturgies", "Liturgical texts / unknown"),
    ("scillitan martyrs", "Scillitan Martyrs / unknown"),
    ("nicene creed", "Councils / synods"),
]

CONCILIAR_TITLE_PATTERNS = [
    "canons of",
    "council of",
    "ecumenical council",
    "synod of",
    "synods of",
]


def main() -> int:
    data = json.loads(INPUT.read_text(encoding="utf-8"))
    audio_sources = load_audio_sources()
    preserved_file_names = sorted(
        str(source["alignmentFile"])
        for source in audio_sources
        if source.get("alignmentFile")
    )
    preserved_output_files = {
        file_name: (OUTPUT_DIR / file_name).read_bytes()
        for file_name in preserved_file_names
        if (OUTPUT_DIR / file_name).exists()
    }
    audio_alignments = load_preserved_audio_alignments(preserved_output_files)

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)

    CHAPTERS_DIR.mkdir(parents=True, exist_ok=True)
    for file_name, content in preserved_output_files.items():
        (OUTPUT_DIR / file_name).write_bytes(content)

    manifest = {
        "bookCount": 0,
        "bookIndexPath": "/church-fathers-preview/books.json",
        "chapterCount": 0,
        "classificationCounts": {},
        "contentKindCounts": {},
        "excludedSummary": {
            "byReason": {},
            "workCount": 0,
        },
        "generatedAt": data.get("generatedAt"),
        "source": data.get("source"),
    }
    book_index = {
        "books": [],
        "generatedAt": data.get("generatedAt"),
        "source": data.get("source"),
    }
    chapter_count = 0

    for volume in data["volumes"]:
        for work in volume["works"]:
            if should_exclude_source_volume(volume):
                increment_count(manifest["excludedSummary"]["byReason"], "duplicate/source-volume")
                manifest["excludedSummary"]["workCount"] += 1
                continue

            excluded_work_reason = excluded_work_reason_for(work)
            if excluded_work_reason is not None:
                increment_count(manifest["excludedSummary"]["byReason"], excluded_work_reason)
                manifest["excludedSummary"]["workCount"] += 1
                continue

            classification = classify_work(volume, work)
            include_reason = patristic_scope_exclusion_reason(volume, work, classification)
            if include_reason is not None:
                increment_count(manifest["excludedSummary"]["byReason"], include_reason)
                manifest["excludedSummary"]["workCount"] += 1
                continue

            increment_count(manifest["contentKindCounts"], classification["contentKind"])
            if classification["doctrinalStatus"] != "unclassified":
                increment_count(manifest["classificationCounts"], classification["doctrinalStatus"])
            manifest["bookCount"] += 1
            book_name = display_title_for_work(work)
            metadata = metadata_for_work(volume, work)
            author = metadata["author"]
            book_summary = {
                "author": author,
                "book": book_name,
                "classification": classification,
                "chapters": [],
                "id": work["id"],
                "metadata": metadata,
                "name": book_name,
            }
            chapter_counts_by_source = chapter_counts_for_work(work, audio_sources)

            for chapter_index, chapter in enumerate(work["chapters"], start=1):
                file_name = f"{safe_id(chapter['id'])}.json"
                asset_path = f"/church-fathers-preview/chapters/{file_name}"
                chapter_number = chapter_index
                audio = audio_for_chapter(
                    work["id"],
                    chapter["id"],
                    audio_sources,
                    audio_alignments,
                    chapter_counts_by_source,
                )
                chapter_payload = {
                    "author": author,
                    "book": book_name,
                    "chapter": chapter_number,
                    "classification": classification,
                    "id": chapter["id"],
                    "lineage": chapter["lineage"],
                    "metadata": metadata,
                    "originalBook": chapter["book"],
                    "sourceVolumeId": volume["id"],
                    "title": chapter["title"],
                    "source": {
                        "id": volume["id"],
                        "sourceUrl": volume["sourceUrl"],
                        "title": volume["title"],
                    },
                    "verses": [
                        {
                            "book": book_name,
                            "chapter": chapter_number,
                            "text": verse["text"],
                            "verse": verse["number"],
                        }
                        for verse in chapter["verses"]
                    ],
                }
                (CHAPTERS_DIR / file_name).write_text(
                    json.dumps(chapter_payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                chapter_count += 1

                chapter_summary = {
                    "assetPath": asset_path,
                    "chapter": chapter_number,
                    "id": chapter["id"],
                    "title": chapter["title"],
                    "verseCount": len(chapter["verses"]),
                }
                if audio is not None:
                    chapter_summary["audio"] = audio

                book_summary["chapters"].append(chapter_summary)
                manifest["chapterCount"] += 1

            book_index["books"].append(book_summary)

    BOOK_INDEX_PATH.write_text(
        json.dumps(book_index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(
        f"Wrote {manifest['bookCount']} books and {chapter_count} chapter assets to {OUTPUT_DIR}"
    )
    return 0


def load_audio_sources() -> list[dict]:
    if not AUDIO_SOURCES_PATH.exists():
        return []

    payload = json.loads(AUDIO_SOURCES_PATH.read_text(encoding="utf-8"))
    sources = payload.get("sources", [])

    if not isinstance(sources, list):
        return []

    return [
        source
        for source in sources
        if isinstance(source, dict) and source.get("workId")
    ]


def load_preserved_audio_alignments(preserved_output_files: dict):
    alignments = {}

    for file_name, content in preserved_output_files.items():
        try:
            payload = json.loads(content.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue

        if isinstance(payload.get("chapters"), dict):
            alignments[file_name] = payload["chapters"]

    return alignments


def audio_for_chapter(
    work_id: str,
    chapter_id: str,
    audio_sources: list[dict],
    audio_alignments: dict,
    chapter_counts_by_source: dict,
):
    for source in audio_sources:
        if source.get("workId") != work_id:
            continue

        alignment_file = source.get("alignmentFile")
        aligned_audio = (
            audio_alignments.get(alignment_file, {}).get(chapter_id)
            if alignment_file
            else None
        )

        if aligned_audio:
            return normalize_audio(
                aligned_audio.get("audioUrl") or aligned_audio.get("url"),
                aligned_audio.get("label"),
                aligned_audio.get("startSeconds", 0),
                aligned_audio.get("endSeconds"),
                aligned_audio.get("confidence"),
            )

        ranged_audio = chapter_range_audio_for_chapter(source, chapter_id)
        if ranged_audio is not None:
            return ranged_audio

        parted_audio = part_audio_for_chapter(
            source,
            chapter_id,
            chapter_counts_by_source.get(audio_source_key(source), {}),
        )
        if parted_audio is not None:
            return parted_audio

    return None


def normalize_audio(audio_url, label, start_seconds=0, end_seconds=None, confidence=None):
    if not audio_url or not label:
        return None

    audio = {
        "label": str(label),
        "startSeconds": round(float(start_seconds or 0), 3),
        "url": str(audio_url),
    }

    if end_seconds is not None:
        audio["endSeconds"] = round(float(end_seconds), 3)

    if confidence is not None:
        audio["confidence"] = round(float(confidence), 3)

    return audio


def chapter_range_audio_for_chapter(source: dict, chapter_id: str):
    location = parse_audio_location(chapter_id, source.get("location"))

    if location is None:
        return None

    book, chapter = location
    for track in source.get("tracks", []):
        if (
            track["book"] == book
            and track["chapterStart"] <= chapter
            and track["chapterEnd"] >= chapter
        ):
            return normalize_audio(
                f"{source['baseUrl']}/{track['fileName']}",
                track["label"],
            )

    return None


def part_audio_for_chapter(source: dict, chapter_id: str, chapter_counts: dict):
    location = parse_audio_location(chapter_id, source.get("location"))

    if location is None:
        return None

    book, chapter = location
    parts = source.get("partsByBook", {}).get(str(book))
    chapter_count = chapter_counts.get(book)

    if not parts or not chapter_count:
        return None

    part_index = min(
        len(parts) - 1,
        max(0, ((chapter - 1) * len(parts)) // chapter_count),
    )
    part = parts[part_index]
    label = source.get("labelTemplate", "Book {book:02d}, part {partLetter}").format(
        book=book,
        part=part,
        partLetter=str(part)[-1].upper(),
    )
    file_name = source["fileTemplate"].replace("{part}", str(part))

    return normalize_audio(
        f"{source['baseUrl']}/{file_name}",
        label,
    )


def chapter_counts_for_work(work: dict, audio_sources: list[dict]):
    counts_by_source = {}

    for source in audio_sources:
        if source.get("workId") != work.get("id") or not source.get("partsByBook"):
            continue

        counts = {}
        for chapter in work.get("chapters", []):
            location = parse_audio_location(str(chapter.get("id") or ""), source.get("location"))
            if location is None:
                continue

            book, chapter_number = location
            counts[book] = max(counts.get(book, 0), chapter_number)

        counts_by_source[audio_source_key(source)] = counts

    return counts_by_source


def audio_source_key(source: dict) -> str:
    return str(
        source.get("id")
        or source.get("alignmentFile")
        or f"{source.get('workId')}:{source.get('location')}"
    )


def parse_audio_location(chapter_id: str, location):
    if location == "confessions":
        return parse_confessions_location(chapter_id)

    if location == "city-of-god":
        return parse_city_of_god_location(chapter_id)

    if location == "identity":
        return None

    return None


def parse_confessions_location(chapter_id: str):
    match = re.match(r"^npnf101:vi\.([IVXLCDM]+)(?:_1)?\.([IVXLCDM]+)$", chapter_id)

    if not match:
        return None

    book = roman_numeral_to_number(match.group(1))
    chapter = roman_numeral_to_number(match.group(2))

    if not book or not chapter:
        return None

    return book, chapter


def parse_city_of_god_location(chapter_id: str):
    book_one_match = re.match(r"^npnf102:iv\.ii\.([ivxlcdm]+)$", chapter_id, re.IGNORECASE)

    if book_one_match:
        return 1, roman_numeral_to_number(book_one_match.group(1))

    match = re.match(
        r"^npnf102:iv\.([IVXLCDM]+)(?:_1)?\.([0-9]+|[ivxlcdm]+)$",
        chapter_id,
        re.IGNORECASE,
    )

    if not match:
        return None

    book = roman_numeral_to_number(match.group(1))
    chapter_text = match.group(2)
    chapter = int(chapter_text) if chapter_text.isdigit() else roman_numeral_to_number(chapter_text)

    if not book or not chapter:
        return None

    return book, chapter


def roman_numeral_to_number(value: str):
    numerals = {
        "C": 100,
        "D": 500,
        "I": 1,
        "L": 50,
        "M": 1000,
        "V": 5,
        "X": 10,
    }
    letters = list(value.upper())
    total = 0

    for index, letter in enumerate(letters):
        current = numerals.get(letter, 0)
        next_value = numerals.get(letters[index + 1], 0) if index + 1 < len(letters) else 0
        total += -current if current < next_value else current

    return total


def safe_id(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", value)
    return safe.strip("_") or "chapter"


def should_exclude_source_volume(volume: dict) -> bool:
    return value_lower(volume.get("id")) in EXCLUDED_SOURCE_VOLUME_IDS


def excluded_work_reason_for(work: dict):
    return EXCLUDED_WORK_IDS.get(str(work.get("id") or ""))


def display_title_for_work(work: dict) -> str:
    title = str(work.get("title") or "").strip()
    roman_title = title.strip(".")

    if re.fullmatch(r"[IVXLCDM]+", roman_title):
        lineage = work.get("chapters", [{}])[0].get("lineage", [])
        if roman_title in lineage:
            index = lineage.index(roman_title)
            if index > 0:
                return f"{str(lineage[index - 1]).strip().strip('.')} - Book {roman_title}"

    return title


def classify_work(volume: dict, work: dict) -> dict:
    volume_id = value_lower(volume.get("id"))
    title = value_lower(work.get("title"))
    author_or_section = value_lower(work.get("authorOrSection"))
    context = " ".join([volume_id, title, author_or_section])

    if is_reference_work(title) or is_collection_heading_work(title) or is_parser_fragment_work(work):
        return classification(
            "Editorial / reference material",
            "unclassified",
            "editorial",
            "editorial",
            "Editorial, index, preface, or title material rather than a primary patristic work.",
            ["editorial", "reference"],
            0,
        )

    if contains_any(context, [
        "excerpts of theodotus",
        "recognitions of clement",
        "pseudo-clementine literature",
        "gospel of peter",
        "acts of the holy apostle thomas",
        "acts of thomas",
    ]):
        return classification(
            "Heterodox / heretical",
            "heterodox",
            "pseudonymous",
            "primary",
            "Associated with Gnostic, Ebionite, Docetic, or other teachings rejected by mainstream Nicene Christianity.",
            ["heterodox", "pseudonymous"],
            4,
        )

    if contains_any(context, [
        "gospel of pseudo-matthew",
        "gospel of the nativity of mary",
        "gospel of thomas",
        "gospel of nicodemus",
        "narrative of joseph",
        "acts of philip",
        "acts of the holy apostles peter and paul",
        "apocalypse of peter",
        "vision of paul",
        "apocalypse of the virgin",
        "apocalypse of sedrach",
        "testament of abraham",
        "acts of xanthippe and polyxena",
        "narrative of zosimus",
        "testaments of the twelve patriarchs",
    ]):
        return classification(
            "Apocryphal / non-canonical",
            "apocryphal",
            "noncanonical",
            "primary",
            "Non-canonical apocryphal literature; historically useful, but not received as Scripture by mainstream Christian denominations.",
            ["apocryphal", "noncanonical"],
            3,
        )

    if contains_any(context, [
        "constitutions of the holy apostles",
        "apostolic constitutions",
        "two epistles concerning virginity",
        "decretals",
        "epistles of zephyrinus",
        "epistles of pope callistus",
        "epistle of pope urban",
        "epistles of pope pontianus",
        "epistles of pope fabian",
    ]):
        return classification(
            "Pseudonymous / disputed",
            "disputed",
            "pseudonymous",
            "primary",
            "Pseudonymous or disputed ecclesiastical material; useful as historical reception, but not treated as apostolic authority.",
            ["disputed", "pseudonymous"],
            2,
        )

    if is_anti_heresy_work(context):
        return classification(
            "Patristic / broadly orthodox",
            "orthodox",
            "patristic",
            "primary",
            "This work discusses heresy in order to refute it; do not classify it as heretical merely from its title.",
            ["orthodox", "polemical"],
            0,
        )

    if contains_any(context, [
        "origen",
        "tatian",
        "diatessaron",
        "stromata",
        "miscellanies",
        "on monogamy",
        "on modesty",
        "on fasting",
        "on the veiling of virgins",
        "on exhortation to chastity",
        "de fuga in persecutione",
        "conference xiii",
        "john cassian",
        "arnobius",
        "lactantius",
    ]):
        return classification(
            "Doctrinally disputed / caution",
            "disputed",
            "patristic",
            "primary",
            "Important early Christian material with later doctrinal cautions, disputed reception, or speculative theology.",
            ["disputed"],
            2,
        )

    if is_spurious_ignatius(context):
        return classification(
            "Pseudonymous / disputed",
            "disputed",
            "pseudonymous",
            "primary",
            "Ignatian textual tradition or attribution is disputed; use as historical material rather than secure apostolic-era testimony.",
            ["disputed", "pseudonymous"],
            2,
        )

    if contains_any(context, [
        "pastor of hermas",
        "the shepherd of hermas",
        "the epistle of barnabas",
        "the teaching of the twelve apostles",
        "first epistle to the corinthians clement",
        "first epistle of clement",
        "second epistle of clement",
        "martyrdom of polycarp",
        "fragments papias",
        "apocalypse of peter",
    ]):
        return classification(
            "Early Christian / non-canonical",
            "noncanonical",
            "noncanonical",
            "primary",
            "Valued early Christian text, but not part of the biblical canon for mainstream Christian denominations.",
            ["early-christian", "noncanonical"],
            1,
        )

    if volume_id == "npnf214" or contains_any(context, ["ecumenical council", "nicene creed"]):
        return classification(
            "Conciliar / orthodox",
            "orthodox",
            "conciliar",
            "primary",
            "Conciliar or creedal material received in mainstream Nicene Christian tradition, with denominational differences on some canons.",
            ["conciliar", "orthodox"],
            0,
        )

    return dict(DEFAULT_CLASSIFICATION)


def patristic_scope_exclusion_reason(volume: dict, work: dict, classification: dict):
    context = " ".join([
        value_lower(volume.get("id")),
        value_lower(volume.get("title")),
        value_lower(work.get("title")),
        value_lower(work.get("authorOrSection")),
    ])

    if classification["contentKind"] == "editorial":
        return "editorial/reference"

    if classification["doctrinalStatus"] in {"apocryphal", "heterodox", "unclassified"}:
        return classification["doctrinalStatus"]

    if classification["doctrinalStatus"] == "disputed":
        return "disputed"

    if classification["canonicalStatus"] == "pseudonymous":
        return "pseudonymous/non-patristic"

    return None


def classification(bucket, doctrinal_status, canonical_status, content_kind, reason, labels, severity):
    return {
        "bucket": bucket,
        "canonicalStatus": canonical_status,
        "contentKind": content_kind,
        "cautionReason": reason,
        "doctrinalStatus": doctrinal_status,
        "labels": labels,
        "severity": severity,
    }


def increment_count(counts: dict, key: str):
    counts[key] = counts.get(key, 0) + 1


def value_lower(value) -> str:
    return str(value or "").lower()


def contains_any(value: str, needles: list[str]) -> bool:
    return any(needle in value for needle in needles)


def metadata_for_work(volume: dict, work: dict):
    author = author_for_work(volume, work)
    date_range = authorship_date_range_for_work(volume, work)

    return {
        "author": author,
        "authorshipDateRange": date_range,
        "ccel": {
            "id": volume["id"],
            "sourceUrl": volume["sourceUrl"],
            "title": volume["title"],
        },
        "source": {
            "id": volume["id"],
            "provider": "CCEL",
            "sourceUrl": volume["sourceUrl"],
            "title": volume["title"],
        },
    }


def author_for_work(volume: dict, work: dict):
    author = str(work.get("authorOrSection") or "").strip()
    title = str(work.get("title") or "")
    volume_author = author_from_volume_title(str(volume.get("title") or ""))
    contextual_author = author_from_work_context(volume, work)

    if not author or is_collection_heading_work(value_lower(author).rstrip(".") + "."):
        if "clement" in value_lower(title):
            return "Clement of Rome"
        return contextual_author or volume_author

    normalized_author = normalize_author_label(author)
    if volume_author and (
        is_section_label(normalized_author)
        or is_containing_work_title(normalized_author, work)
    ):
        return contextual_author or volume_author

    if normalized_author and looks_like_author_bucket_leak(normalized_author):
        return contextual_author or volume_author or normalized_author

    return normalized_author


def author_from_work_context(volume: dict, work: dict):
    title = str(work.get("title") or "")
    lineage = " ".join(
        str(item or "")
        for chapter in work.get("chapters", [])[:1]
        for item in chapter.get("lineage", [])
    )
    context = normalize_author_lookup_key(" ".join([
        str(work.get("authorOrSection") or ""),
        title,
        lineage,
    ]))

    for label in [
        str(work.get("authorOrSection") or ""),
        title,
        *list(work_title_lineage(work)),
    ]:
        override = author_label_override(label)
        if override:
            return override

    if any(pattern in context for pattern in CONCILIAR_TITLE_PATTERNS):
        return "Councils / synods"

    for pattern, author in AUTHOR_TITLE_PATTERNS:
        if pattern in context:
            return author

    volume_author = author_from_volume_title(str(volume.get("title") or ""))
    if volume_author:
        return volume_author

    return None


def authorship_date_range_for_work(volume: dict, work: dict):
    title = str(volume.get("title") or "")
    lowered_title = value_lower(title)

    if "second and third centuries" in lowered_title:
        return "second and third centuries"
    if "third and fourth centuries" in lowered_title:
        return "third and fourth centuries"
    if "second century" in lowered_title or "fathers of the second century" in lowered_title:
        return "second century"
    if "third century" in lowered_title or "fathers of the third century" in lowered_title:
        return "third century"
    if "fourth century" in lowered_title:
        return "fourth century"
    if "first age" in lowered_title:
        return "first age"

    return None


def author_from_volume_title(title: str):
    normalized = re.sub(r"^(ANF|NPNF)[^.]*(\.\s*)?", "", title).strip()
    lowered = value_lower(normalized)

    dedicated_authors = [
        ("st. augustine", "Augustine of Hippo"),
        ("st. augustin", "Augustine of Hippo"),
        ("augustine:", "Augustine of Hippo"),
        ("augustin:", "Augustine of Hippo"),
        ("st. chrysostom", "John Chrysostom"),
        ("saint chrysostom", "John Chrysostom"),
        ("athanasius:", "Athanasius of Alexandria"),
        ("basil:", "Basil of Caesarea"),
        ("ambrose:", "Ambrose of Milan"),
        ("gregory of nyssa:", "Gregory of Nyssa"),
        ("jerome:", "Jerome"),
        ("eusebius pamphilius:", "Eusebius of Caesarea"),
    ]

    if "confessions and letters of st. august" in lowered:
        return "Augustine of Hippo"

    for prefix, author in dedicated_authors:
        if lowered.startswith(prefix):
            return author

    if lowered == "latin christianity: its founder, tertullian":
        return "Tertullian"

    return None


def normalize_author_label(author: str):
    cleaned = re.sub(r"\s+", " ", author).strip().strip(".")
    lowered = value_lower(cleaned)
    override = author_label_override(cleaned)

    if override:
        return override

    if lowered.startswith("tertullian:"):
        return "Tertullian"
    if lowered in {"letters of st. augustin", "letters of st. augustine", "the confessions"}:
        return "Augustine of Hippo"
    if lowered == "prefaces":
        return "Jerome"

    return cleaned or None


def author_label_override(label: str):
    key = normalize_author_lookup_key(label)
    return AUTHOR_LABEL_OVERRIDES.get(key)


def normalize_author_lookup_key(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().strip(".").lower()


def work_title_lineage(work: dict):
    for chapter in work.get("chapters", [])[:1]:
        for item in chapter.get("lineage", []):
            yield str(item or "")


def looks_like_author_bucket_leak(author: str) -> bool:
    lowered = value_lower(author)

    if lowered in {"appendix", "memoirs of edessa and other ancient syriac documents"}:
        return False

    if any(pattern in lowered for pattern in CONCILIAR_TITLE_PATTERNS):
        return True

    return looks_like_work_heading(author)


def is_section_label(author):
    if not author:
        return False

    return value_lower(author) in {
        "ad martyras",
        "anti-marcion",
        "apologetic",
        "ascetic",
        "dogmatic",
        "ethical",
        "extant works and fragments",
        "part first",
        "part second",
        "part third",
        "part fourth",
        "the seven books of arnobius against the heathen",
    }


def is_containing_work_title(author, work: dict) -> bool:
    if not author:
        return False

    chapters = work.get("chapters") or []
    if not chapters:
        return False

    lineage = chapters[0].get("lineage") or []
    if not lineage:
        return False

    normalized_author = normalize_heading(author)
    normalized_lineage = [normalize_heading(item) for item in lineage]
    normalized_title = normalize_heading(work.get("title"))
    if normalized_lineage[0] != normalized_author:
        return False

    title_is_nested_under_author = normalized_title in normalized_lineage[1:]
    return title_is_nested_under_author and looks_like_work_heading(author)


def looks_like_work_heading(value: str) -> bool:
    lowered = value_lower(value)
    if " with " in lowered and " and " in lowered:
        return False

    return contains_any(lowered, [
        " against ",
        " commentary ",
        " connection ",
        " exposition ",
        " homilies ",
        " homily ",
        " letters ",
        " oration ",
        " treatise ",
        " treatises ",
        " writings ",
        "works",
        "the book of ",
        "the church history",
        "the life of ",
        "with ",
    ]) or lowered.startswith((
        "a treatise ",
        "against ",
        "commentary ",
        "defence ",
        "expositions ",
        "letters ",
        "life ",
        "on ",
        "the ",
    ))


def normalize_heading(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().strip(".").lower()


def is_reference_work(title: str) -> bool:
    return title in {
        "appendix",
        "appendix.",
        "credits.",
        "introduction.",
        "preface.",
        "title pages.",
        "series title",
    } or (
        title.startswith("appended note ")
        or title.startswith("appendix containing ")
        or title.startswith("excursus ")
        or title.startswith("general introduction")
        or title.startswith("index of ")
        or title.startswith("chief events ")
        or title.startswith("dedication of volume ")
        or title.startswith("introductory essay")
        or title.startswith("introductory dissertation")
        or title.startswith("preface to the american edition")
        or title.startswith("preface to part ")
        or title.startswith("preface to volume ")
        or title.endswith("index of subjects")
    )


def is_parser_fragment_work(work: dict) -> bool:
    chapters = work.get("chapters") or []
    title = str(work.get("title") or "")
    author_or_section = str(work.get("authorOrSection") or "")

    if len(chapters) != 1 or not author_or_section:
        return False

    lineage = chapters[0].get("lineage") or []
    return (
        len(lineage) > 3
        and lineage[0] == author_or_section
        and title in lineage[1:-1]
        and len(title) > 70
    )


def is_collection_heading_work(title: str) -> bool:
    return title in {
        "acts and records of the famous controversy about the baptism of heretics.",
        "ambrose: selected works and letters.",
        "anatolius and minor writers.",
        "anti-marcion.",
        "apocrypha of the new testament.",
        "archelaus.",
        "arnobius.",
        "augustin: anti-pelagian writings.",
        "augustin: confessions and letters.",
        "augustin: homilies on the gospel of john, homilies on the first epistle of john, soliloquies.",
        "augustin: on the holy trinity, doctrinal treatises, moral treatises.",
        "augustin: the city of god, christian doctrine.",
        "caius.",
        "cyprian.",
        "dionysius.",
        "gregory of nyssa: dogmatic treatises, etc.",
        "gregory thaumaturgus.",
        "ignatius: spurious epistles.",
        "julius africanus.",
        "methodius.",
        "minor writers.",
        "origen.",
        "peter of alexandria.",
        "remains of the second and third centuries.",
        "sulpitius severus, vincent of lerins, john cassian.",
        "the decretals.",
        "the epistles of clement.",
        "the seven ecumenical councils.",
    }


def is_anti_heresy_work(context: str) -> bool:
    return contains_any(context, [
        "against heresies",
        "against marcion",
        "against hermogenes",
        "against the valentinians",
        "against praxeas",
        "against all heresies",
        "against the heretic novatian",
        "manich",
        "donatist",
        "pelagian",
        "against the arians",
        "defence of the nicene",
        "against eunomius",
        "against nestorius",
        "against jovinianus",
        "apollinarian controversy",
        "deposition of arius",
        "epistles on the arian heresy",
    ])


def is_spurious_ignatius(context: str) -> bool:
    if "ignatius" not in context:
        return False

    return contains_any(context, [
        "longer versions",
        "syriac version",
        "tarsians",
        "antiochians",
        "hero",
        "philippians",
        "maria of cassobel",
        "mary at neapolis",
        "first epistle to st john",
        "second epistle to st john",
        "mary the virgin",
    ])


if __name__ == "__main__":
    raise SystemExit(main())
