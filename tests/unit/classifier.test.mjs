import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHand, classifyFeatures, fusePose } from '../../src/core/classifier.js';
import { allFixtureHands, fixtureHand, makePinch } from './helpers.mjs';

const EXPECTED = {
  'fist.jpg': 'fist',
  'left_hands.jpg': 'open_palm',
  'pointing_up.jpg': 'point',
  'pointing_up_rotated.jpg': 'point',
  'right_hands.jpg': 'open_palm',
  'right_hands_rotated.jpg': 'open_palm',
  'thumb_up.jpg': 'thumb_up',
  'victory.jpg': 'victory',
};

const classify = (h) => classifyFeatures(analyzeHand(h.landmarks, h.world, h.width / h.height));

test('classifies every real hand of the fixtures', () => {
  for (const h of allFixtureHands()) {
    assert.equal(classify(h), EXPECTED[h.name], `${h.name}#${h.index}`);
  }
});

test('is rotation invariant (hands upside down)', () => {
  const flip = (h) => ({
    ...h,
    landmarks: h.landmarks.map(([x, y, z]) => [x, 1 - y, z]),
    world: h.world.map(([x, y, z]) => [x, -y, z]),
  });
  for (const h of allFixtureHands()) {
    const expected = EXPECTED[h.name] === 'thumb_up' ? 'thumb_down' : EXPECTED[h.name];
    assert.equal(classify(flip(h)), expected, `${h.name}#${h.index} flipped`);
  }
});

test('works without world landmarks (image coordinates only)', () => {
  for (const h of allFixtureHands()) {
    assert.equal(classify({ ...h, world: null }), EXPECTED[h.name], `${h.name}#${h.index}`);
  }
});

test('pinch ratio is small for a pinch and large otherwise', () => {
  const palm = fixtureHand('right_hands.jpg');
  const a = analyzeHand(palm.landmarks, palm.world);
  const b = analyzeHand(makePinch(palm).landmarks, makePinch(palm).world);
  assert.ok(a.pinchRatio > 0.5, `open hand ratio ${a.pinchRatio}`);
  assert.ok(b.pinchRatio < 0.2, `pinch ratio ${b.pinchRatio}`);
  const fist = fixtureHand('fist.jpg');
  assert.ok(analyzeHand(fist.landmarks, fist.world).indexReach < 0.95, 'a fist is not a pinch');
});

test('fusion prefers the confident model, falls back to geometry', () => {
  assert.equal(fusePose('none', 'Thumb_Up', 0.9), 'thumb_up');
  assert.equal(fusePose('open_palm', 'None', 0.9), 'open_palm');
  assert.equal(fusePose('none', 'Victory', 0.55), 'victory');
  assert.equal(fusePose('none', 'Victory', 0.3), 'none');
  assert.equal(fusePose('fist', 'Open_Palm', 0.95, 'geometric'), 'fist');
  assert.equal(fusePose('fist', 'None', 0.95, 'model'), 'none');
});
