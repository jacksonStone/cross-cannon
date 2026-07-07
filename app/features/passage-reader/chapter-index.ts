import type { BrowserPassage } from "~/lib/scripture-cache-contract";

import {
  BOOKS_BY_CANON,
  parseCanonMode,
  sortCanonicalBooks
} from "~/features/search/canons";

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
  audioUrl?: string;
  book: string;
  chapter: number;
  passages: ChapterPassage[];
};

export type ChapterIndex = {
  chaptersByKey: Map<string, ChapterContext>;
  chapterCountByBook: Map<string, number>;
  jumpBooks: JumpBookOption[];
  locationByPassageId: Map<string, PassageLocation>;
  orderedChapterEntries: OrderedChapterEntry[];
  orderedKeysByBook: Map<string, string[]>;
  passageById: Map<string, BrowserPassage>;
  renderedChapterKeys: string[];
};

export type OrderedChapterEntry = {
  chapter: ChapterContext;
  key: string;
};

export type JumpVerseTarget = {
  number: number;
  passageId: string;
};

export type JumpChapterOption = {
  number: number;
  verses: JumpVerseTarget[];
};

export type JumpBookOption = {
  chapters: JumpChapterOption[];
  name: string;
};

export function buildChapterIndex(passages: BrowserPassage[]): ChapterIndex {
  const chapterBuilders = new Map<
    string,
    {
      audioUrl?: string;
      book: string;
      chapter: number;
      passages: ChapterPassage[];
    }
  >();
  const locationByPassageId = new Map<string, PassageLocation>();
  const passageById = new Map<string, BrowserPassage>();
  const jumpBookBuilders = new Map<
    string,
    {
      chapters: Map<number, Map<number, string>>;
      name: string;
    }
  >();

  for (const passage of passages) {
    passageById.set(passage.id, passage);

    const location = parsePassageLocation(passage.reference);

    if (!location || passage.verses.length === 0) {
      continue;
    }

    locationByPassageId.set(passage.id, location);

    const key = chapterKey(location.book, location.chapter);
    const chapter = chapterBuilders.get(key) ?? {
      audioUrl: passage.audioUrl,
      book: location.book,
      chapter: location.chapter,
      passages: []
    };

    chapter.audioUrl ??= passage.audioUrl;
    chapter.passages.push({
      ...location,
      id: passage.id,
      reference: passage.reference,
      verses: passage.verses
    });
    chapterBuilders.set(key, chapter);

    const jumpBook = jumpBookBuilders.get(location.book) ?? {
      chapters: new Map<number, Map<number, string>>(),
      name: location.book
    };
    const jumpChapter = jumpBook.chapters.get(location.chapter) ?? new Map<number, string>();

    for (const verse of passage.verses) {
      if (!jumpChapter.has(verse.number)) {
        jumpChapter.set(verse.number, passage.id);
      }
    }

    jumpBook.chapters.set(location.chapter, jumpChapter);
    jumpBookBuilders.set(location.book, jumpBook);
  }

  const chaptersByKey = new Map<string, ChapterContext>();
  const orderedKeysByBook = new Map<string, string[]>();

  for (const [key, chapter] of chapterBuilders) {
    chaptersByKey.set(key, {
      audioUrl: chapter.audioUrl,
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

  const orderedChapterEntries = sortCanonicalBooks([...orderedKeysByBook.keys()])
    .flatMap((book) => (
      (orderedKeysByBook.get(book) ?? [])
        .map((key) => {
          const chapter = chaptersByKey.get(key);

          return chapter ? { chapter, key } : null;
        })
        .filter((entry): entry is OrderedChapterEntry => Boolean(entry))
    ));
  const renderedChapterKeys = orderedChapterEntries.map((entry) => entry.key);
  const chapterCountByBook = new Map<string, number>();

  for (const entry of orderedChapterEntries) {
    chapterCountByBook.set(
      entry.chapter.book,
      (chapterCountByBook.get(entry.chapter.book) ?? 0) + 1
    );
  }

  return {
    chaptersByKey,
    chapterCountByBook,
    jumpBooks: buildJumpBooks(jumpBookBuilders),
    locationByPassageId,
    orderedChapterEntries,
    orderedKeysByBook,
    passageById,
    renderedChapterKeys
  };
}

export function findDefaultReaderPassageId(index: ChapterIndex) {
  return [...index.passageById.values()]
    .find((passage) => passage.reference === "Genesis 1:1-5")?.id
    ?? [...index.passageById.values()]
      .find((passage) => passage.reference.startsWith("Genesis 1:"))?.id
    ?? index.orderedChapterEntries[0]?.chapter.passages[0]?.id
    ?? "";
}

export function findFirstPassageIdForChapter(
  index: ChapterIndex,
  chapterKeyValue: string
) {
  if (!chapterKeyValue) {
    return null;
  }

  return index.chaptersByKey.get(chapterKeyValue)?.passages[0]?.id ?? null;
}

export function getPassageChapterKey(index: ChapterIndex, passageId: string) {
  const location = index.locationByPassageId.get(passageId);

  return location ? chapterKey(location.book, location.chapter) : null;
}

export function findInitialJumpSelection(
  index: ChapterIndex,
  initialPassageId?: string
) {
  const initialLocation = initialPassageId
    ? index.locationByPassageId.get(initialPassageId)
    : null;
  const firstBook = index.jumpBooks[0];
  const firstChapter = firstBook?.chapters[0];

  return {
    book: initialLocation?.book ?? firstBook?.name ?? "",
    chapter: initialLocation?.chapter ?? firstChapter?.number ?? 0
  };
}

export function filterJumpBooksByCanon(
  jumpBooks: JumpBookOption[],
  canon: string | null | undefined
) {
  if (!canon) {
    return jumpBooks;
  }

  const canonBooks = BOOKS_BY_CANON[parseCanonMode(canon)];
  return jumpBooks.filter((book) => canonBooks.has(book.name));
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

function buildJumpBooks(
  jumpBookBuilders: Map<
    string,
    {
      chapters: Map<number, Map<number, string>>;
      name: string;
    }
  >
) {
  return sortCanonicalBooks([...jumpBookBuilders.keys()]).map((bookName) => {
    const book = jumpBookBuilders.get(bookName);

    return {
      name: bookName,
      chapters: [...(book?.chapters.entries() ?? [])]
        .sort(([left], [right]) => left - right)
        .map(([chapterNumber, verses]) => ({
          number: chapterNumber,
          verses: [...verses.entries()]
            .sort(([left], [right]) => left - right)
            .map(([number, passageId]) => ({ number, passageId }))
        }))
    };
  });
}
