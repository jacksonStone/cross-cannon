#!/usr/bin/env python3
import json
import re
import shutil
from pathlib import Path


INPUT = Path("data/public-domain/church-fathers/ccel/parsed/church-fathers.json")
OUTPUT_DIR = Path("public/church-fathers-preview")
CHAPTERS_DIR = OUTPUT_DIR / "chapters"
BOOK_INDEX_PATH = OUTPUT_DIR / "books.json"
PRESERVED_OUTPUT_FILES = ["confessions-audio-alignment.json"]

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


def main() -> int:
    data = json.loads(INPUT.read_text(encoding="utf-8"))
    preserved_output_files = {
        file_name: (OUTPUT_DIR / file_name).read_bytes()
        for file_name in PRESERVED_OUTPUT_FILES
        if (OUTPUT_DIR / file_name).exists()
    }

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

            for chapter_index, chapter in enumerate(work["chapters"], start=1):
                file_name = f"{safe_id(chapter['id'])}.json"
                asset_path = f"/church-fathers-preview/chapters/{file_name}"
                chapter_number = chapter_index
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

                book_summary["chapters"].append({
                    "assetPath": asset_path,
                    "chapter": chapter_number,
                    "id": chapter["id"],
                    "title": chapter["title"],
                    "verseCount": len(chapter["verses"]),
                })
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

    if not author or is_collection_heading_work(value_lower(author).rstrip(".") + "."):
        lowered_title = value_lower(title)
        if "clement" in lowered_title:
            return "Clement of Rome"
        return volume_author

    normalized_author = normalize_author_label(author)
    if volume_author and (
        is_section_label(normalized_author)
        or is_containing_work_title(normalized_author, work)
    ):
        return volume_author

    return normalized_author


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

    if lowered.startswith("tertullian:"):
        return "Tertullian"
    if lowered in {"letters of st. augustin", "letters of st. augustine", "the confessions"}:
        return "Augustine of Hippo"
    if lowered == "prefaces":
        return "Jerome"

    return cleaned or None


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
        title.startswith("index of ")
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
