import path from "node:path";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { audioFileResponse } from "~/lib/audio-response.server";

export function loader({ params, request }: LoaderFunctionArgs) {
  if (
    !params.fileName ||
    !/^(bible|fathers)-[a-z0-9-]+-[a-f0-9]{16}\.m4a$/.test(params.fileName)
  )
    throw new Response("Not found", { status: 404 });
  return audioFileResponse(
    request,
    path.resolve("storage/audio/continuous", params.fileName),
    "audio/mp4"
  );
}
