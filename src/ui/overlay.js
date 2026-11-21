// Draws the tracked hand skeleton on the preview canvas.

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export class SkeletonOverlay {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** @param {Array<Array<{x,y}>>} hands  @param {number} primary index of the tracked hand */
  draw(hands, { pinching = false, primary = 0 } = {}) {
    const { canvas, video, ctx } = this;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const unit = Math.max(w, h) / 160;
    hands.forEach((lm, i) => {
      const main = i === primary;
      ctx.lineWidth = unit * (main ? 1.2 : 0.8);
      ctx.strokeStyle = main ? 'rgba(94, 234, 212, 0.9)' : 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
      }
      ctx.stroke();
      for (let j = 0; j < lm.length; j++) {
        const tip = j === 4 || j === 8;
        ctx.fillStyle = tip && main ? (pinching ? '#a78bfa' : '#ffffff') : 'rgba(94, 234, 212, 0.95)';
        ctx.beginPath();
        ctx.arc(lm[j].x * w, lm[j].y * h, unit * (tip ? 1.8 : 1.1), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}
