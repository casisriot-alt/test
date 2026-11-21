// "Lavagna": draw in the air. Pinch (thumb + index) = pen down.

const COLORS = ['#5eead4', '#f472b6', '#fde047', '#a78bfa', '#fb923c', '#ffffff'];

export default {
  id: 'lavagna',
  name: 'Lavagna',
  icon: '🎨',
  pointer: true,
  hints: [
    ['tap', 'Punto'],
    ['hold_victory', 'Colore'],
    ['hold_open_palm', 'Cancella'],
    ['hold_thumb_up', 'Annulla'],
  ],

  mount(view) {
    this.color = 0;
    this.size = 8;
    this.strokes = [];
    view.innerHTML = `
      <h2>Lavagna</h2>
      <p class="sub">Pizzica pollice e indice per disegnare in aria, apri le dita per alzare la penna.</p>
      <div class="pa-tools">
        ${COLORS.map((c, i) => `<button class="pa-color" data-color="${i}" style="--c:${c}" aria-label="Colore ${i + 1}"></button>`).join('')}
        <button class="btn btn-small" data-act="undo">↶ Annulla</button>
        <button class="btn btn-small" data-act="clear">🗑 Cancella</button>
      </div>
      <canvas class="pa-canvas" data-ref="canvas" data-air-drag></canvas>`;
    this.canvas = view.querySelector('[data-ref="canvas"]');
    this.c2d = this.canvas.getContext('2d');
    this.swatches = [...view.querySelectorAll('[data-color]')];
    this.swatches.forEach((b) => b.addEventListener('click', () => this.setColor(Number(b.dataset.color))));
    view.querySelector('[data-act="undo"]').addEventListener('click', () => this.undo());
    view.querySelector('[data-act="clear"]').addEventListener('click', () => this.clear());

    let current = null;
    const point = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic air pointer */
      }
      current = { color: COLORS[this.color], size: this.size, points: [point(e)] };
      this.strokes.push(current);
      this.redraw();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      current.points.push(point(e));
      this.redraw();
    });
    const end = () => (current = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    new ResizeObserver(() => this.redraw()).observe(this.canvas);
    this.setColor(0);
  },

  setColor(i) {
    this.color = (i + COLORS.length) % COLORS.length;
    this.swatches.forEach((b, j) => b.classList.toggle('on', j === this.color));
  },

  undo() {
    this.strokes.pop();
    this.redraw();
  },

  clear() {
    this.strokes = [];
    this.redraw();
  },

  redraw() {
    const { canvas, c2d } = this;
    const dpr = devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    c2d.clearRect(0, 0, w, h);
    c2d.lineCap = 'round';
    c2d.lineJoin = 'round';
    for (const s of this.strokes) {
      c2d.strokeStyle = s.color;
      c2d.fillStyle = s.color;
      c2d.lineWidth = s.size * dpr;
      if (s.points.length === 1) {
        c2d.beginPath();
        c2d.arc(s.points[0][0] * w, s.points[0][1] * h, (s.size * dpr) / 2, 0, Math.PI * 2);
        c2d.fill();
        continue;
      }
      c2d.beginPath();
      s.points.forEach(([x, y], i) => (i ? c2d.lineTo(x * w, y * h) : c2d.moveTo(x * w, y * h)));
      c2d.stroke();
    }
  },

  onGesture(g) {
    if (g.repeat) return false;
    switch (g.id) {
      case 'hold_victory':
        this.setColor(this.color + 1);
        return 'Nuovo colore';
      case 'hold_open_palm':
        if (!this.strokes.length) return false;
        this.clear();
        return 'Lavagna cancellata';
      case 'hold_thumb_up':
        if (!this.strokes.length) return false;
        this.undo();
        return 'Tratto annullato';
      default:
        return false;
    }
  },
};
