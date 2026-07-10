export function isLocalE2eOutageRequest(request: Request) {
  const url = new URL(request.url);
  return (
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.searchParams.get("__crossCanonE2eOutage") === "1"
  );
}
