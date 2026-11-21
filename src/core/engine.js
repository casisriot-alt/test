// GestureEngine: turns per-frame hand landmarks into high level events.
//
// It is pure logic (no DOM, no camera) so it can be unit tested and fed with
// recorded or synthetic data. Feed it with `process(frame)` once per video
// frame, with or without hands, and listen to the events it dispatches:
//
//   'gesture'      discrete gestures: {id, ...} (see gestures.js)
//   'pose'         stable pose changed: {pose, previous}
//   'pointer'      air cursor position: {x, y, pose, pinching} (0..1, user's view)
//   'pinchstart' / 'pinchmove' / 'pinchend'   {x, y, ...}
//   'holdprogress' {pose, progress} while a pose is being held still
//   'hand'         {present} when the hand appears / disappears
//   'frame'        per-frame summary for debugging overlays

import { analyzeHand, classifyFeatures, fusePose } from './classifier.js';
import { clamp, dist2d, mean, toArray } from './geometry.js';
import { PointFilter } from './filters.js';

export const DEFAULT_OPTIONS = {
  mirror: true, // front camera: flip x so movements match the user's point of view
  classifier: 'fusion', // 'fusion' | 'geometric' | 'model'
  stableFrames: 3, // frames a pose must persist before it becomes the current pose
  lostMs: 300, // a hand missing for longer than this is considered gone
  hold: {
    ms: 800, // how long a pose must be held still to fire hold_<pose>
    repeatMs: 450, // repeat interval while the pose keeps being held
    maxMove: 0.08, // allowed palm drift (fraction of the frame) while holding
    poses: ['open_palm', 'fist', 'point', 'victory', 'thumb_up', 'thumb_down', 'rock'],
  },
  swipe: {
    minDistance: 0.2, // fraction of the frame
    windowMs: 450, // the movement must happen within this time
    minSpeed: 0.6, // frames per second
    axisRatio: 1.7, // dominant axis must be this much larger than the other one
    cooldownMs: 600,
    oppositeBlockMs: 900, // ignore the "return stroke" right after a swipe
    poses: ['open_palm', 'none'],
  },
  pinch: {
    start: 0.25, // thumb-index distance / palm size to start a pinch
    end: 0.4, // ... and to release it (hysteresis)
    minReach: 0.95, // index tip must be away from the palm (excludes fists)
    confirmFrames: 2,
    tapMaxMs: 500,
    tapMaxMove: 0.06,
    lookbackMs: 120, // the click lands where the finger was just before pinching
  },
  pointer: {
    margin: 0.15, // the central part of the frame maps to the whole screen
    minCutoff: 1.5,
    beta: 3,
  },
};

const PALM = [0, 5, 9, 13, 17];

function mergeOptions(base, extra = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] ? { ...base[k], ...v } : v;
  }
  return out;
}

export class GestureEngine extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = mergeOptions(DEFAULT_OPTIONS, options);
    this.pointerFilter = new PointFilter(this.options.pointer);
    this.reset();
  }

  setOptions(options) {
    this.options = mergeOptions(this.options, options);
    this.pointerFilter = new PointFilter(this.options.pointer);
  }

  reset() {
    this.present = false;
    this.lastSeen = -Infinity;
    this.pose = 'none';
    this.poseSince = 0;
    this.candidate = 'none';
    this.candidateCount = 0;
    this.pinching = false;
    this.pinchCount = 0;
    this.pinchInfo = null;
    this.palmHistory = [];
    this.pointerHistory = [];
    this.pointer = null;
    this.lastSwipe = null;
    this.cooldownUntil = 0;
    this.hold = null;
    this.holdDisarmed = false;
    this.lastCenter = null;
    this.pointerFilter?.reset();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * @param {object} frame
   * @param {number} frame.timestamp  ms
   * @param {Array}  frame.hands      [{landmarks, world?, category?, score?, handedness?}]
   * @param {number} [frame.width]    video width (for aspect ratio)
   * @param {number} [frame.height]
   */
  process(frame) {
    const t = frame.timestamp;
    const hand = this.pickHand(frame.hands ?? []);
    if (!hand) {
      if (this.present && t - this.lastSeen > this.options.lostMs) this.handLost(t);
      this.emit('frame', { timestamp: t, present: this.present, hand: null });
      return;
    }

    const aspect = frame.width && frame.height ? frame.width / frame.height : 1;
    const img = hand.landmarks.map(toArray);
    if (!this.present) {
      this.present = true;
      this.emit('hand', { present: true, handedness: hand.handedness });
    }
    this.lastSeen = t;

    // --- classification -------------------------------------------------
    const features = analyzeHand(img, hand.world, aspect);
    const geometric = classifyFeatures(features);
    let raw = fusePose(geometric, hand.category, hand.score, this.options.classifier);

    // --- user-perspective positions (x mirrored for the selfie camera) ---
    const view = (p) => [this.options.mirror ? 1 - p[0] : p[0], p[1]];
    const center = view(mean(img, PALM));
    this.lastCenter = center;
    const indexTip = view(img[8]);

    // --- pinch (hysteresis + confirmation frames) ------------------------
    const pc = this.options.pinch;
    const wantsPinch = this.pinching
      ? features.pinchRatio < pc.end
      : features.pinchRatio < pc.start && features.indexReach >= pc.minReach;
    this.pinchCount = wantsPinch === this.pinching ? 0 : this.pinchCount + 1;
    const pinchChanged = this.pinchCount >= (this.pinching ? 2 : pc.confirmFrames);
    if (pinchChanged) {
      this.pinching = !this.pinching;
      this.pinchCount = 0;
    }
    if (this.pinching) raw = 'pinch';

    // --- stable pose -------------------------------------------------------
    if (raw === this.candidate) this.candidateCount++;
    else {
      this.candidate = raw;
      this.candidateCount = 1;
    }
    const needed = raw === 'pinch' ? 1 : this.options.stableFrames;
    if (this.candidateCount >= needed && this.candidate !== this.pose) {
      const previous = this.pose;
      this.pose = this.candidate;
      this.poseSince = t;
      this.hold = null;
      this.holdDisarmed = false;
      this.emit('pose', { pose: this.pose, previous });
    }

    // --- pointer ---------------------------------------------------------
    this.updatePointer(t, indexTip, center, pinchChanged);

    // --- swipes ----------------------------------------------------------
    this.palmHistory.push({ t, x: center[0], y: center[1], pose: raw });
    this.detectSwipe(t);

    // --- holds -----------------------------------------------------------
    this.detectHold(t, center);

    this.emit('frame', {
      timestamp: t,
      present: true,
      hand,
      features,
      geometric,
      raw,
      pose: this.pose,
      pinching: this.pinching,
      center,
      pointer: this.pointer,
    });
  }

  /** Keeps following the same hand when several are visible. */
  pickHand(hands) {
    if (!hands.length) return null;
    if (hands.length === 1 || !this.lastCenter) {
      if (hands.length === 1) return hands[0];
      // Biggest hand = closest to the camera.
      const size = (h) => {
        const p = h.landmarks.map(toArray);
        return dist2d(p[0], p[9]);
      };
      return hands.reduce((a, b) => (size(b) > size(a) ? b : a));
    }
    const centerOf = (h) => {
      const c = mean(h.landmarks.map(toArray), PALM);
      return [this.options.mirror ? 1 - c[0] : c[0], c[1]];
    };
    return hands.reduce((a, b) =>
      dist2d(centerOf(b), this.lastCenter) < dist2d(centerOf(a), this.lastCenter) ? b : a,
    );
  }

  handLost(t) {
    if (this.pinching) this.emit('pinchend', { ...this.pointer, cancelled: true, duration: 0, moved: 0 });
    const previous = this.pose;
    this.reset();
    this.lastSeen = t;
    if (previous !== 'none') this.emit('pose', { pose: 'none', previous });
    this.emit('hand', { present: false });
  }

  mapToScreen([x, y]) {
    const m = this.options.pointer.margin;
    return [clamp((x - m) / (1 - 2 * m), 0, 1), clamp((y - m) / (1 - 2 * m), 0, 1)];
  }

  updatePointer(t, indexTip, palmCenter, pinchChanged) {
    const pc = this.options.pinch;
    if (this.pinching && pinchChanged) {
      // Pinch just started: anchor the click where the finger was a moment ago.
      const before = [...this.pointerHistory].reverse().find((s) => t - s.t >= pc.lookbackMs);
      const origin = before ? [before.x, before.y] : this.pointer ? [this.pointer.x, this.pointer.y] : this.mapToScreen(indexTip);
      this.pinchInfo = { start: t, origin, palm: palmCenter, maxMove: 0 };
      this.pointerFilter.reset();
      this.pointerFilter.filter(origin, t);
      this.pointer = { x: origin[0], y: origin[1], pose: 'pinch', pinching: true };
      this.emit('pinchstart', { x: origin[0], y: origin[1] });
    } else if (this.pinching && this.pinchInfo) {
      // While pinching, the cursor follows the movement of the whole hand
      // (the palm is stable, unlike the fingertips that open and close).
      const scale = 1 / (1 - 2 * this.options.pointer.margin);
      const [ox, oy] = this.pinchInfo.origin;
      const x = clamp(ox + (palmCenter[0] - this.pinchInfo.palm[0]) * scale, 0, 1);
      const y = clamp(oy + (palmCenter[1] - this.pinchInfo.palm[1]) * scale, 0, 1);
      const [fx, fy] = this.pointerFilter.filter([x, y], t);
      this.pinchInfo.maxMove = Math.max(this.pinchInfo.maxMove, Math.hypot(fx - ox, fy - oy));
      this.pointer = { x: fx, y: fy, pose: 'pinch', pinching: true };
      this.emit('pinchmove', { x: fx, y: fy, dx: fx - ox, dy: fy - oy });
    } else {
      if (!this.pinching && pinchChanged && this.pinchInfo) {
        const info = this.pinchInfo;
        const duration = t - info.start;
        const end = { x: this.pointer.x, y: this.pointer.y, duration, moved: info.maxMove };
        this.emit('pinchend', end);
        if (duration <= pc.tapMaxMs && info.maxMove <= pc.tapMaxMove) {
          this.emit('gesture', { id: 'tap', x: info.origin[0], y: info.origin[1] });
        }
        this.pinchInfo = null;
        // Restart smoothing from the current finger position (no slow glide back).
        this.pointerFilter.reset();
      }
      const [x, y] = this.pointerFilter.filter(this.mapToScreen(indexTip), t);
      this.pointer = { x, y, pose: this.pose, pinching: false };
    }
    this.pointerHistory.push({ t, x: this.pointer.x, y: this.pointer.y });
    while (this.pointerHistory.length && t - this.pointerHistory[0].t > 600) this.pointerHistory.shift();
    this.emit('pointer', this.pointer);
  }

  detectSwipe(t) {
    const sc = this.options.swipe;
    const hist = this.palmHistory;
    while (hist.length && t - hist[0].t > sc.windowMs) hist.shift();
    if (this.pinching || t < this.cooldownUntil || hist.length < 3) return;

    const allowed = hist.filter((s) => sc.poses.includes(s.pose)).length / hist.length;
    if (allowed < 0.6) return;

    const first = hist[0];
    const last = hist[hist.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dt = Math.max((last.t - first.t) / 1000, 1e-3);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let direction = null;
    if (ax >= sc.minDistance && ax >= sc.axisRatio * ay && ax / dt >= sc.minSpeed) direction = dx > 0 ? 'right' : 'left';
    else if (ay >= sc.minDistance && ay >= sc.axisRatio * ax && ay / dt >= sc.minSpeed) direction = dy > 0 ? 'down' : 'up';
    if (!direction) return;

    const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' };
    if (this.lastSwipe && this.lastSwipe.direction === opposite[direction] && t - this.lastSwipe.t < sc.oppositeBlockMs) {
      hist.length = 0;
      return;
    }
    this.lastSwipe = { direction, t };
    this.cooldownUntil = t + sc.cooldownMs;
    hist.length = 0;
    // A swipe usually ends with the hand still: don't turn that into a hold.
    this.hold = null;
    this.holdDisarmed = true;
    this.emit('gesture', { id: `swipe_${direction}`, direction, speed: Math.max(ax, ay) / dt });
  }

  detectHold(t, center) {
    const hc = this.options.hold;
    if (!hc.poses.includes(this.pose) || this.holdDisarmed || this.pinching) {
      if (this.hold) this.emit('holdprogress', { pose: this.pose, progress: 0 });
      this.hold = null;
      return;
    }
    if (!this.hold || dist2d(center, this.hold.anchor) > hc.maxMove) {
      const wasProgressing = this.hold && !this.hold.fired;
      this.hold = { start: t, anchor: center, fired: false, lastFire: 0 };
      if (wasProgressing) this.emit('holdprogress', { pose: this.pose, progress: 0 });
      return;
    }
    const elapsed = t - this.hold.start;
    if (!this.hold.fired) {
      this.emit('holdprogress', { pose: this.pose, progress: clamp(elapsed / hc.ms, 0, 1) });
      if (elapsed >= hc.ms) {
        this.hold.fired = true;
        this.hold.lastFire = t;
        this.emit('gesture', { id: `hold_${this.pose}`, pose: this.pose, repeat: false });
      }
    } else if (t - this.hold.lastFire >= hc.repeatMs) {
      this.hold.lastFire = t;
      this.emit('gesture', { id: `hold_${this.pose}`, pose: this.pose, repeat: true });
    }
  }
}
