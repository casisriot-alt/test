// Regenerates hands-landmarks.json: runs MediaPipe on tests/fixtures/hands/*.jpg
// in headless Chromium and stores landmarks, world landmarks and model output.
// Usage: node tests/fixtures/generate-landmarks.mjs
import { execSync, spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}

const port = 8700 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/tests/fixtures/landmarks.html`);
  await page.waitForFunction(() => window.probeReady);
  const names = readdirSync(join(root, 'tests/fixtures/hands')).filter((n) => n.endsWith('.jpg'));
  const result = await page.evaluate((n) => window.runProbe(n), names);
  writeFileSync(join(root, 'tests/fixtures/hands-landmarks.json'), JSON.stringify(result));
  for (const [k, v] of Object.entries(result)) console.log(k, v.hands.map((h) => `${h.handedness}:${h.gesture}`).join(' '));
} finally {
  await browser.close();
  server.kill();
}
