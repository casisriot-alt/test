import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureEngine } from '../../src/core/engine.js';
import { fixtureHand, frame, makePinch, record } from './helpers.mjs';

const palm = fixtureHand('right_hands.jpg', 0);
const fist = fixtureHand('fist.jpg');
const thumbUp = fixtureHand('thumb_up.jpg');
const STEP = 33; // ~30 fps

function run(engine, frames) {
  for (const f of frames) engine.process(f);
}

/** Hand moving by (totalDx, totalDy) over `ms`, starting at time t0. */
function motion(hand, t0, ms, totalDx, totalDy = 0, offset = { dx: 0, dy: 0 }) {
  const n = Math.round(ms / STEP);
  return Array.from({ length: n + 1 }, (_, i) =>
    frame(t0 + i * STEP, hand, { dx: offset.dx + (totalDx * i) / n, dy: offset.dy + (totalDy * i) / n }),
  );
}

const still = (hand, t0, ms, offset) => motion(hand, t0, ms, 0, 0, offset);
const gestures = (events) => events.filter((e) => e.type === 'gesture').map((e) => e.id);

test('detects the stable pose and the hand presence', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  run(engine, still(fist, 0, 200));
  assert.equal(engine.pose, 'fist');
  assert.deepEqual(events.slice(0, 2).map((e) => e.type), ['hand', 'pose']);
  run(engine, [frame(300, null), frame(400, null), frame(700, null)]);
  assert.equal(engine.present, false);
  assert.equal(events.at(-1).type, 'hand');
  assert.equal(events.at(-1).present, false);
});

test('swipes are reported from the user point of view (mirrored camera)', () => {
  const engine = new GestureEngine({ mirror: true });
  const events = record(engine);
  // In the raw image the hand moves towards smaller x: for the user (mirror) it goes right.
  run(engine, [...still(palm, 0, 300), ...motion(palm, 333, 300, -0.3)]);
  assert.deepEqual(gestures(events), ['swipe_right']);

  const rear = new GestureEngine({ mirror: false });
  const ev2 = record(rear);
  run(rear, [...still(palm, 0, 300), ...motion(palm, 333, 300, -0.3)]);
  assert.deepEqual(gestures(ev2), ['swipe_left']);
});

test('vertical swipes, and slow movements are not swipes', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  run(engine, [...still(palm, 0, 300), ...motion(palm, 333, 250, 0, 0.3)]);
  assert.deepEqual(gestures(events), ['swipe_down']);

  const slow = new GestureEngine();
  const ev2 = record(slow);
  run(slow, motion(palm, 0, 3000, 0.4));
  assert.deepEqual(gestures(ev2).filter((g) => g.startsWith('swipe')), []);
});

test('the return stroke right after a swipe is ignored', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  run(engine, [
    ...motion(palm, 0, 300, -0.3), // swipe right (mirrored)
    ...motion(palm, 400, 300, 0.3, 0, { dx: -0.3, dy: 0 }), // back to the start, quickly
  ]);
  assert.deepEqual(gestures(events), ['swipe_right']);
});

test('a fist moving fast is not a swipe', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  run(engine, motion(fist, 0, 300, -0.3));
  assert.deepEqual(gestures(events).filter((g) => g.startsWith('swipe')), []);
});

test('holding a pose still fires hold_<pose>, then repeats', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  const progress = [];
  engine.addEventListener('holdprogress', (e) => progress.push(e.detail.progress));
  run(engine, still(thumbUp, 0, 1800));
  const holds = events.filter((e) => e.type === 'gesture');
  assert.equal(holds[0].id, 'hold_thumb_up');
  assert.equal(holds[0].repeat, false);
  assert.ok(holds.length >= 2 && holds.slice(1).every((h) => h.repeat), 'repeats while held');
  assert.ok(progress.some((p) => p > 0.4 && p < 0.9), 'reports progress');
});

test('moving the hand cancels a hold', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  // Slow drift: 0.3 of the frame in 1.5 s (not a swipe, not still).
  run(engine, motion(fist, 0, 1500, 0.3));
  assert.deepEqual(gestures(events), []);
});

test('no hold right after a swipe until the pose changes', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  run(engine, [...motion(palm, 0, 300, -0.3), ...still(palm, 333, 1500, { dx: -0.3, dy: 0 })]);
  assert.deepEqual(gestures(events), ['swipe_right']);
});

test('a quick pinch is a tap at the position of the finger before pinching', () => {
  const engine = new GestureEngine();
  const events = record(engine);
  const pinch = makePinch(palm);
  run(engine, [...still(palm, 0, 500), ...still(pinch, 533, 200), ...still(palm, 766, 300)]);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('pinchstart') && types.includes('pinchend'));
  const tap = events.find((e) => e.id === 'tap');
  assert.ok(tap, 'tap emitted');
  // Pointer before pinching = mirrored index tip, mapped with the margin.
  const m = engine.options.pointer.margin;
  const expectedX = (1 - palm.landmarks[8][0] - m) / (1 - 2 * m);
  assert.ok(Math.abs(tap.x - Math.min(Math.max(expectedX, 0), 1)) < 0.02, `tap x ${tap.x} vs ${expectedX}`);
});

test('a long pinch with movement is a drag, not a tap', () => {
  const engine = new GestureEngine();
  const events = record(engine, ['gesture', 'pinchstart', 'pinchend']);
  const moves = [];
  engine.addEventListener('pinchmove', (e) => moves.push(e.detail));
  const pinch = makePinch(palm);
  run(engine, [...still(palm, 0, 400), ...motion(pinch, 433, 1500, 0, 0.2), ...still(palm, 1966, 300, { dx: 0, dy: 0.2 })]);
  assert.ok(moves.length > 10);
  assert.ok(moves.at(-1).dy > 0.15, `dragged down by ${moves.at(-1).dy}`);
  assert.equal(events.find((e) => e.id === 'tap'), undefined);
  assert.ok(events.some((e) => e.type === 'pinchend' && e.moved > 0.1));
});

test('a fist never starts a pinch', () => {
  const engine = new GestureEngine();
  const events = record(engine, ['pinchstart']);
  run(engine, still(fist, 0, 1000));
  assert.equal(events.length, 0);
});

test('pointer stays within the screen and is smoothed', () => {
  const engine = new GestureEngine();
  const points = [];
  engine.addEventListener('pointer', (e) => points.push(e.detail));
  // Jittery hand: alternate ±0.01 around the same spot.
  run(engine, Array.from({ length: 60 }, (_, i) => frame(i * STEP, palm, { dx: i % 2 ? 0.01 : -0.01 })));
  const xs = points.slice(30).map((p) => p.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  assert.ok(spread < 0.01, `filtered jitter ${spread}`);
  assert.ok(points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
});

test('follows the same hand when two are visible', () => {
  const engine = new GestureEngine();
  const left = fixtureHand('right_hands.jpg', 0);
  const right = fixtureHand('right_hands.jpg', 1);
  const both = (t) => ({ ...frame(t, left), hands: [...frame(t, left).hands, ...frame(t, right).hands] });
  engine.process(frame(0, left));
  const c0 = engine.lastCenter;
  engine.process(both(33));
  assert.ok(Math.abs(engine.lastCenter[0] - c0[0]) < 0.01);
});
