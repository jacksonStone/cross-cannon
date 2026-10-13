import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createReadableStreamFromReadable } from "@remix-run/node";

export function parseAudioRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    (!match[1] && Number(match[2]) <= 0)
  )
    return null;
  return { start, end };
}

export async function audioFileResponse(
  request: Request,
  filePath: string,
  contentType: string
) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  const requestedRange = request.headers.get("range");
  const range = requestedRange
    ? parseAudioRange(requestedRange, info.size)
    : null;
  if (requestedRange && !range) {
    headers.set("Content-Range", `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set(
    "Content-Length",
    String(range ? range.end - range.start + 1 : info.size)
  );
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${info.size}`
    );
  return new Response(
    request.method === "HEAD"
      ? null
      : createReadableStreamFromReadable(
          createReadStream(filePath, range ?? undefined)
        ),
    { status: range ? 206 : 200, headers }
  );
}
