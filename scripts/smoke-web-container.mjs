import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const server = spawn(process.execPath, ['/out/app/build/server/serve.mjs'], {
  cwd: '/out/app', env: { ...process.env, NODE_ENV: 'production', PORT: '3005' }, stdio: 'pipe',
});
let log = '';
server.stdout.on('data', (chunk) => { log += chunk; });
server.stderr.on('data', (chunk) => { log += chunk; });
try {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3005/api/account');
      if (response.ok) { assert.equal((await response.json()).configured, false); break; }
    } catch { /* Wait for the isolated server. */ }
    if (attempt === 80 || server.exitCode !== null) throw new Error('Container runtime failed: ' + log);
    await wait(100);
  }
  for (const pathname of ['/account', '/favicon-c26c421629d8.svg']) {
    assert.equal((await fetch('http://127.0.0.1:3005' + pathname)).status, 200);
  }
  console.log('Pruned Linux artifact serves account UI and public files without secrets or databases.');
} finally {
  server.kill('SIGTERM');
}
