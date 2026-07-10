import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    return new Response("Not found", { status: 404 });
  }

  const release = url.searchParams.get("release") ?? "test";
  const failStage =
    url.searchParams.get("failStage") === "1" ? "&failStage=1" : "";
  const coreUrl = `/cross-canon-sw.js?release=${encodeURIComponent(
    release
  )}${failStage}`;

  return new Response(
    `/* Cross Canon local E2E release: ${JSON.stringify(
      release
    )} */\nimportScripts(${JSON.stringify(coreUrl)});\n`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    }
  );
}
