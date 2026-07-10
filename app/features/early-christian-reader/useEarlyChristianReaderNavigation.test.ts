import assert from "node:assert/strict";
import test from "node:test";

import {
  createEarlyChristianReaderOpenState,
  createInitialEarlyChristianReaderNavigation,
  isEarlyChristianReaderTargetWindowReady,
  resolveEarlyChristianReaderNavigation
} from "./useEarlyChristianReaderNavigation";
import type {
  BookSummary,
  ChapterAsset,
  ChapterEntry,
  ChapterSummary
} from "./types";

test("initial navigation gives URL chapter and passage priority", () => {
  assert.deepEqual(
    createInitialEarlyChristianReaderNavigation({
      initialChapterId: "url-chapter",
      initialPassageRange: "4-6",
      storedChapterId: "saved-chapter",
      storedPassageRange: "1-3"
    }),
    {
      activeChapterId: "url-chapter",
      selectedPassage: "4-6",
      selectedPassageChapterId: "url-chapter",
      targetChapterId: "url-chapter",
      targetPassageRange: "4-6"
    }
  );
});

test("initial navigation ignores saved passage when URL specifies only a chapter", () => {
  assert.deepEqual(
    createInitialEarlyChristianReaderNavigation({
      initialChapterId: "url-chapter",
      initialPassageRange: "",
      storedChapterId: "saved-chapter",
      storedPassageRange: "1-3"
    }),
    {
      activeChapterId: "url-chapter",
      selectedPassage: "",
      selectedPassageChapterId: "",
      targetChapterId: "url-chapter",
      targetPassageRange: ""
    }
  );
});

test("initial navigation restores saved chapter and passage without a URL chapter", () => {
  assert.deepEqual(
    createInitialEarlyChristianReaderNavigation({
      initialChapterId: "",
      initialPassageRange: "",
      storedChapterId: "saved-chapter",
      storedPassageRange: "1-3"
    }),
    {
      activeChapterId: "saved-chapter",
      selectedPassage: "1-3",
      selectedPassageChapterId: "saved-chapter",
      targetChapterId: "saved-chapter",
      targetPassageRange: "1-3"
    }
  );
});

test("navigation resolution falls back from invalid active chapter to initial chapter", () => {
  const chapters = createChapterEntries(["first", "initial", "third"]);
  const navigation = resolveEarlyChristianReaderNavigation({
    chapters,
    initialChapterId: "initial",
    navigationState: {
      activeChapterId: "missing",
      selectedPassage: "",
      selectedPassageChapterId: "",
      targetChapterId: "missing-target",
      targetPassageRange: ""
    }
  });

  assert.equal(navigation.resolvedActiveChapterId, "initial");
  assert.equal(navigation.activeEntry?.chapter.id, "initial");
  assert.equal(navigation.resolvedTargetChapterId, "initial");
  assert.deepEqual(navigation.initialWindowRange, {
    endIndex: 2,
    startIndex: 0
  });
});

test("navigation resolution falls back to first chapter when no saved target exists", () => {
  const chapters = createChapterEntries(["first", "second"]);
  const navigation = resolveEarlyChristianReaderNavigation({
    chapters,
    initialChapterId: "",
    navigationState: {
      activeChapterId: "missing",
      selectedPassage: "",
      selectedPassageChapterId: "",
      targetChapterId: "",
      targetPassageRange: ""
    }
  });

  assert.equal(navigation.resolvedActiveChapterId, "first");
  assert.equal(navigation.activeEntry?.chapter.id, "first");
  assert.equal(navigation.resolvedTargetChapterId, "first");
});

test("navigation keeps the explicit target range stable when selection changes", () => {
  const chapters = createChapterEntries(["first", "second"]);
  const navigation = resolveEarlyChristianReaderNavigation({
    chapters,
    initialChapterId: "",
    navigationState: {
      activeChapterId: "first",
      selectedPassage: "4-6",
      selectedPassageChapterId: "first",
      targetChapterId: "first",
      targetPassageRange: "1-3"
    }
  });

  assert.equal(navigation.targetPassageRange, "1-3");
});

test("open state selects the requested passage and target chapter", () => {
  assert.deepEqual(
    createEarlyChristianReaderOpenState({
      chapterId: "chapter-2",
      passageRange: "7-9"
    }),
    {
      activeChapterId: "chapter-2",
      selectedPassage: "7-9",
      selectedPassageChapterId: "chapter-2",
      targetChapterId: "chapter-2",
      targetPassageRange: "7-9"
    }
  );
});

test("target window readiness requires target and earlier rendered chapters to load", () => {
  const chapters = createChapterEntries(["first", "target", "after"]);
  const loadedChapters = new Map<string, ChapterAsset>([
    ["target", createChapterAsset("target")]
  ]);

  assert.equal(
    isEarlyChristianReaderTargetWindowReady({
      chapters,
      loadedChapters,
      resolvedTargetChapterId: "target",
      targetChapterIndex: 1,
      windowRange: { endIndex: 2, startIndex: 0 }
    }),
    false
  );

  loadedChapters.set("first", createChapterAsset("first"));

  assert.equal(
    isEarlyChristianReaderTargetWindowReady({
      chapters,
      loadedChapters,
      resolvedTargetChapterId: "target",
      targetChapterIndex: 1,
      windowRange: { endIndex: 2, startIndex: 0 }
    }),
    true
  );
});

function createChapterEntries(ids: string[]): ChapterEntry[] {
  const book = createBook(ids);

  return book.chapters.map((chapter, index) => ({
    book,
    chapter,
    index
  }));
}

function createBook(chapterIds: string[]): BookSummary {
  return {
    author: "Test Author",
    book: "Test Work",
    chapters: chapterIds.map((id, index) => createChapterSummary(id, index + 1)),
    classification: {
      bucket: "test",
      canonicalStatus: "test",
      cautionReason: "",
      contentKind: "chapter",
      doctrinalStatus: "test",
      labels: [],
      severity: 0
    },
    id: "test-work",
    metadata: {
      author: "Test Author",
      authorshipDateRange: "100",
      ccel: {
        id: "test",
        sourceUrl: "https://example.test",
        title: "Test"
      },
      source: {
        id: "test",
        provider: "test",
        sourceUrl: "https://example.test",
        title: "Test"
      }
    },
    name: "Test Work"
  };
}

function createChapterSummary(id: string, chapter: number): ChapterSummary {
  return {
    assetPath: `/assets/${id}.json`,
    chapter,
    id,
    title: `Chapter ${chapter}`,
    verseCount: 10
  };
}

function createChapterAsset(id: string): ChapterAsset {
  return {
    author: "Test Author",
    book: "Test Work",
    chapter: 1,
    classification: {
      bucket: "test",
      canonicalStatus: "test",
      cautionReason: "",
      contentKind: "chapter",
      doctrinalStatus: "test",
      labels: [],
      severity: 0
    },
    id,
    lineage: [],
    metadata: {
      author: "Test Author",
      authorshipDateRange: "100",
      ccel: {
        id: "test",
        sourceUrl: "https://example.test",
        title: "Test"
      },
      source: {
        id: "test",
        provider: "test",
        sourceUrl: "https://example.test",
        title: "Test"
      }
    },
    originalBook: null,
    source: {
      id: "test",
      sourceUrl: "https://example.test",
      title: "Test"
    },
    sourceVolumeId: "test",
    title: "Chapter 1",
    verses: []
  };
}
