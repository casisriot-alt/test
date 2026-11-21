// "Musica": a small synthesizer player (Web Audio) controlled by gestures.

const TRACKS = [
  { title: 'Onde lente', artist: 'Synth Lago', bpm: 84, root: 220, scale: [0, 3, 5, 7, 10], wave: 'triangle', colors: ['#0f766e', '#5eead4'] },
  { title: 'Neon Milano', artist: 'Gli Oscillatori', bpm: 118, root: 196, scale: [0, 2, 3, 7, 8], wave: 'sawtooth', colors: ['#7c3aed', '#f472b6'] },
  { title: 'Alba sul porto', artist: 'Quarta Giusta', bpm: 96, root: 261.6, scale: [0, 2, 4, 7, 9], wave: 'sine', colors: ['#ea580c', '#fde68a'] },
  { title: 'Pixel e caffè', artist: '8 bit Bar', bpm: 132, root: 329.6, scale: [0, 2, 4, 5, 7, 9, 11], wave: 'square', colors: ['#2563eb', '#67e8f9'] },
];

const freq = (root, semis) => root * 2 ** (semis / 12);

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export default {
  id: 'musica',
  name: 'Musica',
  icon: '🎵',
  hints: [
    ['hold_open_palm', 'Play / Pausa'],
    ['swipe_left', 'Brano succ.'],
    ['swipe_right', 'Brano prec.'],
    ['hold_thumb_up', 'Volume +'],
    ['hold_thumb_down', 'Volume −'],
  ],

  mount(view, ctx) {
    this.ctx = ctx;
    this.trackIndex = 0;
    this.volume = 0.6;
    this.playing = false;
    this.elapsed = 0;
    view.innerHTML = `
      <h2>Musica</h2>
      <p class="sub">Un piccolo lettore musicale: comandalo senza toccare lo schermo.</p>
      <div class="mu card">
        <div class="mu-cover" data-ref="cover"><canvas data-ref="viz"></canvas><span data-ref="icon">♪</span></div>
        <div class="mu-meta"><b data-ref="title"></b><span class="muted" data-ref="artist"></span></div>
        <div class="mu-time muted" data-ref="time">0:00</div>
        <div class="mu-controls">
          <button class="mu-btn" data-act="prev" aria-label="Brano precedente">⏮</button>
          <button class="mu-btn mu-play" data-act="toggle" aria-label="Play o pausa" data-ref="play">▶</button>
          <button class="mu-btn" data-act="next" aria-label="Brano successivo">⏭</button>
        </div>
        <div class="mu-vol"><span>🔈</span><div class="mu-vol-bar"><b data-ref="vol"></b></div><span>🔊</span></div>
      </div>
      <ol class="mu-list" data-ref="list">${TRACKS.map((t, i) => `<li data-track="${i}" data-air-click><span>${i + 1}</span><b>${t.title}</b><em class="muted">${t.artist}</em></li>`).join('')}</ol>`;
    const ref = (n) => view.querySelector(`[data-ref="${n}"]`);
    this.refs = { cover: ref('cover'), viz: ref('viz'), title: ref('title'), artist: ref('artist'), time: ref('time'), play: ref('play'), vol: ref('vol'), items: [...view.querySelectorAll('[data-track]')] };
    view.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => ({ prev: () => this.skip(-1), next: () => this.skip(1), toggle: () => this.toggle() })[b.dataset.act]()),
    );
    this.refs.items.forEach((li) => li.addEventListener('click', () => this.select(Number(li.dataset.track), true)));
    this.render();
  },

  setupAudio() {
    if (this.audio) return true;
    const audio = this.ctx.audio();
    if (!audio) return false;
    this.audio = audio;
    this.master = audio.createGain();
    this.master.gain.value = this.volume * 0.5;
    this.analyser = audio.createAnalyser();
    this.analyser.fftSize = 128;
    this.master.connect(this.analyser);
    this.analyser.connect(audio.destination);
    return true;
  },

  note(time, f, dur, type, gain) {
    const a = this.audio;
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.type = type;
    osc.frequency.value = f;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    osc.connect(env).connect(this.master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  },

  hat(time) {
    const a = this.audio;
    if (!this.noise) {
      this.noise = a.createBuffer(1, a.sampleRate * 0.05, a.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = a.createBufferSource();
    const hp = a.createBiquadFilter();
    const env = a.createGain();
    src.buffer = this.noise;
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    env.gain.setValueAtTime(0.12, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hp).connect(env).connect(this.master);
    src.start(time);
  },

  schedule() {
    const t = TRACKS[this.trackIndex];
    const step = 60 / t.bpm / 4; // 16th notes
    while (this.nextTime < this.audio.currentTime + 0.12) {
      const s = this.step % 16;
      if (s % 2 === 0 || this.rand() > 0.6) {
        this.degree = Math.max(0, Math.min(t.scale.length * 2 - 1, this.degree + Math.round((this.rand() - 0.5) * 3)));
        const semis = t.scale[this.degree % t.scale.length] + 12 * Math.floor(this.degree / t.scale.length);
        this.note(this.nextTime, freq(t.root, semis), step * 1.8, t.wave, t.wave === 'sine' ? 0.35 : 0.14);
      }
      if (s % 4 === 0) this.note(this.nextTime, freq(t.root / 2, s === 8 ? t.scale[2] : 0), step * 3.5, 'sine', 0.4);
      if (s % 2 === 1) this.hat(this.nextTime);
      this.nextTime += step;
      this.step++;
    }
  },

  play() {
    if (!this.setupAudio()) {
      this.ctx.toast('⚠️', 'Audio non disponibile in questo browser');
      return false;
    }
    if (this.audio.state === 'suspended') this.audio.resume();
    this.playing = true;
    this.rand = rng(this.trackIndex * 7919 + 17);
    this.degree = 3;
    this.step = 0;
    this.nextTime = this.audio.currentTime + 0.05;
    this.startedAt = performance.now() - this.elapsed * 1000;
    this.timer = setInterval(() => this.schedule(), 25);
    this.draw();
    this.render();
    return true;
  },

  pause() {
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.render();
  },

  toggle() {
    if (this.playing) this.pause();
    else this.play();
    return this.playing ? 'Play' : 'Pausa';
  },

  select(i, autoplay = this.playing) {
    this.pause();
    this.trackIndex = (i + TRACKS.length) % TRACKS.length;
    this.elapsed = 0;
    if (autoplay) this.play();
    this.render();
  },

  skip(dir) {
    this.select(this.trackIndex + dir);
    return `${dir > 0 ? '⏭' : '⏮'} ${TRACKS[this.trackIndex].title}`;
  },

  setVolume(v) {
    this.volume = Math.round(Math.max(0, Math.min(1, v)) * 10) / 10;
    if (this.master) this.master.gain.setTargetAtTime(this.volume * 0.5, this.audio.currentTime, 0.05);
    this.render();
    return `Volume ${Math.round(this.volume * 100)}%`;
  },

  draw() {
    const canvas = this.refs.viz;
    const c = canvas.getContext('2d');
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const loop = () => {
      if (!this.playing) return;
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
      this.analyser.getByteFrequencyData(data);
      const n = 24;
      const bw = w / n;
      c.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < n; i++) {
        const v = data[i + 2] / 255;
        const bh = Math.max(2, v * h * 0.8);
        c.fillRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh);
      }
      this.elapsed = (performance.now() - this.startedAt) / 1000;
      const s = Math.floor(this.elapsed);
      this.refs.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },

  render() {
    const t = TRACKS[this.trackIndex];
    const r = this.refs;
    r.cover.style.background = `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`;
    r.cover.classList.toggle('playing', this.playing);
    r.title.textContent = t.title;
    r.artist.textContent = `${t.artist} · ${t.bpm} bpm`;
    r.play.textContent = this.playing ? '⏸' : '▶';
    r.vol.style.width = `${this.volume * 100}%`;
    r.items.forEach((li, i) => li.classList.toggle('on', i === this.trackIndex));
    if (!this.playing && this.elapsed === 0) r.time.textContent = '0:00';
  },

  onGesture(g) {
    switch (g.id) {
      case 'hold_open_palm':
        return g.repeat ? false : this.toggle();
      case 'swipe_left':
        return this.skip(1);
      case 'swipe_right':
        return this.skip(-1);
      case 'hold_thumb_up':
        return this.setVolume(this.volume + 0.1);
      case 'hold_thumb_down':
        return this.setVolume(this.volume - 0.1);
      case 'hold_fist':
        if (g.repeat || !this.playing) return false;
        this.pause();
        this.elapsed = 0;
        this.render();
        return 'Stop';
      default:
        return false;
    }
  },
};
