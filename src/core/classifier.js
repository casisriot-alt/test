// Geometric hand-pose classifier.
//
// Works on the 21 MediaPipe hand landmarks. Finger states are computed from
// distance ratios and joint angles, which makes the result independent of the
// hand's distance from the camera and of its rotation in the image plane
// (MediaPipe's built-in gesture model, by contrast, only knows upright hands).
//
// Landmark indices: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16;
// pinky 17-20 (each finger: MCP, PIP, DIP, TIP).

import { clamp, dist, ramp, straightness, toArray } from './geometry.js';

export const FINGERS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const LONG_FINGERS = ['index', 'middle', 'ring', 'pinky'];

/** Maps MediaPipe GestureRecognizer categories to our pose ids. */
export const MODEL_CATEGORY_TO_POSE = {
  Closed_Fist: 'fist',
  Open_Palm: 'open_palm',
  Pointing_Up: 'point',
  Thumb_Up: 'thumb_up',
  Thumb_Down: 'thumb_down',
  Victory: 'victory',
  ILoveYou: 'rock',
};

export const EXTENDED = 0.6; // finger score above which a finger counts as extended
export const CURLED = 0.4; // finger score below which a finger counts as curled

/**
 * Extension score of a long finger, 0 (curled) .. 1 (extended).
 * Main cue: how far the tip is from the wrist compared to the PIP joint
 * (≈1.4-1.8 when extended, ≈0.6-0.8 when curled into the palm).
 */
function longFingerScore(p, [mcp, pip, dip, tip]) {
  const reach = dist(p[0], p[tip]) / dist(p[0], p[pip]);
  const straight = (straightness(p[mcp], p[pip], p[dip]) + straightness(p[pip], p[dip], p[tip])) / 2;
  return 0.7 * ramp(reach, 0.9, 1.3) + 0.3 * ramp(straight, 0.2, 0.8);
}

/** Extension score of the thumb, 0 (folded across the palm) .. 1 (sticking out). */
function thumbScore(p, palm) {
  const away = dist(p[4], p[9]) / palm; // tip to middle-finger knuckle
  const straight = straightness(p[2], p[3], p[4]);
  return 0.6 * ramp(away, 0.55, 0.8) + 0.4 * ramp(straight, 0.6, 0.9);
}

/**
 * Computes per-finger features.
 * @param {Array} landmarks normalised image landmarks (x, y in 0..1)
 * @param {Array} [world] metric world landmarks (preferred for shape analysis)
 * @param {number} [aspect] image width / height, used when world is missing
 */
export function analyzeHand(landmarks, world, aspect = 1) {
  const img = landmarks.map(toArray);
  // Shape analysis wants isotropic 3D coordinates.
  const p = world?.length === 21 ? world.map(toArray) : img.map(([x, y, z]) => [x * aspect, y, z * aspect]);
  const palm = dist(p[0], p[9]) || 1e-6;

  const fingers = { thumb: thumbScore(p, palm) };
  for (const f of LONG_FINGERS) fingers[f] = longFingerScore(p, FINGERS[f]);

  // Thumb direction in image space (y grows downwards), aspect corrected.
  const tx = (img[4][0] - img[2][0]) * aspect;
  const ty = img[4][1] - img[2][1];
  const tl = Math.hypot(tx, ty) || 1e-6;

  return {
    fingers,
    palmSize: palm,
    pinchRatio: dist(p[4], p[8]) / palm,
    indexReach: dist(p[0], p[8]) / dist(p[0], p[5]),
    thumbDir: [tx / tl, ty / tl],
  };
}

/** Classifies a static pose from the features returned by analyzeHand. */
export function classifyFeatures(features) {
  const { fingers: s, thumbDir } = features;
  const ext = (f) => s[f] > EXTENDED;
  const curl = (f) => s[f] < CURLED;

  if (LONG_FINGERS.every(ext)) return 'open_palm';
  if (LONG_FINGERS.every(curl)) {
    if (s.thumb > EXTENDED) {
      if (thumbDir[1] < -0.6) return 'thumb_up';
      if (thumbDir[1] > 0.6) return 'thumb_down';
      return 'none'; // thumb pointing sideways: ambiguous
    }
    return s.thumb < 0.5 ? 'fist' : 'none';
  }
  if (ext('index') && curl('middle') && curl('ring') && curl('pinky')) return 'point';
  if (ext('index') && ext('middle') && curl('ring') && curl('pinky')) return 'victory';
  if (ext('index') && ext('pinky') && curl('middle') && curl('ring')) return 'rock';
  return 'none';
}

/** Confidence of a geometric classification: how far fingers are from the thresholds. */
export function poseConfidence(features) {
  const margins = Object.values(features.fingers).map((v) =>
    v > 0.5 ? ramp(v, EXTENDED, 1) : ramp(1 - v, 1 - CURLED, 1),
  );
  return clamp(Math.min(...margins) * 0.5 + 0.5, 0, 1);
}

/**
 * Fuses the geometric result with MediaPipe's gesture model output.
 * mode: 'fusion' (default), 'geometric' or 'model'.
 */
export function fusePose(geometricPose, modelCategory, modelScore = 0, mode = 'fusion') {
  const modelPose = MODEL_CATEGORY_TO_POSE[modelCategory] ?? null;
  if (mode === 'geometric') return geometricPose;
  if (mode === 'model') return modelPose && modelScore >= 0.5 ? modelPose : 'none';
  // The trained model is reliable for upright hands; the geometry covers the
  // rotated cases the model reports as "None".
  if (modelPose && modelScore >= 0.7) return modelPose;
  if (geometricPose !== 'none') return geometricPose;
  if (modelPose && modelScore >= 0.5) return modelPose;
  return 'none';
}
