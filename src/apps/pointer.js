// "Cursore": the index finger moves a cursor, a quick pinch clicks, a held
// pinch drags. Any button of the page can be used this way.

const KEYS = ['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', ',', '⌫', '='];

export default {
  id: 'cursore',
  name: 'Cursore',
  icon: '👆',
  pointer: true,
  hints: [
    ['tap', 'Clic'],
    ['hold_open_palm', 'Azzera'],
  ],

  mount(view) {
    view.innerHTML = `
      <h2>Cursore in aria</h2>
      <p class="sub">Punta con l'indice per muovere il cursore, pizzica (pollice + indice) per premere i tasti, tieni il pizzico e muovi la mano per regolare la luce 💡.</p>
      <div class="pt-wrap">
        <div class="card lamp">
          <div class="lamp-bulb" data-ref="bulb">💡</div>
          <div class="lamp-ctl">
            <div class="muted lamp-label" data-ref="label"></div>
            <div class="slider" data-ref="slider" data-air-drag role="slider" aria-label="Luminosità" aria-valuemin="0" aria-valuemax="100">
              <div class="slider-fill" data-ref="fill"></div><div class="slider-knob" data-ref="knob"></div>
            </div>
          </div>
        </div>
        <div class="calc card">
          <div class="calc-display" data-ref="display">0</div>
          <div class="calc-keys">${KEYS.map((k) => `<button class="calc-key ${/[÷×−+=]/.test(k) ? 'op' : ''} ${/[C±%]/.test(k) ? 'fn' : ''}" data-key="${k}">${k}</button>`).join('')}</div>
        </div>
      </div>`;
    const ref = (n) => view.querySelector(`[data-ref="${n}"]`);
    this.display = ref('display');
    this.expr = '';
    view.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => this.press(b.dataset.key)));
    this.setupSlider(ref('slider'), ref('fill'), ref('knob'), ref('bulb'), ref('label'));
  },

  setupSlider(slider, fill, knob, bulb, label) {
    const set = (v) => {
      this.brightness = Math.round(Math.max(0, Math.min(100, v)));
      fill.style.width = `${this.brightness}%`;
      knob.style.left = `${this.brightness}%`;
      bulb.style.filter = `brightness(${0.3 + this.brightness / 100}) drop-shadow(0 0 ${this.brightness / 3}px rgba(253, 224, 71, ${this.brightness / 100}))`;
      label.textContent = `Luminosità ${this.brightness}%`;
      slider.setAttribute('aria-valuenow', String(this.brightness));
    };
    let dragging = false;
    const fromEvent = (e) => {
      const r = slider.getBoundingClientRect();
      set(((e.clientX - r.left) / r.width) * 100);
    };
    slider.addEventListener('pointerdown', (e) => {
      dragging = true;
      try {
        slider.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic air pointer: no capture needed */
      }
      fromEvent(e);
    });
    // Air drags dispatch their moves on the element where the pinch started.
    slider.addEventListener('pointermove', (e) => dragging && fromEvent(e));
    const stop = () => (dragging = false);
    slider.addEventListener('pointerup', stop);
    slider.addEventListener('pointercancel', stop);
    set(40);
  },

  press(k) {
    const ops = { '÷': '/', '×': '*', '−': '-', '+': '+' };
    if (k === 'C') this.expr = '';
    else if (k === '⌫') this.expr = this.expr.slice(0, -1);
    else if (k === '=') this.expr = this.evaluate(this.expr);
    else if (k === '±') this.expr = this.expr.startsWith('-') ? this.expr.slice(1) : this.expr ? `-${this.expr}` : '';
    else if (k === '%') this.expr = this.evaluate(`(${this.expr || 0})/100`);
    else if (k === ',') this.expr += '.';
    else if (ops[k]) this.expr = this.expr.replace(/[-+*/]$/, '') + ops[k];
    else this.expr += k;
    this.display.textContent = (this.expr || '0').replace(/\*/g, '×').replace(/\//g, '÷').replace(/\./g, ',');
  },

  /** Tiny, safe arithmetic evaluator (digits, + - * / and parentheses only). */
  evaluate(expr) {
    const tokens = expr.match(/\d+(\.\d+)?|[-+*/()]/g) ?? [];
    let i = 0;
    const peek = () => tokens[i];
    const factor = () => {
      const t = tokens[i++];
      if (t === '-') return -factor();
      if (t === '(') {
        const v = sum();
        i++;
        return v;
      }
      return Number(t ?? 0);
    };
    const product = () => {
      let v = factor();
      while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * factor() : v / factor();
      return v;
    };
    const sum = () => {
      let v = product();
      while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + product() : v - product();
      return v;
    };
    const v = sum();
    return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : '';
  },

  onGesture(g) {
    if (g.id === 'hold_open_palm' && !g.repeat) {
      this.press('C');
      return 'Calcolatrice azzerata';
    }
    return false;
  },
};
