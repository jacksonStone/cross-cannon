import type { BrowserPassage } from "~/lib/scripture-cache.server";

export type PassageLocation = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

export type ChapterPassage = PassageLocation & {
  id: string;
  reference: string;
  verses: BrowserPassage["verses"];
};

export type ChapterContext = {
  book: string;
  chapter: number;
  passages: ChapterPassage[];
};

export type ChapterIndex = {
  chaptersByKey: Map<string, ChapterContext>;
  orderedKeysByBook: Map<string, string[]>;
  locationByPassageId: Map<string, PassageLocation>;
};

export function buildChapterIndex(passages: BrowserPassage[]): ChapterIndex {
  const chapterBuilders = new Map<
    string,
    {
      book: string;
      chapter: number;
      passages: ChapterPassage[];
    }
  >();
  const locationByPassageId = new Map<string, PassageLocation>();

  for (const passage of passages) {
    const location = parsePassageLocation(passage.reference);

    if (!location || passage.verses.length === 0) {
      continue;
    }

    locationByPassageId.set(passage.id, location);

    const key = chapterKey(location.book, location.chapter);
    const chapter = chapterBuilders.get(key) ?? {
      book: location.book,
      chapter: location.chapter,
      passages: []
    };

    chapter.passages.push({
      ...location,
      id: passage.id,
      reference: passage.reference,
      verses: passage.verses
    });
    chapterBuilders.set(key, chapter);
  }

  const chaptersByKey = new Map<string, ChapterContext>();
  const orderedKeysByBook = new Map<string, string[]>();

  for (const [key, chapter] of chapterBuilders) {
    chaptersByKey.set(key, {
      book: chapter.book,
      chapter: chapter.chapter,
      passages: chapter.passages.sort(
        (left, right) => left.verseStart - right.verseStart
      )
    });

    const bookKeys = orderedKeysByBook.get(chapter.book) ?? [];
    bookKeys.push(key);
    orderedKeysByBook.set(chapter.book, bookKeys);
  }

  for (const [book, keys] of orderedKeysByBook) {
    orderedKeysByBook.set(
      book,
      keys.sort((left, right) => {
        const leftChapter = chaptersByKey.get(left)?.chapter ?? 0;
        const rightChapter = chaptersByKey.get(right)?.chapter ?? 0;
        return leftChapter - rightChapter;
      })
    );
  }

  return {
    chaptersByKey,
    orderedKeysByBook,
    locationByPassageId
  };
}

export function parsePassageLocation(reference: string): PassageLocation | null {
  const match = reference.match(/^(.+)\s+(\d+):(\d+)(?:-(\d+))?$/);

  if (!match) {
    return null;
  }

  return {
    book: match[1],
    chapter: Number(match[2]),
    verseStart: Number(match[3]),
    verseEnd: Number(match[4] ?? match[3])
  };
}

export function chapterKey(book: string, chapter: number) {
  return `${book}\t${chapter}`;
}
