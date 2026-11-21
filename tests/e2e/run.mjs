// End-to-end test: runs the real app in headless Chromium.
//
//  1. The fake camera plays a video (built with ffmpeg from a real photo of a
//     hand) in which an open palm stays still, then moves sideways: the whole
//     pipeline (camera -> MediaPipe -> engine -> UI) must recognise the hand,
//     the "hold" and the swipe, and the gallery must change photo.
//  2. The camera is paused and the engine is fed with real landmarks moved
//     around the screen, to check the air cursor: pinch-click on the
//     calculator keys and pinch-drag of the light slider.
//
// Requirements: Playwright with Chromium, ffmpeg. Usage: npm run test:e2e
// Screenshots are written to $E2E_OUT (default: a temporary directory).

import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = process.env.E2E_OUT || mkdtempSync(join(tmpdir(), 'gesto-e2e-'));
const port = 8000 + Math.floor(Math.random() * 900);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return createRequire(join(globalRoot, 'noop.js'))('playwright');
  }
}

function makeVideo() {
  const file = join(out, 'palm.y4m');
  // Right hand of right_hands.jpg: still for 1.6 s, then moves 260 px to the
  // left of the image in 0.3 s (= to the user's right, the camera is mirrored).
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=white:s=640x480:r=30:d=3.5',
    '-loop', '1', '-framerate', '30', '-i', join(root, 'tests/fixtures/hands/right_hands.jpg'),
    '-filter_complex',
    "[1]crop=340:382:380:0[h];[0][h]overlay=x='if(lt(t,1.6),150,if(lt(t,1.9),150-(t-1.6)/0.3*260,-110))':y=50:shortest=1,format=yuv420p",
    '-t', '3.5', '-r', '30', file,
  ]);
  return file;
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message}`);
    throw err;
  }
}

const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const { chromium, devices } = loadPlaywright();
const video = makeVideo();
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});

let failed = false;
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  const page = await context.newPage();
  // Headless Chromium has no real GPU: the CPU delegate is much faster there.
  await page.addInitScript(() => {
    if (!localStorage.getItem('gesto.settings.v1')) localStorage.setItem('gesto.settings.v1', JSON.stringify({ gpu: false }));
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await step('the intro screen loads', async () => {
    await page.goto(`http://localhost:${port}/?nosw`);
    await page.waitForFunction(() => window.gesto);
    assert.ok(await page.isVisible('#btn-start'));
    await page.screenshot({ path: join(out, '1-intro.png') });
  });

  await page.evaluate(() => {
    window.__events = [];
    for (const t of ['gesture', 'pose', 'hand']) window.gesto.controller.on(t, (d) => window.__events.push({ type: t, ...d }));
  });
  const waitEvent = (pred, timeout = 15000) =>
    page.waitForFunction(new Function('e', `return window.__events.some(${pred})`), null, { timeout });

  await step('camera and model start', async () => {
    await page.click('#btn-start');
    await page.waitForFunction(() => window.gesto.controller.status === 'running', null, { timeout: 60000 });
    assert.ok(await page.isHidden('#intro'));
  });

  await step('a real hand is detected as an open palm', async () => {
    await waitEvent("(e) => e.type === 'hand' && e.present");
    await waitEvent("(e) => e.type === 'pose' && e.pose === 'open_palm'");
  });

  await step('holding the palm still fires hold_open_palm', async () => {
    await waitEvent("(e) => e.id === 'hold_open_palm'");
  });

  await step('moving the palm to the user right is a swipe_right', async () => {
    await waitEvent("(e) => e.id === 'swipe_right'");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, '2-playground.png') });
  });

  await step('the gallery changes photo with the swipes of the video', async () => {
    await page.evaluate(() => window.gesto.switchApp('galleria'));
    const before = await page.evaluate(() => window.gesto.apps.find((a) => a.id === 'galleria').index);
    await page.evaluate(() => (window.__events = []));
    await waitEvent("(e) => e.id === 'swipe_right' || e.id === 'swipe_left'", 20000);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.gesto.apps.find((a) => a.id === 'galleria').index);
    assert.notEqual(after, before);
    await page.screenshot({ path: join(out, '3-gallery.png') });
  });

  // ---- synthetic landmarks: air cursor -----------------------------------
  const fixtures = JSON.parse(readFileSync(join(root, 'tests/fixtures/hands-landmarks.json'), 'utf8'));
  await page.evaluate((fx) => {
    const { controller, engine } = window.gesto;
    controller.pause();
    const m = engine.options.pointer.margin;
    const base = fx['right_hands.jpg'].hands[1]; // open hand, fingers up
    let t = performance.now() + 1000;
    const pinch = (pts) => {
      const p = pts.map((q) => [...q]);
      const tip = p[4];
      const mcp = p[5];
      p[8] = [tip[0] + (mcp[0] - tip[0]) * 0.05, tip[1] + (mcp[1] - tip[1]) * 0.05, tip[2]];
      p[7] = [mcp[0] + (p[8][0] - mcp[0]) * 0.8, mcp[1] + (p[8][1] - mcp[1]) * 0.8, tip[2]];
      p[6] = [mcp[0] + (p[8][0] - mcp[0]) * 0.45, mcp[1] + (p[8][1] - mcp[1]) * 0.45, tip[2]];
      return p;
    };
    // Feeds `n` frames with the index tip at screen position (sx, sy) (0..1).
    window.__feed = (sx, sy, { pinched = false, n = 12 } = {}) => {
      // Inverse of the engine mapping (mirrored camera + margin).
      const tx = 1 - (m + sx * (1 - 2 * m));
      const ty = m + sy * (1 - 2 * m);
      const dx = tx - base.landmarks[8][0];
      const dy = ty - base.landmarks[8][1];
      let lm = base.landmarks.map(([x, y, z]) => [x + dx, y + dy, z]);
      let world = base.world;
      if (pinched) {
        // Keep the palm where it is: only the fingers close.
        lm = pinch(lm);
        world = pinch(world);
      }
      for (let i = 0; i < n; i++) {
        t += 33;
        engine.process({ timestamp: t, width: 720, height: 382, hands: [{ landmarks: lm, world, category: 'None', score: 0.5 }] });
      }
    };
    window.__center = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return [(r.left + r.width / 2) / innerWidth, (r.top + r.height / 2) / innerHeight];
    };
  }, fixtures);

  await step('pinch-click types 7 × 6 = 42 on the calculator', async () => {
    await page.evaluate(() => window.gesto.switchApp('cursore'));
    await page.waitForTimeout(300);
    for (const key of ['7', '×', '6', '=']) {
      await page.evaluate((k) => {
        const [x, y] = window.__center(`[data-key="${k}"]`);
        window.__feed(x, y, { n: 20 });
        window.__feed(x, y, { pinched: true, n: 4 });
        window.__feed(x, y, { n: 4 });
      }, key);
    }
    const display = await page.textContent('[data-ref="display"]');
    assert.equal(display, '42');
    assert.ok(await page.isVisible('#cursor.visible'));
  });

  await step('pinch-drag moves the light slider', async () => {
    const before = await page.evaluate(() => window.gesto.apps.find((a) => a.id === 'cursore').brightness);
    await page.evaluate(() => {
      const knob = document.querySelector('[data-ref="knob"]').getBoundingClientRect();
      const slider = document.querySelector('[data-ref="slider"]').getBoundingClientRect();
      const y = (knob.top + knob.height / 2) / innerHeight;
      const x0 = (knob.left + knob.width / 2) / innerWidth;
      const x1 = (slider.right - 4) / innerWidth;
      window.__feed(x0, y, { n: 20 });
      window.__feed(x0, y, { pinched: true, n: 4 });
      for (let i = 1; i <= 10; i++) window.__feed(x0 + ((x1 - x0) * i) / 10, y, { pinched: true, n: 3 });
      window.__feed(x1, y, { pinched: true, n: 10 });
      window.__feed(x1, y, { n: 4 });
    });
    const after = await page.evaluate(() => window.gesto.apps.find((a) => a.id === 'cursore').brightness);
    assert.ok(after > before + 30, `brightness ${before} -> ${after}`);
    await page.screenshot({ path: join(out, '4-cursor.png') });
  });

  await step('pinch-drag scrolls the reader (no cursor needed)', async () => {
    await page.evaluate(() => window.gesto.switchApp('lettore'));
    await page.waitForTimeout(200);
    const top = await page.evaluate(() => {
      window.__feed(0.5, 0.7, { n: 20 });
      window.__feed(0.5, 0.7, { pinched: true, n: 4 });
      for (let i = 1; i <= 10; i++) window.__feed(0.5, 0.7 - i * 0.04, { pinched: true, n: 2 });
      window.__feed(0.5, 0.3, { n: 4 });
      return document.querySelector('.view[data-app="lettore"]').scrollTop;
    });
    assert.ok(top > 150, `reader scrolled by ${top}px`);
  });

  await step('with the global cursor, pinch-drag scrolls any view', async () => {
    await page.evaluate(() => {
      window.gesto.settings.globalCursor = true;
      window.gesto.switchApp('prova');
    });
    await page.waitForTimeout(200);
    const top = await page.evaluate(() => {
      // Start on the gesture guide (not a button), drag upwards.
      window.__feed(0.5, 0.75, { n: 20 });
      window.__feed(0.5, 0.75, { pinched: true, n: 4 });
      for (let i = 1; i <= 10; i++) window.__feed(0.5, 0.75 - i * 0.04, { pinched: true, n: 2 });
      window.__feed(0.5, 0.35, { n: 4 });
      return document.querySelector('.view[data-app="prova"]').scrollTop;
    });
    await page.evaluate(() => (window.gesto.settings.globalCursor = false));
    assert.ok(top > 150, `view scrolled by ${top}px`);
  });

  await step('hold rock switches to the next app', async () => {
    await page.evaluate(() => window.gesto.switchApp('cursore'));
    const rock = await page.evaluate(() => {
      const before = document.querySelector('.view.active').dataset.app;
      window.gesto.controller.engine.dispatchEvent(new CustomEvent('gesture', { detail: { id: 'hold_rock', repeat: false } }));
      return [before, document.querySelector('.view.active').dataset.app];
    });
    assert.deepEqual(rock, ['cursore', 'lavagna']);
  });

  await step('every app renders without errors', async () => {
    for (const id of ['prova', 'galleria', 'musica', 'cursore', 'lavagna', 'lettore']) {
      await page.evaluate((a) => window.gesto.switchApp(a), id);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `app-${id}.png`) });
    }
    await page.click('#btn-settings');
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(out, 'settings.png') });
    const relevant = errors.filter((e) => !/XNNPACK|TensorFlow Lite|GL Driver|OpenGL/.test(e));
    assert.deepEqual(relevant, []);
  });

  // ---- integration examples ----------------------------------------------
  await step('examples/slides.html: the library changes slide with a real swipe', async () => {
    const p2 = await context.newPage();
    await p2.goto(`http://localhost:${port}/examples/slides.html`);
    await p2.click('#start');
    await p2.waitForFunction(() => !document.querySelector('#start'), null, { timeout: 60000 });
    // The fake camera loops: a swipe_right (previous) then a swipe_left (next) come back.
    await p2.waitForFunction(() => document.querySelectorAll('.slide')[1].style.opacity === '1', null, { timeout: 20000 });
    await p2.close();
  });

  await step('examples/embed.html: the host page receives gestures via postMessage', async () => {
    const p3 = await context.newPage();
    await p3.goto(`http://localhost:${port}/examples/embed.html`);
    const frame = p3.frameLocator('iframe');
    await frame.locator('#btn-start').click();
    await p3.waitForFunction(() => document.querySelectorAll('#log li').length > 0, null, { timeout: 30000 });
    const first = await p3.textContent('#log li');
    assert.match(first, /swipe_|hold_/);
    await p3.screenshot({ path: join(out, '5-embed.png') });
    await p3.close();
  });
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
  server.kill();
  console.log(results.join('\n'));
  console.log(`Screenshots: ${out}`);
  process.exit(failed ? 1 : 0);
}
