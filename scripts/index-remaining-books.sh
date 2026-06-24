#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json || ! -f scripts/index-bible.ts ]]; then
  echo "Run this from the cross-cannon project root." >&2
  echo "Expected: /Users/jacksonstone/Desktop/ubuntu_box_software/cross-cannon" >&2
  exit 1
fi

if [[ ! -f data/bible.json ]]; then
  echo "Missing data/bible.json." >&2
  echo "Download it first:" >&2
  echo "curl -L https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json -o data/bible.json" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required to check indexing progress." >&2
  exit 1
fi

jobs_db="${INDEXING_JOBS_DB:-storage/indexing-jobs.db}"
max_parallel="${INDEX_PARALLEL_BOOKS:-5}"
runtime_db="${DATABASE_PATH:-storage/crosscannon.db}"

books=(
  "Genesis"
  "Exodus"
  "Leviticus"
  "Numbers"
  "Deuteronomy"
  "Joshua"
  "Judges"
  "Ruth"
  "1 Samuel"
  "2 Samuel"
  "1 Kings"
  "2 Kings"
  "1 Chronicles"
  "2 Chronicles"
  "Ezra"
  "Nehemiah"
  "Esther"
  "Job"
  "Psalms"
  "Proverbs"
  "Ecclesiastes"
  "Song of Songs"
  "Isaiah"
  "Jeremiah"
  "Lamentations"
  "Ezekiel"
  "Daniel"
  "Hosea"
  "Joel"
  "Amos"
  "Obadiah"
  "Jonah"
  "Micah"
  "Nahum"
  "Habakkuk"
  "Zephaniah"
  "Haggai"
  "Zechariah"
  "Malachi"
  "Matthew"
  "Mark"
  "Luke"
  "John"
  "Acts"
  "Romans"
  "1 Corinthians"
  "2 Corinthians"
  "Galatians"
  "Ephesians"
  "Philippians"
  "Colossians"
  "1 Thessalonians"
  "2 Thessalonians"
  "1 Timothy"
  "2 Timothy"
  "Titus"
  "Philemon"
  "Hebrews"
  "James"
  "1 Peter"
  "2 Peter"
  "1 John"
  "2 John"
  "3 John"
  "Jude"
  "Revelation"
)

sql_quote() {
  local value="${1//\'/\'\'}"
  printf "'%s'" "$value"
}

archive_db() {
  local db_path="$1"
  local timestamp="$2"

  if [[ ! -f "$db_path" ]]; then
    return
  fi

  mkdir -p storage/archive

  local filename extension basename archive_path
  filename="$(basename "$db_path")"
  extension="${filename##*.}"
  basename="${filename%.*}"

  if [[ "$filename" == "$extension" ]]; then
    archive_path="storage/archive/${filename}-${timestamp}"
  else
    archive_path="storage/archive/${basename}-${timestamp}.${extension}"
  fi

  cp "$db_path" "$archive_path"
  echo "Archived $(pwd)/${db_path} -> $(pwd)/${archive_path}"
}

is_book_finished() {
  local book="$1"

  if [[ ! -f "$jobs_db" ]]; then
    return 1
  fi

  local quoted_book
  quoted_book="$(sql_quote "$book")"

  local finished_count
  finished_count="$(sqlite3 "$jobs_db" \
    "SELECT COUNT(*)
     FROM indexing_jobs
     WHERE book_filter = $quoted_book
       AND passage_type = 'paragraph'
       AND finished_at IS NOT NULL
       AND (
         SELECT COUNT(*)
         FROM indexing_passages
         WHERE indexing_passages.job_id = indexing_jobs.id
           AND indexing_passages.status = 'indexed'
       ) >= total_passages
       AND NOT EXISTS (
         SELECT 1
         FROM indexing_passages
         WHERE indexing_passages.job_id = indexing_jobs.id
           AND indexing_passages.status = 'failed'
       );" 2>/dev/null || echo "0")"

  [[ "$finished_count" != "0" ]]
}

active_pids=()
active_books=()

wait_for_batch() {
  local failed=0

  for i in "${!active_pids[@]}"; do
    local pid="${active_pids[$i]}"
    local book="${active_books[$i]}"

    if wait "$pid"; then
      echo "==> Finished ${book}"
    else
      echo "==> Failed ${book}" >&2
      failed=1
    fi
  done

  active_pids=()
  active_books=()

  if [[ "$failed" -ne 0 ]]; then
    echo "One or more indexing jobs failed. Re-run this script to resume unfinished books." >&2
    exit 1
  fi
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_db "$runtime_db" "$timestamp"
archive_db "$jobs_db" "$timestamp"

for book in "${books[@]}"; do
  echo
  if is_book_finished "$book"; then
    echo "==> Skipping ${book}; already finished."
    continue
  fi

  echo "==> Starting ${book}"
  npm run index:bible -- data/bible.json \
    --db "$runtime_db" \
    --jobs-db "$jobs_db" \
    --passage-type paragraph \
    --book "$book" \
    --no-archive \
    --skip-index-rebuild &

  active_pids+=("$!")
  active_books+=("$book")

  if [[ "${#active_pids[@]}" -ge "$max_parallel" ]]; then
    wait_for_batch
  fi
done

if [[ "${#active_pids[@]}" -gt 0 ]]; then
  wait_for_batch
fi

echo
echo "==> Rebuilding search indexes"
npm run index:bible -- data/bible.json \
  --db "$runtime_db" \
  --jobs-db "$jobs_db" \
  --no-archive \
  --rebuild-indexes-only

echo
echo "Done indexing remaining books."
