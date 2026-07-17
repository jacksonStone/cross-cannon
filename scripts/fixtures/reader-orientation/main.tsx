import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import { useScriptureReaderWindow } from "../../../app/features/reader-window/useReaderWindow";

import "../../../app/styles.css";
import "./styles.css";

const chapters = Array.from({ length: 20 }, (_, chapterIndex) => ({
  key: `Ecclesiastes\t${chapterIndex + 1}`,
  number: chapterIndex + 1,
  passages: Array.from({ length: 3 }, (_, passageIndex) => ({
    id: `eccl-${chapterIndex + 1}-${passageIndex + 1}`,
    text: Array.from(
      { length: passageIndex === 0 ? 90 : 54 },
      (_, wordIndex) => `word${wordIndex + 1}`
    ).join(" ")
  }))
}));

function ReaderOrientationFixture() {
  const initialChapterKey = "Ecclesiastes\t11";
  const initialPassageId = "eccl-11-1";
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);
  const { renderedRange } = useScriptureReaderWindow({
    activeChapterKey,
    initialChapterIndex: 10,
    initialChapterKey,
    initialPassageId,
    isReady: true,
    itemCount: chapters.length,
    onActiveChapterChange: setActiveChapterKey
  });

  return (
    <main className="reader-shell">
      <section className="reader-page">
        <header className="reader-header">
          <h1 id="reader-title">{activeChapterKey.replace("\t", " ")}</h1>
        </header>
        <div className="reader-passages">
          {chapters
            .slice(renderedRange.startIndex, renderedRange.endIndex + 1)
            .map((chapter) => (
              <section
                className="reader-chapter"
                data-chapter-key={chapter.key}
                key={chapter.key}
              >
                <h2 className="reader-chapter-heading">
                  Ecclesiastes {chapter.number}
                </h2>
                <div className="reader-chapter-passages">
                  {chapter.passages.map((passage) => (
                    <article
                      className="reader-passage"
                      data-passage-id={passage.id}
                      key={passage.id}
                    >
                      <button className="reader-passage-button" type="button">
                        <span className="reader-passage-text">
                          {passage.text}
                        </span>
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ReaderOrientationFixture />
);
