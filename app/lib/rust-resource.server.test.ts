import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { forwardRustApi, forwardRustResource } from "./rust-resource.server";

test("Rust transport preserves raw gzip, ranges, HEAD and host restrictions", async () => {
  const gzip = gzipSync('{"existing":"text"}');
  const server = createServer((req, res) => {
    assert.equal(req.headers.host, "www.crosscanon.com");
    if (req.url?.includes("/audio/")) {
      assert.equal(req.headers.range, "bytes=2-4");
      res.writeHead(206, { "Content-Range": "bytes 2-4/10", "Content-Length": "3", "Content-Type": "audio/mp4" });
      res.end(req.method === "HEAD" ? undefined : "234");
    } else {
      res.writeHead(200, { "Content-Encoding": "gzip", "Content-Length": String(gzip.length), "Content-Type": "application/json", "Cache-Control": "public, max-age=60" });
      res.end(req.method === "HEAD" ? undefined : gzip);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const previous = process.env.R_CROSS_CANNON_ORIGIN;
  process.env.R_CROSS_CANNON_ORIGIN = `http://127.0.0.1:${address.port}`;
  const args = (request: Request) => ({ request, params: {}, context: {} });
  try {
    const response = await forwardRustResource(args(new Request("https://www.crosscanon.com/scripture-cache/0123456789abcdef.json", { headers: { "Accept-Encoding": "gzip" } })));
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.equal(response.headers.get("content-length"), String(gzip.length));
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), gzip);
    for (const method of ["GET", "HEAD"]) {
      const audio = await forwardRustResource(args(new Request("https://www.crosscanon.com/audio/continuous/test.m4a", { method, headers: { Range: "bytes=2-4" } })));
      assert.equal(audio.status, 206);
      assert.equal(audio.headers.get("content-range"), "bytes 2-4/10");
      assert.equal(audio.headers.get("content-length"), "3");
      assert.equal(await audio.text(), method === "HEAD" ? "" : "234");
    }
    const large = await forwardRustApi(args(new Request("https://www.crosscanon.com/r/api/search", { method: "POST", body: "x".repeat(16*1024+1) })));
    assert.equal(large.status, 413);
  } finally {
    if (previous === undefined) delete process.env.R_CROSS_CANNON_ORIGIN;
    else process.env.R_CROSS_CANNON_ORIGIN = previous;
    server.closeAllConnections(); server.close();
  }
});
