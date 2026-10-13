import React from "react";
import { createRoot } from "react-dom/client";
import { useScriptureReaderNavigation } from "../../../app/features/reader-navigation/useScriptureReaderNavigation";
import { useChapterAudioPlayback } from "../../../app/features/audio/useChapterAudioPlayback";
import type { BrowserPassage } from "../../../app/lib/scripture-cache-contract";
import "../../../app/styles.css";

const isLuke = new URLSearchParams(location.search).has("luke");
const book = isLuke ? "Luke" : "Genesis";
const numbers = isLuke ? [6, 7, 8] : Array.from({ length: 50 }, (_, i) => i + 1);
const lukeOffsets = [1732.5714285714287, 2094.3673469387754, 2455.9542857142856, 2879.3208163265303];
const passages: BrowserPassage[] = numbers.map(number => ({
  id: `${isLuke ? "luke" : "gen"}-${number}`, reference: `${book} ${number}:1`, type: "paragraph",
  text: "Reading text ".repeat(150), verses: [{ number: 1, text: "Reading text ".repeat(150) }]
}));
const chapters = passages.map((p, i) => ({
  id: `${book}\t${numbers[i]}`, title: `${book} ${numbers[i]}`, workId: book,
  audio: { url: `/audio/continuous/${book.toLowerCase()}.m4a`, startSeconds: isLuke ? lukeOffsets[i] : i * 100, endSeconds: isLuke ? lukeOffsets[i + 1] : (i + 1) * 100 }
}));
const filters = {};
function Fixture() {
  const reader = useScriptureReaderNavigation({ filters, initialPassageId: isLuke ? "luke-7" : "gen-5", isReady: true, passages });
  const audio = useChapterAudioPlayback({ chapters, activeId: `${book}\t${reader.activeChapter?.chapter}`, onChapterChange: reader.openAudioChapter });
  return <main className="reader-shell"><section className="reader-page">
    <header className="reader-header">
      <audio ref={audio.audioRef} onTimeUpdate={audio.handleAudioTimeUpdate} onSeeked={audio.handleAudioSeeked} onEnded={audio.handleAudioEnded} onPause={audio.handleAudioPause} onPlay={audio.handleAudioPlay} />
      <h1 id="reader-title">{book} {reader.activeChapter?.chapter}</h1>
      <button onClick={audio.toggleActiveChapterAudio}>Play / pause</button>
    </header>
    <div className="reader-passages">{reader.renderedChapterEntries.map(({key, chapter}) =>
      <section className="reader-chapter" data-chapter-key={key} key={key}>
        <h2>{book} {chapter.chapter}</h2>
        {chapter.passages.map(p => <article className="reader-passage" data-passage-id={p.id} key={p.id}><p>{p.verses[0].text}</p></article>)}
      </section>
    )}</div>
  </section></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
