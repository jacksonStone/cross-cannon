import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  createReadableStreamFromReadable,
  type LoaderFunctionArgs
} from "@remix-run/node";

const AUDIO_DIR = path.resolve(process.cwd(), "storage/audio/WEBD_AT");
const ONE_DAY_SECONDS = 86_400;

export async function loader({ params, request }: LoaderFunctionArgs) {
  const fileName = params.fileName;

  if (!fileName || !/^[A-Za-z0-9_]+\.mp3$/.test(fileName)) {
    throw new Response("Not found", { status: 404 });
  }

  const filePath = path.join(AUDIO_DIR, fileName);

  if (!filePath.startsWith(`${AUDIO_DIR}${path.sep}`)) {
    throw new Response("Not found", { status: 404 });
  }

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    throw new Response("Not found", { status: 404 });
  }

  const range = parseRange(request.headers.get("range"), stats.size);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": `public, max-age=${ONE_DAY_SECONDS}`,
    "Content-Type": "audio/mpeg"
  });

  if (range) {
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);

    return new Response(
      createReadableStreamFromReadable(createReadStream(filePath, range)),
      {
        headers,
        status: 206
      }
    );
  }

  headers.set("Content-Length", String(stats.size));

  return new Response(
    createReadableStreamFromReadable(createReadStream(filePath)),
    { headers }
  );
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }

  const startText = match[1];
  const endText = match[2];

  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      end: size - 1,
      start: Math.max(0, size - suffixLength)
    };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;

  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    return null;
  }

  return {
    end: Math.min(end, size - 1),
    start
  };
}
