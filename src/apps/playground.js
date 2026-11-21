// "Prova": live view of what the engine sees, to learn and test the gestures.

import { POSES, describeGesture, describePose } from '../core/gestures.js';

const FINGER_NAMES = { thumb: 'Pollice', index: 'Indice', middle: 'Medio', ring: 'Anulare', pinky: 'Mignolo' };

export default {
  id: 'prova',
  name: 'Prova',
  icon: '🧪',
  hints: [
    ['swipe_left', 'Scorri'],
    ['tap', 'Clic'],
    ['hold_open_palm', 'Tieni fermo'],
    ['hold_thumb_up', 'Pollice su'],
  ],

  mount(view, ctx) {
    view.innerHTML = `
      <h2>Prova i gesti</h2>
      <p class="sub">Mostra la mano alla fotocamera: qui vedi la posa riconosciuta e ogni gesto in tempo reale.</p>
      <div class="pg-live card">
        <div class="pg-pose" data-ref="pose">·</div>
        <div class="pg-pose-info">
          <div class="pg-pose-name" data-ref="name">Nessuna mano</div>
          <div class="muted pg-pose-raw" data-ref="raw">—</div>
          <div class="pg-fingers" data-ref="fingers">
            ${Object.entries(FINGER_NAMES)
              .map(([k, v]) => `<div class="pg-finger"><span>${v}</span><i><b data-finger="${k}"></b></i></div>`)
              .join('')}
          </div>
        </div>
      </div>
      <details class="card pg-diag" data-ref="diag">
        <summary>🩺 Diagnostica</summary>
        <p class="muted pg-diag-help" data-ref="diaghelp">Se la mano non viene riconosciuta, copia questi dati e inviali a chi ti assiste.</p>
        <pre data-ref="diagtext">Fotocamera spenta.</pre>
        <div class="pg-diag-actions">
          <button class="btn btn-small" data-act="copy">📋 Copia</button>
          <button class="btn btn-small" data-act="delegate">Usa la CPU</button>
        </div>
      </details>
      <h3 class="pg-h">Ultimi gesti</h3>
      <ol class="pg-log card" data-ref="log"><li class="muted">Nessun gesto ancora.</li></ol>
      <h3 class="pg-h">Guida</h3>
      <div class="pg-guide">
        ${[
          ['👈 👉', 'Scorri', 'Muovi rapidamente la mano aperta a destra o a sinistra (anche in alto o in basso).'],
          ['🤏', 'Clic', 'Unisci pollice e indice e riaprili subito: clicca dove punta il cursore.'],
          ['🤏↕️', 'Trascina', 'Tieni pollice e indice uniti e muovi la mano.'],
          ['🖐️ ⏱️', 'Tieni fermo', 'Mantieni ferma una posa per ~1 secondo: la barra si riempie e il comando parte.'],
          ['👍 👎', 'Pollice', 'Pollice su o giù tenuto fermo: ripete il comando (es. volume).'],
          ['🤘', 'Cambia app', 'Le corna tenute ferme passano all\'app successiva, ovunque.'],
        ]
          .map(([e, t, d]) => `<div class="card pg-tip"><div class="pg-tip-emoji">${e}</div><div><b>${t}</b><p>${d}</p></div></div>`)
          .join('')}
      </div>
      <p class="muted pg-poses">Pose riconosciute: ${Object.entries(POSES)
        .filter(([k]) => k !== 'none')
        .map(([, p]) => `${p.emoji} ${p.label}`)
        .join(' · ')}</p>`;

    const ref = (n) => view.querySelector(`[data-ref="${n}"]`);
    this.setupDiagnostics(ref, ctx);
    const bars = Object.fromEntries([...view.querySelectorAll('[data-finger]')].map((b) => [b.dataset.finger, b]));
    this.log = ref('log');
    this.entries = [];

    ctx.on(this, 'frame', (f) => {
      if (!f.present || !f.features) return;
      for (const [k, v] of Object.entries(f.features.fingers)) bars[k].style.width = `${Math.round(v * 100)}%`;
      const model = f.hand?.category && f.hand.category !== 'None' ? ` · modello: ${f.hand.category} ${Math.round(f.hand.score * 100)}%` : '';
      ref('raw').textContent = `geometria: ${describePose(f.geometric).label}${model} · pizzico ${f.features.pinchRatio.toFixed(2)}`;
    });
    ctx.on(this, 'pose', ({ pose }) => {
      ref('pose').textContent = describePose(pose).emoji;
      ref('name').textContent = pose === 'none' ? 'Posa non riconosciuta' : describePose(pose).label;
    });
    ctx.on(this, 'hand', ({ present }) => {
      if (present) return;
      ref('pose').textContent = '·';
      ref('name').textContent = 'Nessuna mano';
      ref('raw').textContent = '—';
      Object.values(bars).forEach((b) => (b.style.width = '0'));
    });
  },

  setupDiagnostics(ref, ctx) {
    const details = ref('diag');
    const text = ref('diagtext');
    const help = ref('diaghelp');
    const delegateBtn = details.querySelector('[data-act="delegate"]');
    let last = 0;
    let autoOpened = false;
    const render = (d) => {
      const lines = [
        `stato: ${d.stato} · ${d.delegato} · ingresso ${d.ingresso} · ciclo ${d.ciclo}`,
        `video: ${d.video} · ${d.fps} fps · ${d.msInferenza} ms/fotogramma`,
        `fotogrammi analizzati: ${d.fotogrammi} · con una mano: ${d.conMano}`,
        `luminosità media: ${d.luminosita ?? '?'} / 255 · verifiche CPU: ${d.verificheCpu}`,
        `errori: ${d.errori}${d.ultimoErrore ? ` (${d.ultimoErrore})` : ''}`,
        ...d.note.map((n) => `· ${n}`),
        `browser: ${navigator.userAgent}`,
      ];
      text.textContent = lines.join('\n');
      delegateBtn.textContent = d.delegato === 'GPU' ? 'Usa la CPU' : 'Usa la GPU';
      let hint = 'Se la mano non viene riconosciuta, copia questi dati e inviali a chi ti assiste.';
      if (d.fotogrammi === 0) hint = '⚠️ Nessun fotogramma analizzato: la fotocamera non invia immagini.';
      else if (d.luminosita !== null && d.luminosita <= 2) hint = '⚠️ Le immagini arrivano nere: controlla che la fotocamera non sia coperta o usata da un\'altra app.';
      else if (d.luminosita !== null && d.luminosita < 40) hint = '💡 Immagine molto scura: aumenta la luce.';
      else if (d.conMano === 0) hint = '✋ Nessuna mano trovata finora: mostra il palmo aperto a 30–60 cm dalla fotocamera.';
      help.textContent = hint;
      // Nothing found after ~5 s of frames: show the diagnostics on their own.
      if (!autoOpened && d.fotogrammi > 120 && d.conMano === 0) {
        autoOpened = true;
        details.open = true;
      }
    };
    ctx.on(this, 'stats', ({ diagnostics }) => {
      const now = performance.now();
      if (now - last < 500) return;
      last = now;
      render(diagnostics);
    });
    details.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text.textContent);
        ctx.toast('📋', 'Diagnostica copiata');
      } catch {
        const range = document.createRange();
        range.selectNodeContents(text);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        ctx.toast('📋', 'Testo selezionato: copialo');
      }
    });
    delegateBtn.addEventListener('click', async () => {
      const next = ctx.controller.activeDelegate === 'GPU' ? 'CPU' : 'GPU';
      ctx.settings.gpu = next === 'GPU';
      ctx.persist();
      ctx.toast('⚙️', `Passo a ${next}…`);
      await ctx.controller.setDelegate(next);
      ctx.toast('⚙️', `Riconoscimento su ${ctx.controller.activeDelegate}`);
    });
  },

  onGesture(g) {
    const d = describeGesture(g.id);
    if (g.repeat) return false;
    this.entries.unshift(`<li><span>${d.emoji}</span> ${d.label} <time>${new Date().toLocaleTimeString('it-IT')}</time></li>`);
    this.entries.length = Math.min(this.entries.length, 8);
    this.log.innerHTML = this.entries.join('');
    return g.id === 'hold_rock' ? false : d.label;
  },
};
