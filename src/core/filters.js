// One Euro filter (Casiez et al. 2012): low jitter when the hand is still,
// low lag when it moves fast. Used to smooth the air cursor.

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

const alphaFor = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  /**
   * @param {number} minCutoff  Hz; lower = smoother when still
   * @param {number} beta       speed coefficient; higher = less lag when moving
   * @param {number} dCutoff    Hz; cutoff for the derivative
   */
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
  }

  filter(value, timeMs) {
    const dt = this.lastTime === null ? 1 / 30 : Math.max((timeMs - this.lastTime) / 1000, 1e-3);
    this.lastTime = timeMs;
    const prev = this.x.y;
    const deriv = prev === null ? 0 : (value - prev) / dt;
    const edx = this.dx.filter(deriv, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alphaFor(cutoff, dt));
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

/** Convenience wrapper filtering a 2D point. */
export class PointFilter {
  constructor(options) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
  }
  filter([x, y], timeMs) {
    return [this.fx.filter(x, timeMs), this.fy.filter(y, timeMs)];
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}
