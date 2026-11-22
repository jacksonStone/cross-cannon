// Stop the WASM bootstrap: iOS must see the saved theme before the reader starts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import puppeteer from 'puppeteer';

const shell = await fs.readFile('web/index.html', 'utf8');
const css = await fs.readFile('web/reader.css', 'utf8');
const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html'); response.end(shell);
  } else if (request.url === '/browser/reader.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(css);
  } else if (request.url === '/browser/start.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end('');
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
const results = [];
try {
  for (const [name, storage, expected] of [
    ['saved dark checkpoint', {'cross-canon/browser-reader-v1': JSON.stringify({reader: '(theme:Dark,location_passage_id:"saved")'})}, 'rgb(23, 23, 23)'],
    ['legacy dark preference', {'cross-cannon:reader-settings:v1': JSON.stringify({theme: 'dark'})}, 'rgb(23, 23, 23)'],
    ['saved paper overrides legacy dark', {'cross-canon/browser-reader-v1': JSON.stringify({reader: '(theme:Paper)'}), 'cross-cannon:reader-settings:v1': JSON.stringify({theme: 'dark'})}, 'rgb(251, 250, 247)'],
    ['saved sepia checkpoint', {'cross-canon/browser-reader-v1': JSON.stringify({reader: '(theme:Sepia)'})}, 'rgb(244, 236, 217)'],
    ['saved contrast checkpoint', {'cross-canon/browser-reader-v1': JSON.stringify({reader: '(theme:Contrast)'})}, 'rgb(255, 255, 255)'],
    ['fresh reader', {}, 'rgb(251, 250, 247)'],
    ['malformed storage', {'cross-canon/browser-reader-v1': 'invalid'}, 'rgb(251, 250, 247)'],
  ]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({width: 393, height: 852, isMobile: true, hasTouch: true});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(values => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    }, storage);
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: 'networkidle0'});
    const state = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      loading: getComputedStyle(document.querySelector('#loading')).backgroundColor,
      themeColor: document.querySelector('meta[name=theme-color]').content,
      statusBar: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
      readerStarted: !!window.crossCanonReader,
    }));
    results.push({name, ...state});
    assert.equal(state.readerStarted, false);
    for (const element of ['root', 'body', 'loading']) assert.equal(state[element], expected, `${name}: ${element} must use the saved theme before WASM`);
    assert.equal(state.statusBar, expected === 'rgb(23, 23, 23)' ? 'black-translucent' : 'default');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
