// Keep Rust resources ahead of Remix's static middleware, which otherwise
// shadows the JSON routes with copies in public/ and build/client/.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.resolve('@remix-run/serve/package.json'));
// These are the pinned Remix server's existing production dependencies.
const express = require('express');
const compression = require('compression');
const { createRequestHandler } = require('@remix-run/express');
process.env.NODE_ENV ??= 'production';
const buildPath = process.argv[2] ? path.resolve(process.argv[2]) : new URL('./index.js', import.meta.url).pathname;
const build = await import(pathToFileURL(buildPath).href);
const remix = createRequestHandler({ build, mode: process.env.NODE_ENV });
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const resource = ['/r/api', '/scripture-cache/', '/church-fathers-preview/', '/christian-classics-text/', '/audio/WEBD_AT/', '/audio/continuous/'].some(prefix => req.path === prefix || req.path.startsWith(prefix.endsWith('/') ? prefix : prefix+'/'))
    || req.path === '/cross-canon-sw-release-test.js';
  return resource ? remix(req, res, next) : next();
});
app.use(compression());
app.use(build.publicPath, express.static(build.assetsBuildDirectory, { immutable: true, maxAge: '1y' }));
app.use(express.static('public', { maxAge: '1h' }));
app.all('*', remix);
const port = Number(process.env.PORT ?? 3005);
const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Cross Canon web http://${process.env.HOST ?? '127.0.0.1'}:${port}; resource handlers: Rust`));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => {
  server.close();
  server.closeIdleConnections();
});
