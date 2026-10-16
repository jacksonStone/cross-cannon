import React from "react";
import { createRoot } from "react-dom/client";
import { useScriptureReaderNavigation } from "../../../app/features/reader-navigation/useScriptureReaderNavigation";
import { useChapterAudioPlayback } from "../../../app/features/audio/useChapterAudioPlayback";
import type { BrowserPassage } from "../../../app/lib/scripture-cache-contract";
import "../../../app/styles.css";

declare const __SCRIPTURE_PASSAGES__: BrowserPassage[];
declare const __LUKE_AUDIO__: Record<string, { url: string; startSeconds: number; endSeconds: number }>;
const isBoundary = new URLSearchParams(location.search).has("boundary");
const isLuke = new URLSearchParams(location.search).has("luke");
const book = isLuke || isBoundary ? "Luke" : "Genesis";
const numbers = isLuke ? [6, 7, 8] : Array.from({ length: 50 }, (_, i) => i + 1);
const lukeOffsets = [1732.5714285714287, 2094.3673469387754, 2455.9542857142856, 2879.3208163265303];
const passages: BrowserPassage[] = isBoundary ? __SCRIPTURE_PASSAGES__ : numbers.map(number => ({
  id: `${isLuke ? "luke" : "gen"}-${number}`, reference: `${book} ${number}:1`, type: "paragraph",
  text: "Reading text ".repeat(150), verses: [{ number: 1, text: "Reading text ".repeat(150) }]
}));
const chapters = isBoundary ? Object.entries(__LUKE_AUDIO__).map(([id, audio]) => ({ id, title: id.replace("\t", " "), workId: "Luke", audio })) : passages.map((p, i) => ({
  id: `${book}\t${numbers[i]}`, title: `${book} ${numbers[i]}`, workId: book,
  audio: { url: `/audio/continuous/${book.toLowerCase()}.m4a`, startSeconds: isLuke ? lukeOffsets[i] : i * 100, endSeconds: isLuke ? lukeOffsets[i + 1] : (i + 1) * 100 }
}));
const filters = {};
function Fixture() {
  const restoreChapter = new URLSearchParams(location.search).get("restore") ?? "9";
  const reader = useScriptureReaderNavigation({ filters, initialPassageId: isBoundary ? passages.find(p => p.reference.startsWith(`Luke ${restoreChapter}:`))!.id : isLuke ? "luke-7" : "gen-5", isReady: true, passages });
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
        {chapter.passages.map(p => <article className="reader-passage" data-passage-id={p.id} key={p.id}><p>{p.verses.map(v => v.text).join(" ")}</p></article>)}
      </section>
    )}</div>
  </section></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
