import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/hands-landmarks.json', import.meta.url)));

/** Real hands detected by MediaPipe in tests/fixtures/hands/*.jpg. */
export function fixtureHand(name, index = 0) {
  const entry = fixtures[name];
  const hand = entry.hands[index];
  return { ...hand, width: entry.width, height: entry.height };
}

export function allFixtureHands() {
  return Object.entries(fixtures).flatMap(([name, e]) =>
    e.hands.map((h, i) => ({ name, index: i, ...h, width: e.width, height: e.height })),
  );
}

/** Translates image landmarks by (dx, dy) in normalised units. */
export function translate(landmarks, dx, dy) {
  return landmarks.map(([x, y, z]) => [x + dx, y + dy, z]);
}

/** Moves the index finger so that its tip touches the thumb tip (a pinch). */
export function makePinch(hand) {
  const pinch = (pts) => {
    const p = pts.map((q) => [...q]);
    const tip = p[4];
    const mcp = p[5];
    // Bend the index: tip on the thumb, DIP/PIP interpolated towards the knuckle.
    p[8] = [tip[0] + (mcp[0] - tip[0]) * 0.05, tip[1] + (mcp[1] - tip[1]) * 0.05, tip[2]];
    p[7] = [mcp[0] + (p[8][0] - mcp[0]) * 0.8, mcp[1] + (p[8][1] - mcp[1]) * 0.8, tip[2]];
    p[6] = [mcp[0] + (p[8][0] - mcp[0]) * 0.45, mcp[1] + (p[8][1] - mcp[1]) * 0.45, tip[2]];
    return p;
  };
  return { ...hand, landmarks: pinch(hand.landmarks), world: pinch(hand.world), gesture: 'None', score: 0.5 };
}

/** Builds an engine frame from a fixture hand. */
export function frame(t, hand, { dx = 0, dy = 0 } = {}) {
  if (!hand) return { timestamp: t, hands: [] };
  return {
    timestamp: t,
    width: hand.width,
    height: hand.height,
    hands: [
      {
        landmarks: translate(hand.landmarks, dx, dy),
        world: hand.world,
        category: hand.gesture,
        score: hand.score,
        handedness: hand.handedness,
      },
    ],
  };
}

/** Collects the events dispatched by an engine. */
export function record(engine, types = ['gesture', 'pose', 'pinchstart', 'pinchend', 'hand']) {
  const events = [];
  for (const type of types) engine.addEventListener(type, (e) => events.push({ type, ...e.detail }));
  return events;
}
