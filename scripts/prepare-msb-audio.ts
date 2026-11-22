/** Explicit, resumable off-server MSB download/intro indexing. Never opens a DB. */
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import path from "node:path";
import OpenAI from "openai";
import { findIntroOffset, reconcileIntroOffsets, parsePauses, introClipEnd, type IntroCandidate, type IntroTranscript, type IntroOffset } from "./lib/msb-audio-offset";

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const AUDIO = path.join(ROOT, "storage/audio/MSB");
const WORK = path.join(AUDIO, ".work");
const REPORT = path.join(ROOT, "public/scripture-translations/msb-audio-offsets.json");
const COMPACT = path.join(ROOT, "public/msb-audio-offsets.json");
const REVIEW = path.join(ROOT, "docs/research/msb-audio-offset-review.md");
const MODEL = "whisper-1";
const retryReview = process.argv.includes("--retry-review");
const CONTEXT = retryReview ? "intro-focus-v2" : "recording-announcement-v1";
const PROMPT = "An English Bible chapter recording, including its introductory announcement and chapter heading.";
const CLIP_SECONDS = 8;
const RATE = 0.006;
const ANALYSIS_VERSION = 4;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function option(name: string, fallback: number) {
  const i = args.indexOf(name), value = i < 0 ? fallback : Number(args[i + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}
const downloadJobs = option("--jobs", 8);
const transcriptionJobs = option("--transcription-jobs", 4);
const limit = option("--limit", 1189);
const budget = option("--max-cost", 1.25);
if (![downloadJobs, transcriptionJobs, limit].every(Number.isInteger) || downloadJobs > 16 || transcriptionJobs > 8) {
  throw new Error("Use integer limits, at most 16 downloads and 8 transcriptions.");
}
if (flag("--help")) {
  console.log("prepare-msb-audio [--download-only] [--jobs 8] [--transcription-jobs 4] [--limit 1189] [--max-cost 1.25] [--retry-errors] [--retry-with-context] [--retry-review] [--reanalyze]");
  process.exit(0);
}
type Track = { id: string; fileName: string; url: string };
type Receipt = { url: string; bytes: number; sha256: string; duration: number };
type Attempt = { at: string; fileName: string; clipSha256: string; maximumCost: number; model?: string; context?: string; purpose?: string; clipSeconds?: number };
type Entry = IntroOffset & { sourceSha256: string; transcript?: string; transcriptionContext?: string; transcriptSource?: string; analysisVersion?: number };
type Catalog = { recordingsUrl: string; books: Record<string, { prefix: string; chapters: number }> };
const catalog: Catalog = JSON.parse(await readFile(path.join(ROOT, "public/scripture-translations/msb-audio.json"), "utf8"));
const tracks = Object.entries(catalog.books).flatMap(([book, data]) => Array.from({ length: data.chapters }, (_, i) => {
  const fileName = `${data.prefix}_${String(i + 1).padStart(3, "0")}_D.mp3`;
  return { id: `${book}:${i + 1}`, fileName, url: new URL(fileName, catalog.recordingsUrl).href };
}));
if (tracks.length !== 1189 || new Set(tracks.map(t => t.fileName)).size !== 1189) throw new Error("Incomplete MSB catalog");
type RetrySession = { initialReview: Record<string, Entry>; beforeCost: number; beforeDetected: number };
const sessionFile = path.join(WORK, "intro-focus-v2-session.json");
let retrySession = retryReview ? await json<RetrySession>(sessionFile) : undefined;
if (retryReview && !retrySession) {
  const previous = await json<{ chapters: Record<string, Entry>; maximumReservedCostUSD: number; detectedChapters: number }>(REPORT);
  if (!previous) throw new Error("An existing chapter index is required to retry review entries");
  retrySession = { initialReview: Object.fromEntries(Object.entries(previous.chapters).filter(([, entry]) => entry.status === "needs-review")),
    beforeCost: previous.maximumReservedCostUSD, beforeDetected: previous.detectedChapters };
}
const selected = tracks.filter(t => !retrySession || t.id in retrySession.initialReview).slice(0, limit);
let stopping = false;
function stopAfterCurrentWork() {
  stopping = true; process.exitCode = 130;
  console.log("Stopping after in-flight work is saved; rerun the same command to resume.");
}
process.once("SIGINT", stopAfterCurrentWork);
process.once("SIGTERM", stopAfterCurrentWork);
await mkdir(WORK, { recursive: true });
await mkdir(path.dirname(REVIEW), { recursive: true });

async function atomic(file: string, data: unknown) {
  const temporary = `${file}.tmp-${process.pid}`;
  const handle = await open(temporary, "w");
  try { await handle.writeFile(typeof data === "string" || data instanceof Uint8Array ? data : `${JSON.stringify(data, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
}
async function json<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function hash(file: string) {
  const sum = createHash("sha256");
  for await (const chunk of createReadStream(file)) sum.update(chunk);
  return sum.digest("hex");
}
async function duration(file: string) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  const value = Number(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid audio: ${file}`);
  return value;
}
async function pool<T>(items: T[], jobs: number, work: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, jobs) }, async () => {
    while (!stopping && index < items.length) { const item = items[index++]; await work(item); }
  }));
}
// One writer owns the ledger/reports. A dead process's lock can be reclaimed.
const lockFile = path.join(WORK, "lock.json");
async function lock() {
  try {
    const handle = await open(lockFile, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = await json<{ pid: number }>(lockFile);
    if (!owner) throw new Error("MSB lock changed; retry the command");
    try { process.kill(owner.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      await rm(lockFile); return lock();
    }
    throw new Error(`MSB preparation already running as PID ${owner.pid}`);
  }
}
await lock();
try { await main(); } finally { await rm(lockFile, { force: true }); }

async function main() {
  if (retrySession && !await json<RetrySession>(sessionFile)) await atomic(sessionFile, retrySession);
  let client: OpenAI | undefined;
  const entries: Record<string, Entry> = {};
  const needsWork = new Set<string>();
  const receipts = new Map<string, Receipt>();
  const errors: Record<string, string> = {};
  const ledgerFile = path.join(WORK, "requests.json");
  const attempts = await json<Attempt[]>(ledgerFile) ?? [];
  let reservedCost = attempts.reduce((sum, attempt) => sum + attempt.maximumCost, 0);
  let downloaded = 0, reused = 0, completed = 0;
  console.log(`${selected.length} chapters; ${downloadJobs} download / ${transcriptionJobs} transcription workers; at most eight seconds per request; $${reservedCost.toFixed(4)} previously reserved`);
  // This queue serializes ledger writes and derived snapshots across workers.
  let writes = Promise.resolve();
  function serialize(work: () => Promise<void>) {
    const result = writes.then(work);
    writes = result.catch(() => undefined);
    return result;
  }
  async function publish() {
    await serialize(async () => {
      const ordered = Object.fromEntries(tracks.flatMap(t => entries[t.id] ? [[t.id, entries[t.id]]] : []));
      const detected = Object.values(ordered).filter(e => e.status === "detected").length;
      const report = { model: MODEL, transcriptionContext: CONTEXT, timingMethod: "word-timestamps", clipSeconds: CLIP_SECONDS, pricePerMinuteUSD: RATE,
        maximumReservedCostUSD: Number(reservedCost.toFixed(6)),
        totalChapters: tracks.length, indexedChapters: Object.keys(ordered).length, detectedChapters: detected,
        needsReviewChapters: Object.keys(ordered).length - detected, chapters: ordered };
      await atomic(REPORT, report);
      const uncertain = tracks.filter(t => entries[t.id]?.status === "needs-review");
      const lines = ["# MSB audio start offsets requiring review", "", "Generated from only the first eight seconds of each recording. Uncertain offsets remain null and are never guessed.", "", "Playback offsets start just after the narrator finishes ‘Audio Bible’; book/chapter announcements remain.", "", `Indexed ${report.indexedChapters}/${tracks.length}; detected ${detected}; review ${uncertain.length}.`, "", "| Chapter | Reason | First-eight-second transcript | Recording |", "| --- | --- | --- | --- |", ...uncertain.map(t => `| ${t.id} | ${entries[t.id].reason} | ${(entries[t.id].transcript ?? "").replace(/[|\n\r]/g, " ")} | [First 8 seconds](../../storage/audio/MSB/.work/${t.fileName}.first8.wav) · [Full MP3](${t.url}) |`), ""];
      await atomic(REVIEW, lines.join("\n"));
      await atomic(path.join(WORK, "progress.json"), { downloaded, reused, indexed: completed, errors, maximumReservedCostUSD: reservedCost });
    });
  }
  await pool(selected, downloadJobs, async track => {
    const file = path.join(AUDIO, track.fileName), receiptFile = path.join(WORK, `${track.fileName}.download.json`);
    try {
      let receipt = await json<Receipt>(receiptFile);
      const bytes = await stat(file).then(s => s.size).catch(() => 0);
      if (receipt && receipt.url === track.url && receipt.bytes === bytes && receipt.sha256 === await hash(file)) {
        reused++;
      } else {
        if (!bytes || receipt) {
          const partial = `${file}.part`;
          await exec("curl", ["--fail", "--silent", "--show-error", "--location", "--retry", "2", "--connect-timeout", "15", "--max-time", "120", "--output", partial, track.url]);
          // Validate the full download before activation; HTTP failures retain .part only.
          const length = await duration(partial);
          if (length < 8) throw new Error("Chapter recording shorter than eight seconds");
          await rename(partial, file);
        }
        receipt = { url: track.url, bytes: (await stat(file)).size, sha256: await hash(file), duration: await duration(file) };
        await atomic(receiptFile, receipt); downloaded++;
      }
      receipts.set(track.id, receipt);
      if ((downloaded + reused) % 50 === 0) console.log(`Audio: ${downloaded} downloaded; ${reused} verified/reused; ${Object.keys(errors).length} errors`);
      // Durable per-file receipts already allow interruption between summary writes.
      await serialize(() => atomic(path.join(WORK, "progress.json"), { downloaded, reused, errors }));
    } catch (error) { errors[track.id] = String(error); console.error(`Download ${track.id}: ${String(error)}`); }
  });
  console.log(`Downloads finished: ${downloaded} new, ${reused} reused, ${Object.keys(errors).length} failed`);
  if (flag("--download-only") || stopping) { if (Object.keys(errors).length) process.exitCode = 1; return; }
  // Per-chapter files, rather than the aggregate report, are the resumable source.
  for (const track of tracks) {
    // A scoped rerun must preserve already indexed Chapters outside its scope.
    const inScope = receipts.has(track.id) || selected.some(t => t.id === track.id);
    const receipt = receipts.get(track.id) ?? (!inScope ? await json<Receipt>(path.join(WORK, `${track.fileName}.download.json`)) : undefined);
    if (!receipt) {
      if (inScope) entries[track.id] = { status: "needs-review", startSeconds: null, reason: "download-failed", sourceSha256: "" };
      continue;
    }
    const saved = await json<Entry>(path.join(WORK, `${track.fileName}.offset.json`));
    const retryWithContext = inScope && flag("--retry-with-context") && saved?.status === "needs-review" && !saved.reason.startsWith("transcription-") && saved.transcriptionContext !== CONTEXT;
    const retryInNewRound = inScope && retryReview && saved?.transcriptionContext !== CONTEXT;
    const updateFocusedAnalysis = inScope && retryReview && saved?.transcriptionContext === CONTEXT && saved.analysisVersion !== ANALYSIS_VERSION;
    if (saved?.sourceSha256 === receipt.sha256 && !(inScope && saved.reason.startsWith("preparation-error")) && !retryWithContext && !retryInNewRound && !updateFocusedAnalysis && !(inScope && flag("--reanalyze")) && !(inScope && flag("--retry-errors") && saved.reason.startsWith("transcription-"))) {
      entries[track.id] = saved; if (inScope) completed++;
    } else if (inScope && saved?.sourceSha256 === receipt.sha256) {
      // Keep the published index complete while replacing retry results one by one.
      entries[track.id] = saved; needsWork.add(track.id);
    }
  }
  await publish();
  await pool(selected.filter(t => !entries[t.id] || needsWork.has(t.id)), transcriptionJobs, async track => {
    const receipt = receipts.get(track.id)!;
    const prefix = path.join(WORK, track.fileName);
    const context = retryReview ? CONTEXT : entries[track.id]?.transcriptionContext ?? CONTEXT;
    const focused = context === "intro-focus-v2";
    const responseFile = `${prefix}.transcript.${context}.json`, pendingFile = `${prefix}.request.${context}.json`;
    let entry: Entry;
    let phase = "preparation";
    try {
      const clip = focused ? `${prefix}.first8.${context}.wav` : `${prefix}.first8.wav`;
      let expectedSeconds = CLIP_SECONDS;
      // The service only ever receives this decoded PCM window, never the MP3.
      if (focused) {
        const fullClip = `${prefix}.first8.wav`;
        const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", fullClip, "-af", "silencedetect=noise=-35dB:d=0.04", "-f", "null", "-"]);
        expectedSeconds = introClipEnd(parsePauses(stderr));
        await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", fullClip, "-t", String(expectedSeconds), "-c:a", "pcm_s16le", clip]);
      } else {
        await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(AUDIO, track.fileName), "-af", "aresample=16000:async=1:first_pts=0", "-t", String(CLIP_SECONDS), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", clip]);
      }
      const clipDuration = await duration(clip);
      if (clipDuration > CLIP_SECONDS || Math.abs(clipDuration - expectedSeconds) > 0.001) throw new Error("Invalid clip window; only the first eight seconds are allowed");
      const clipSha256 = await hash(clip);
      phase = "transcription";
      type Cached = { model: string; prompt?: string; sourceSha256: string; clipSha256: string; clipSeconds: number; response: IntroTranscript };
      let cached = await json<Cached>(responseFile);
      if (!cached && !focused && !flag("--retry-with-context")) cached = await json<Cached>(`${prefix}.transcript.json`);
      const [book, chapter] = track.id.split(":");
      const prompt = focused ? `Audio Bible. ${book}. Chapter ${chapter}.` : PROMPT;
      if (!cached || cached.model !== MODEL || cached.sourceSha256 !== receipt.sha256 || cached.clipSha256 !== clipSha256 || cached.clipSeconds !== clipDuration || (focused && cached.prompt !== prompt)) {
        if (flag("--reanalyze")) throw new Error("transcription-cache-missing; reanalysis never uploads audio");
        const pending = await json<Attempt>(pendingFile) ?? (!focused ? await json<Attempt>(`${prefix}.request.json`) : undefined);
        if (pending && !flag("--retry-errors")) throw new Error("transcription-interrupted-or-failed-request; inspect before explicitly retrying");
        client ??= new OpenAI({ maxRetries: 0, timeout: 90_000 });
        await serialize(async () => {
          const maximumCost = Math.ceil(clipDuration) / 60 * RATE;
          if (reservedCost + maximumCost > budget + 1e-9) throw new Error("transcription-cost-cap-reached");
          const attempt = { at: new Date().toISOString(), fileName: track.fileName, clipSha256, maximumCost, model: MODEL, context, clipSeconds: clipDuration };
          reservedCost += maximumCost; attempts.push(attempt);
          // Save reservation before uploading. Interrupted requests are never silently resent.
          await atomic(ledgerFile, attempts); await atomic(pendingFile, attempt);
        });
        const response = await client.audio.transcriptions.create({ file: createReadStream(clip), model: MODEL,
          language: "en", temperature: 0, prompt, response_format: "verbose_json", timestamp_granularities: ["word", "segment"] });
        cached = { model: MODEL, prompt, sourceSha256: receipt.sha256, clipSha256, clipSeconds: clipDuration, response };
        await atomic(responseFile, cached);
        await rm(pendingFile, { force: true });
      }
      phase = "preparation";
      const confirmationClip = focused ? `${prefix}.first8.wav` : clip;
      if (focused) {
        const candidates: IntroCandidate[] = [{ source: context, transcript: cached.response }];
        const fullClipHash = await hash(confirmationClip);
        for (const previousContext of ["recording-announcement-v1", "original"]) {
          const previousFile = previousContext === "original" ? `${prefix}.transcript.json` : `${prefix}.transcript.${previousContext}.json`;
          const previous = await json<Cached>(previousFile);
          if (previous?.model === MODEL && previous.sourceSha256 === receipt.sha256 && previous.clipSha256 === fullClipHash && previous.clipSeconds === CLIP_SECONDS) {
            candidates.push({ source: previousContext, transcript: previous.response });
          }
        }
        entry = { ...reconcileIntroOffsets(candidates), sourceSha256: receipt.sha256, transcriptionContext: context, analysisVersion: ANALYSIS_VERSION };
      } else {
        entry = { ...findIntroOffset(cached.response), sourceSha256: receipt.sha256, transcript: cached.response.text, transcriptionContext: cached.prompt === prompt ? context : undefined, analysisVersion: ANALYSIS_VERSION };
      }
    } catch (error) {
      entry = { status: "needs-review", startSeconds: null, reason: `${phase}-error: ${String(error).slice(0, 300)}`, sourceSha256: receipt.sha256, transcriptionContext: context, analysisVersion: ANALYSIS_VERSION };
      console.error(`${track.id}: ${entry.reason}`);
    }
    await atomic(`${prefix}.offset.json`, entry);
    entries[track.id] = entry; completed++;
    await publish();
    if (completed % 25 === 0) console.log(`Indexed ${completed}/${selected.length}; review ${Object.values(entries).filter(e => e.status === "needs-review").length}; reserved $${reservedCost.toFixed(4)}`);
  });
  await publish();
  const compact = JSON.stringify(Object.fromEntries(tracks.map(track => [track.id,
    entries[track.id]?.status === "detected" ? entries[track.id].startSeconds : null])));
  await atomic(COMPACT, compact);
  await atomic(`${COMPACT}.gz`, gzipSync(compact, { level: 9 }));
  await atomic(`${COMPACT}.br`, brotliCompressSync(compact));
  console.log(`Saved ${Object.keys(entries).length} chapter offsets to ${path.relative(ROOT, REPORT)}; maximum reserved cost $${reservedCost.toFixed(4)}. Review: ${path.relative(ROOT, REVIEW)}`);
  if (Object.keys(errors).length || selected.some(t => /^(transcription|preparation)-error/.test(entries[t.id]?.reason ?? ""))) process.exitCode = 1;
}
