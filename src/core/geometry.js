// Small vector helpers working on [x, y, z] arrays or {x, y, z} objects.

/** Normalises a landmark ({x,y,z} or [x,y,z]) to an [x, y, z] array. */
export function toArray(p) {
  return Array.isArray(p) ? p : [p.x, p.y, p.z ?? 0];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + (a[2] ?? 0) * (b[2] ?? 0);
}

export function len(a) {
  return Math.hypot(a[0], a[1], a[2] ?? 0);
}

export function dist(a, b) {
  return len(sub(a, b));
}

export function dist2d(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Cosine of the angle between segment a->b and segment b->c (1 = straight). */
export function straightness(a, b, c) {
  const u = sub(b, a);
  const v = sub(c, b);
  const d = len(u) * len(v);
  return d === 0 ? 0 : dot(u, v) / d;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear ramp: 0 at `lo`, 1 at `hi`, clamped. */
export function ramp(v, lo, hi) {
  return clamp((v - lo) / (hi - lo), 0, 1);
}

export function mean(points, indices) {
  const out = [0, 0, 0];
  for (const i of indices) {
    out[0] += points[i][0];
    out[1] += points[i][1];
    out[2] += points[i][2] ?? 0;
  }
  return out.map((v) => v / indices.length);
}
