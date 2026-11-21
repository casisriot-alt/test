// "Lettore": read a long text without touching the screen.

const ARTICLE = [
  ['h3', 'Come fa il telefono a vedere la tua mano?'],
  ['p', 'Ogni fotogramma della fotocamera passa attraverso due reti neurali. La prima trova il palmo nell\'immagine; la seconda, concentrata solo su quella zona, stima la posizione di 21 punti chiave: il polso e quattro articolazioni per ciascun dito.'],
  ['p', 'Questi 21 punti bastano per capire molto. Se la punta di un dito è lontana dal polso rispetto alla nocca centrale, il dito è disteso; se è più vicina, è piegato verso il palmo. Combinando le cinque dita si ottengono le pose: mano aperta, pugno, indice, vittoria, pollice su o giù.'],
  ['h3', 'Dalla posa al gesto'],
  ['p', 'Una posa è una fotografia, un gesto è un movimento nel tempo. Gesto ricorda la posizione del palmo negli ultimi istanti: se la mano aperta percorre almeno un quinto dell\'inquadratura in meno di mezzo secondo, è uno swipe. Il movimento di ritorno, quello che facciamo istintivamente dopo uno swipe, viene ignorato per non tornare indietro per sbaglio.'],
  ['p', 'Tenere ferma una posa per poco meno di un secondo è un altro tipo di gesto: è comodo per comandi come play e pausa, perché è difficile da attivare per caso. Mentre tieni la posa, la barra sotto l\'anteprima si riempie.'],
  ['h3', 'Il pizzico, ovvero il clic'],
  ['p', 'Quando la punta del pollice e quella dell\'indice si avvicinano a meno di un quarto della dimensione del palmo, Gesto considera le dita unite. Per evitare tremolii usa due soglie diverse per chiudere e aprire il pizzico. Un pizzico breve è un clic; un pizzico lungo, mentre muovi la mano, è un trascinamento.'],
  ['p', 'C\'è un dettaglio importante: mentre pizzichi, la punta dell\'indice si sposta verso il pollice. Per questo il clic viene registrato dove puntava il dito un istante prima di chiudere le dita, e durante il trascinamento il cursore segue il palmo, che resta stabile.'],
  ['h3', 'Privacy e prestazioni'],
  ['p', 'Tutto il calcolo avviene nel browser, con WebAssembly e, quando disponibile, la GPU del telefono. Le immagini della fotocamera non lasciano mai il dispositivo e l\'app funziona anche offline una volta caricata.'],
  ['p', 'Per un riconoscimento migliore usa una buona illuminazione, tieni la mano a 30–60 centimetri dalla fotocamera e cerca di avere uno sfondo non troppo confuso. Se il telefono è appoggiato, i movimenti risultano più precisi.'],
  ['h3', 'Controllare altre applicazioni'],
  ['p', 'Le gesture non servono solo a questa app. Gesto può inviarle a una pagina che la incorpora, alle altre schede del browser o, tramite un piccolo ponte da avviare sul computer, trasformarle in tasti veri: frecce per le presentazioni, spazio per i video, volume per la musica.'],
  ['p', 'Fine. Fai uno swipe verso il basso per tornare all\'inizio, oppure 🤘 per cambiare app.'],
];

export default {
  id: 'lettore',
  name: 'Lettore',
  icon: '📖',
  hints: [
    ['swipe_up', 'Pagina giù'],
    ['swipe_down', 'Pagina su'],
    ['hold_thumb_up', 'Testo +'],
    ['hold_thumb_down', 'Testo −'],
  ],

  mount(view, ctx) {
    this.view = view;
    this.fontSize = 18;
    view.innerHTML = `
      <h2>Lettore</h2>
      <p class="sub">Scorri con la mano aperta in alto o in basso, oppure pizzica e trascina.</p>
      <article class="rd card" data-ref="article">${ARTICLE.map(([t, s]) => `<${t}>${s}</${t}>`).join('')}</article>
      <div class="rd-progress"><b data-ref="progress"></b></div>`;
    this.article = view.querySelector('[data-ref="article"]');
    this.progress = view.querySelector('[data-ref="progress"]');
    view.addEventListener('scroll', () => this.updateProgress(), { passive: true });

    // Pinch and drag scrolls like a finger on the screen (the air cursor does
    // the same on its own when it is enabled everywhere).
    let start = null;
    ctx.on(this, 'pinchstart', () => (start = ctx.settings.globalCursor ? null : view.scrollTop));
    ctx.on(this, 'pinchmove', ({ dy }) => {
      if (start !== null) view.scrollTop = start - dy * view.clientHeight * 1.5;
    });
    ctx.on(this, 'pinchend', () => (start = null));
    this.setFont(this.fontSize);
  },

  activate() {
    this.updateProgress();
  },

  updateProgress() {
    const v = this.view;
    const max = v.scrollHeight - v.clientHeight;
    this.progress.style.width = `${max > 0 ? (v.scrollTop / max) * 100 : 100}%`;
  },

  page(dir) {
    this.view.scrollBy({ top: dir * this.view.clientHeight * 0.8, behavior: 'smooth' });
  },

  setFont(px) {
    this.fontSize = Math.max(14, Math.min(28, px));
    this.article.style.fontSize = `${this.fontSize}px`;
    return `Testo ${this.fontSize} px`;
  },

  onGesture(g) {
    switch (g.id) {
      case 'swipe_up':
        this.page(1);
        return 'Pagina giù';
      case 'swipe_down':
        this.page(-1);
        return 'Pagina su';
      case 'hold_thumb_up':
        return this.setFont(this.fontSize + 2);
      case 'hold_thumb_down':
        return this.setFont(this.fontSize - 2);
      default:
        return false;
    }
  },
};
