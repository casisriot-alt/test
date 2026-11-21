// Robustness of the camera -> MediaPipe pipeline on misbehaving browsers.
// Each scenario breaks one piece the way some phones do and checks that the
// app recovers by itself and still recognises the (real) hand of the video.

import assert from 'node:assert/strict';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'gesto-robust-'));
const port = 8000 + Math.floor(Math.random() * 900);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
  }
}

const video = join(out, 'palm.y4m');
execFileSync('ffmpeg', [
  '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=white:s=640x480:r=30:d=2',
  '-loop', '1', '-framerate', '30', '-i', join(root, 'tests/fixtures/hands/right_hands.jpg'),
  '-filter_complex', '[1]crop=340:382:380:0[h];[0][h]overlay=x=150:y=50:shortest=1,format=yuv420p',
  '-t', '2', '-r', '30', video,
]);

const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});

async function scenario(name, { gpu, init, afterStart }, check) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['camera'] });
  await context.addInitScript((g) => localStorage.setItem('gesto.settings.v1', JSON.stringify({ gpu: g })), gpu);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  try {
    await page.goto(`http://localhost:${port}/?nosw`);
    await page.evaluate(() => {
      window.__hand = false;
      window.gesto.controller.on('hand', ({ present }) => present && (window.__hand = true));
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => window.gesto.controller.status === 'running', null, { timeout: 60000 });
    if (afterStart) await page.evaluate(afterStart);
    await page.waitForFunction(() => window.__hand, null, { timeout: 30000 });
    const diag = await page.evaluate(() => window.gesto.controller.diagnostics());
    await check(diag, page);
    console.log(`ok   ${name}  [${diag.delegato}, ${diag.ciclo}, ${diag.ingresso}] ${diag.note.join(' | ')}`);
  } finally {
    await context.close();
  }
}

let failed = false;
try {
  await scenario('frames reach MediaPipe through a canvas copy', { gpu: false }, (d) => {
    assert.equal(d.ingresso, 'canvas');
    assert.ok(d.luminosita > 100, `brightness ${d.luminosita}`);
  });

  await scenario(
    'a GPU that never sees hands is detected and replaced by the CPU',
    {
      gpu: true,
      afterStart: () => {
        const c = window.gesto.controller;
        c.recognizer.recognizeForVideo = () => ({ landmarks: [], worldLandmarks: [], handedness: [], gestures: [] });
      },
    },
    (d) => {
      assert.equal(d.delegato, 'CPU');
      assert.ok(d.note.some((n) => n.includes('non vedeva la mano')), d.note.join('|'));
    },
  );

  await scenario(
    'a GPU that throws errors is replaced by the CPU',
    {
      gpu: true,
      afterStart: () => {
        window.gesto.controller.recognizer.recognizeForVideo = () => {
          throw new Error('simulated WebGL failure');
        };
      },
    },
    (d) => {
      assert.equal(d.delegato, 'CPU');
      assert.ok(d.errori >= 10);
    },
  );

  await scenario(
    'a frame callback that never fires is replaced by requestAnimationFrame',
    {
      gpu: false,
      init: () => {
        HTMLVideoElement.prototype.requestVideoFrameCallback = () => 0;
      },
    },
    (d) => assert.equal(d.ciclo, 'raf'),
  );

  await scenario(
    'black frames from the canvas switch to the video element',
    {
      gpu: false,
      init: () => {
        // Simulate a browser whose 2D canvas cannot read the camera.
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
          if (src instanceof HTMLVideoElement) {
            this.fillStyle = '#000';
            return this.fillRect(0, 0, this.canvas.width, this.canvas.height);
          }
          return draw.call(this, src, ...rest);
        };
      },
    },
    (d) => assert.equal(d.ingresso, 'video'),
  );
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
