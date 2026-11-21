// End-to-end test of the PC bridge (bridge/server.mjs) in --dry-run mode:
// the app is opened from the bridge over HTTPS, connects back with the token
// and its gestures become key presses (logged, not sent, in dry-run mode).

import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = 9000 + Math.floor(Math.random() * 900);
const token = 'test' + Math.random().toString(16).slice(2, 8);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
  }
}

let output = '';
const bridge = spawn(process.execPath, [join(root, 'bridge/server.mjs'), '--port', String(port), '--token', token, '--dry-run'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
bridge.stdout.on('data', (d) => (output += d));
bridge.stderr.on('data', (d) => (output += d));
const waitOutput = async (text, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (!output.includes(text)) {
    if (Date.now() > end) throw new Error(`"${text}" not printed by the bridge. Output:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const results = [];
let failed = false;
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  await waitOutput('ponte PC attivo');
  results.push('ok   the bridge starts and prints its address');

  // Wrong token: the WebSocket upgrade is refused. (The self-signed
  // certificate of the bridge is trusted explicitly, for this request only.)
  const ca = readFileSync(join(root, 'bridge/.cert/cert.pem'));
  const refused = await new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: 'localhost', port, path: '/gesto?token=wrong', ca,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    });
    req.on('upgrade', () => resolve(false));
    req.on('response', (res) => resolve(res.statusCode === 403));
    req.on('error', reject);
    req.end();
  });
  assert.ok(refused, 'connection with a wrong token must fail');
  results.push('ok   a wrong token is refused');

  const context = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera'] });
  await context.addInitScript(() => localStorage.setItem('gesto.settings.v1', JSON.stringify({ gpu: false })));
  const page = await context.newPage();
  await page.goto(`https://localhost:${port}/?bridge=${token}&nosw`);
  await page.click('#btn-start');
  await page.waitForFunction(() => document.querySelector('#bridge-status').dataset.state === 'open', null, { timeout: 60000 });
  await waitOutput('Telefono collegato');
  results.push('ok   the app served by the bridge connects back with the token');

  await page.evaluate(() => {
    const fire = (detail) => window.gesto.engine.dispatchEvent(new CustomEvent('gesture', { detail }));
    fire({ id: 'swipe_left' });
    setTimeout(() => fire({ id: 'hold_thumb_up', repeat: false }), 200);
    setTimeout(() => fire({ id: 'hold_rock', repeat: false }), 400); // not mapped: ignored
  });
  await waitOutput('swipe_left       → Right');
  await waitOutput('hold_thumb_up    → VolumeUp');
  assert.ok(!output.includes('hold_rock'), 'unmapped gestures are ignored');
  results.push('ok   gestures become key presses on the computer');
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
  bridge.kill();
  console.log(results.join('\n'));
  process.exit(failed ? 1 : 0);
}
