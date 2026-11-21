// "Galleria": a photo carousel driven by swipes.

const ARTWORKS = [
  { title: 'Aurora', place: 'Tromsø', colors: ['#0b1d3a', '#1fa37a', '#a5f3c9'], shape: 'waves' },
  { title: 'Duna', place: 'Merzouga', colors: ['#3b1d0f', '#d9822b', '#ffd79a'], shape: 'hills' },
  { title: 'Laguna', place: 'Venezia', colors: ['#06263d', '#0f7ea8', '#9ee6ff'], shape: 'sun' },
  { title: 'Vulcano', place: 'Etna', colors: ['#1a0a0a', '#c2341b', '#ffb36b'], shape: 'peak' },
  { title: 'Lavanda', place: 'Valensole', colors: ['#2a1745', '#8d5bd6', '#f2d6ff'], shape: 'hills' },
  { title: 'Ghiacciaio', place: 'Monte Rosa', colors: ['#0d2233', '#5f9fc7', '#eef9ff'], shape: 'peak' },
  { title: 'Tramonto', place: 'Capri', colors: ['#2b0f2e', '#e0566f', '#ffcf86'], shape: 'sun' },
  { title: 'Foresta', place: 'Sila', colors: ['#071a10', '#2f7a3c', '#b8e986'], shape: 'waves' },
];

function art({ colors: [a, b, c], shape }, i) {
  const shapes = {
    waves: `<path d="M0 260 Q 100 210 200 250 T 400 240 V400 H0Z" fill="${b}" opacity=".8"/><path d="M0 300 Q 120 260 240 300 T 400 290 V400 H0Z" fill="${a}" opacity=".9"/>`,
    hills: `<circle cx="300" cy="110" r="46" fill="${c}" opacity=".9"/><path d="M0 280 Q 120 170 230 260 T 400 230 V400 H0Z" fill="${b}"/><path d="M0 330 Q 160 260 400 320 V400 H0Z" fill="${a}" opacity=".85"/>`,
    sun: `<circle cx="200" cy="230" r="90" fill="${c}"/><rect y="230" width="400" height="170" fill="${b}" opacity=".85"/><g stroke="${c}" stroke-width="6" opacity=".6"><line x1="120" y1="262" x2="280" y2="262"/><line x1="150" y1="290" x2="250" y2="290"/><line x1="175" y1="316" x2="225" y2="316"/></g>`,
    peak: `<path d="M0 330 L130 150 L200 230 L270 120 L400 320 V400 H0Z" fill="${b}"/><path d="M270 120 L300 165 L285 160 L270 180 L255 162 L240 166Z" fill="${c}"/><path d="M0 360 Q 200 300 400 360 V400 H0Z" fill="${a}"/>`,
  };
  return `<svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="400" height="400" fill="url(#g${i})"/>${shapes[shape]}</svg>`;
}

export default {
  id: 'galleria',
  name: 'Galleria',
  icon: '🖼️',
  hints: [
    ['swipe_left', 'Avanti'],
    ['swipe_right', 'Indietro'],
    ['hold_thumb_up', 'Mi piace'],
    ['hold_open_palm', 'Presentazione'],
  ],

  mount(view) {
    this.index = 0;
    this.likes = new Set();
    view.innerHTML = `
      <h2>Galleria</h2>
      <p class="sub">Scorri con la mano aperta per sfogliare le foto.</p>
      <div class="gal">
        <div class="gal-track" data-ref="track">
          ${ARTWORKS.map(
            (a, i) => `<figure class="gal-slide">${art(a, i)}
              <figcaption><b>${a.title}</b><span>${a.place}</span></figcaption>
              <div class="gal-like" data-like="${i}">❤️</div></figure>`,
          ).join('')}
        </div>
        <button class="gal-nav prev" data-dir="-1" aria-label="Foto precedente">‹</button>
        <button class="gal-nav next" data-dir="1" aria-label="Foto successiva">›</button>
      </div>
      <div class="gal-dots" data-ref="dots">${ARTWORKS.map(() => '<i></i>').join('')}</div>
      <p class="gal-status muted" data-ref="status"></p>`;
    this.track = view.querySelector('[data-ref="track"]');
    this.dots = [...view.querySelectorAll('.gal-dots i')];
    this.status = view.querySelector('[data-ref="status"]');
    this.likeEls = [...view.querySelectorAll('[data-like]')];
    view.querySelectorAll('.gal-nav').forEach((b) => b.addEventListener('click', () => this.go(this.index + Number(b.dataset.dir))));

    // Touch swipe too, so the gallery also works without gestures.
    let startX = null;
    this.track.addEventListener('pointerdown', (e) => (startX = e.pointerType === 'touch' ? e.clientX : null));
    this.track.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 40) this.go(this.index + (dx < 0 ? 1 : -1));
      startX = null;
    });
    this.render();
  },

  go(i) {
    this.index = (i + ARTWORKS.length) % ARTWORKS.length;
    this.render();
  },

  render() {
    this.track.style.transform = `translateX(${-this.index * 100}%)`;
    this.dots.forEach((d, i) => d.classList.toggle('on', i === this.index));
    this.likeEls.forEach((el, i) => el.classList.toggle('on', this.likes.has(i)));
    const a = ARTWORKS[this.index];
    this.status.textContent = `${this.index + 1} / ${ARTWORKS.length} · ${a.title}${this.likes.has(this.index) ? ' · ❤️ Ti piace' : ''}${this.timer ? ' · ▶︎ Presentazione' : ''}`;
  },

  toggleSlideshow() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    } else {
      this.timer = setInterval(() => this.go(this.index + 1), 2500);
    }
    this.render();
    return this.timer ? 'Presentazione avviata' : 'Presentazione in pausa';
  },

  deactivate() {
    if (this.timer) this.toggleSlideshow();
  },

  onGesture(g) {
    switch (g.id) {
      case 'swipe_left':
        this.go(this.index + 1);
        return 'Foto successiva';
      case 'swipe_right':
        this.go(this.index - 1);
        return 'Foto precedente';
      case 'hold_thumb_up':
        if (g.repeat) return false;
        if (this.likes.has(this.index)) this.likes.delete(this.index);
        else this.likes.add(this.index);
        this.render();
        return this.likes.has(this.index) ? 'Mi piace!' : 'Non mi piace più';
      case 'hold_open_palm':
        return g.repeat ? false : this.toggleSlideshow();
      default:
        return false;
    }
  },
};
