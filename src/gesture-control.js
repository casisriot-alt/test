// Public API: hand-gesture control for any web page.
//
//   import { GestureController } from './src/gesture-control.js';
//   const gc = new GestureController({ video: document.querySelector('video') });
//   gc.on('gesture', ({ id }) => { if (id === 'swipe_left') nextSlide(); });
//   await gc.start();
//
// Events (all also available on gc.engine):
//   gesture, pose, pointer, pinchstart, pinchmove, pinchend, holdprogress,
//   hand, frame  — see src/core/engine.js
//   status {state: 'loading'|'ready'|'running'|'stopped'|'error', message}
//   stats  {fps, inferenceMs, delegate, diagnostics}

import { GestureEngine } from './core/engine.js';
import { closeCamera, openCamera } from './core/camera.js';
import { createRecognizer, toEngineHands } from './core/tracker.js';

export { GestureEngine } from './core/engine.js';
export { GESTURES, POSES, describeGesture, describePose } from './core/gestures.js';

const MAX_SIDE = 640; // frames are scaled down to this size before inference

export class GestureController extends EventTarget {
  /**
   * @param {object} options
   * @param {HTMLVideoElement} [options.video]  element that shows the camera (created if missing)
   * @param {'user'|'environment'} [options.facingMode]
   * @param {number} [options.numHands]
   * @param {'GPU'|'CPU'} [options.delegate]
   * @param {'canvas'|'video'} [options.input]  how frames reach MediaPipe (canvas copy is the robust default)
   * @param {object} [options.engine]  GestureEngine options
   */
  constructor({ video, facingMode = 'user', numHands = 1, delegate = 'GPU', input = 'canvas', engine = {} } = {}) {
    super();
    this.video = video ?? Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    this.facingMode = facingMode;
    this.numHands = numHands;
    this.delegate = delegate;
    this.input = input;
    this.engine = new GestureEngine({ mirror: facingMode === 'user', ...engine });
    this.recognizer = null;
    this.checker = null; // CPU recognizer used to verify a GPU that sees nothing
    this.stream = null;
    this.running = false;
    this.loopMode = 'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'rvfc' : 'raf';
    this.loopGen = 0;
    this.frame = document.createElement('canvas');
    this.frameCtx = this.frame.getContext('2d', { alpha: false });
    this.probe = document.createElement('canvas');
    Object.assign(this.probe, { width: 16, height: 12 });
    this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
    this.onVisibility = this.onVisibility.bind(this);
    this.resetCounters();
  }

  resetCounters() {
    this.lastVideoTime = -1;
    this.lastTimestamp = this.lastTimestamp ?? 0;
    this.frameTimes = [];
    this.inferenceMs = 0;
    this.frameCount = 0;
    this.consecutiveErrors = 0;
    this.lastProcessedAt = performance.now();
    this.lastHandAt = performance.now();
    this.lastCheckAt = 0;
    this.darkSince = null;
    this.gpuVerified = false;
    this.lastResult = null;
    this.diag = {
      frames: 0,
      framesWithHands: 0,
      errors: 0,
      lastError: '',
      brightness: null,
      checks: 0,
      notes: [],
    };
  }

  /** Subscribes to an event; returns a function that unsubscribes. */
  on(type, handler) {
    const target = ['status', 'stats'].includes(type) ? this : this.engine;
    const listener = (e) => handler(e.detail, e);
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  }

  setStatus(state, message = '') {
    this.status = state;
    this.dispatchEvent(new CustomEvent('status', { detail: { state, message } }));
  }

  note(text) {
    this.diag.notes.push(`${new Date().toLocaleTimeString('it-IT')} ${text}`);
    if (this.diag.notes.length > 8) this.diag.notes.shift();
  }

  async loadModel() {
    if (this.recognizer) return;
    this.setStatus('loading', 'Caricamento del modello di riconoscimento…');
    const { recognizer, delegate } = await createRecognizer({ numHands: this.numHands, delegate: this.delegate });
    this.recognizer = recognizer;
    this.activeDelegate = delegate;
    if (delegate !== this.delegate) this.note(`GPU non disponibile: uso ${delegate}`);
  }

  /** Switches between GPU and CPU without stopping the camera. */
  async setDelegate(delegate, reason = '') {
    if (this.switching) return;
    this.delegate = delegate;
    if (!this.recognizer || this.activeDelegate === delegate) return;
    this.switching = true;
    try {
      const { recognizer, delegate: actual } = await createRecognizer({ numHands: this.numHands, delegate });
      const old = this.recognizer;
      this.recognizer = recognizer;
      this.activeDelegate = actual;
      this.inferenceMs = 0;
      this.frameCount = 0;
      this.consecutiveErrors = 0;
      this.lastTimestamp += 1;
      old.close();
      this.closeChecker();
      this.note(`Riconoscimento su ${actual}${reason ? `: ${reason}` : ''}`);
      if (reason) this.setStatus('running', reason);
    } catch (err) {
      this.note(`Cambio a ${delegate} non riuscito: ${err.message}`);
    } finally {
      this.switching = false;
    }
  }

  fallbackToCpu(reason) {
    return this.setDelegate('CPU', reason);
  }

  async start() {
    try {
      // Camera and model load in parallel: the permission prompt shows up immediately.
      this.setStatus('loading', 'Avvio della fotocamera…');
      const [cam] = await Promise.all([openCamera(this.video, { facingMode: this.facingMode }), this.loadModel()]);
      this.stream = cam.stream;
      this.applyFacing(cam.facingMode);
      this.resetCounters();
      this.running = true;
      document.addEventListener('visibilitychange', this.onVisibility);
      this.watchdog = setInterval(() => this.checkHealth(), 1000);
      this.setStatus('running');
      this.schedule();
    } catch (err) {
      this.setStatus('error', err.message || String(err));
      throw err;
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.watchdog);
    document.removeEventListener('visibilitychange', this.onVisibility);
    closeCamera(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    this.engine.reset();
    this.closeChecker();
    this.setStatus('stopped');
  }

  /** Temporarily ignores the camera (the stream stays open). */
  pause() {
    this.paused = true;
    this.engine.reset();
  }

  resume() {
    this.paused = false;
  }

  async switchCamera() {
    const next = this.facingMode === 'user' ? 'environment' : 'user';
    return this.setFacingMode(next);
  }

  async setFacingMode(mode) {
    this.facingMode = mode;
    if (!this.running) return;
    closeCamera(this.stream);
    const cam = await openCamera(this.video, { facingMode: mode });
    this.stream = cam.stream;
    this.applyFacing(cam.facingMode);
    this.engine.reset();
  }

  applyFacing(actual) {
    // Desktop webcams often report no facing mode: they behave like a selfie camera.
    const mirrored = actual !== 'environment';
    this.mirrored = mirrored;
    this.engine.setOptions({ mirror: mirrored });
  }

  async setNumHands(n) {
    this.numHands = n;
    await this.recognizer?.setOptions({ numHands: n });
  }

  onVisibility() {
    if (!document.hidden && this.running && this.video.paused) this.video.play().catch(() => {});
    if (!document.hidden) this.schedule();
  }

  // ------------------------------------------------------------------ loop
  schedule() {
    if (!this.running || document.hidden || this.scheduled) return;
    this.scheduled = true;
    const gen = this.loopGen;
    const cb = () => this.loop(gen);
    if (this.loopMode === 'rvfc') this.video.requestVideoFrameCallback(cb);
    else requestAnimationFrame(cb);
  }

  loop(gen) {
    if (gen !== this.loopGen) return; // a callback from a loop that was replaced
    this.scheduled = false;
    if (!this.running) return;
    try {
      this.processFrame();
      this.consecutiveErrors = 0;
    } catch (err) {
      this.diag.errors++;
      this.diag.lastError = err?.message || String(err);
      if (this.diag.errors <= 3) console.error(err);
      if (++this.consecutiveErrors >= 10 && this.activeDelegate === 'GPU') {
        this.consecutiveErrors = 0;
        this.fallbackToCpu('La GPU dava errori: ora il riconoscimento usa la CPU');
      }
    }
    this.schedule();
  }

  /** Runs every second: restarts a stalled video or frame loop. */
  checkHealth() {
    if (!this.running || this.paused || this.switching || document.hidden) return;
    const v = this.video;
    if (v.paused || v.ended) v.play().catch(() => {});
    if (performance.now() - this.lastProcessedAt > 2000 && v.readyState >= 2) {
      // requestVideoFrameCallback can stop firing (e.g. when the browser does
      // not composite the video): fall back to a plain animation loop.
      if (this.loopMode === 'rvfc') this.note('requestVideoFrameCallback fermo: uso requestAnimationFrame');
      this.loopMode = 'raf';
      this.loopGen++;
      this.scheduled = false;
      this.schedule();
    }
  }

  /** Copies the current video frame to a canvas, at most MAX_SIDE pixels wide. */
  grabFrame() {
    const v = this.video;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    if (this.frame.width !== w || this.frame.height !== h) Object.assign(this.frame, { width: w, height: h });
    this.frameCtx.drawImage(v, 0, 0, w, h);
    return this.frame;
  }

  /** Average luminance (0-255) of the frame: tells if the camera delivers images. */
  measureBrightness(source) {
    this.probeCtx.drawImage(source, 0, 0, 16, 12);
    const d = this.probeCtx.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return Math.round(sum / (d.length / 4));
  }

  processFrame() {
    const v = this.video;
    if (this.paused || v.readyState < 2 || !v.videoWidth || !this.recognizer) return;
    const now = performance.now();
    // With requestAnimationFrame we may be called again before a new frame.
    if (this.loopMode === 'raf' && v.currentTime === this.lastVideoTime && now - this.lastProcessedAt < 100) return;
    this.lastVideoTime = v.currentTime;
    this.lastProcessedAt = now;

    const source = this.input === 'canvas' ? this.grabFrame() : v;
    if (this.diag.frames % 30 === 0) this.checkBrightness(source, now);

    // MediaPipe needs strictly increasing timestamps.
    const ts = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const t0 = performance.now();
    const result = this.recognizer.recognizeForVideo(source, ts);
    this.inferenceMs = this.inferenceMs * 0.9 + (performance.now() - t0) * 0.1;
    this.lastResult = result;
    this.diag.frames++;
    const hands = toEngineHands(result);
    if (hands.length) {
      this.diag.framesWithHands++;
      this.lastHandAt = now;
      if (this.activeDelegate === 'GPU' && !this.gpuVerified) {
        this.gpuVerified = true;
        this.closeChecker();
      }
    } else {
      this.crossCheck(source, now);
    }

    // Some devices expose WebGL without a usable GPU (software rendering):
    // there the CPU (WebAssembly SIMD) is several times faster.
    if (++this.frameCount === 45 && this.activeDelegate === 'GPU' && this.inferenceMs > 70) {
      this.fallbackToCpu('La GPU era lenta: ora il riconoscimento usa la CPU');
    }

    this.engine.process({ timestamp: ts, width: source.width || v.videoWidth, height: source.height || v.videoHeight, hands });

    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.dispatchEvent(
      new CustomEvent('stats', {
        detail: { fps: this.frameTimes.length, inferenceMs: this.inferenceMs, delegate: this.activeDelegate, diagnostics: this.diagnostics() },
      }),
    );
  }

  checkBrightness(source, now) {
    try {
      this.diag.brightness = this.measureBrightness(source);
    } catch {
      this.diag.brightness = null;
      return;
    }
    // Black frames through the canvas: try handing the <video> directly to MediaPipe.
    if (this.diag.brightness <= 2) {
      this.darkSince ??= now;
      if (this.input === 'canvas' && now - this.darkSince > 3000) {
        this.input = 'video';
        this.note('Fotogrammi neri dal canvas: passo il video direttamente');
      }
    } else {
      this.darkSince = null;
    }
  }

  /**
   * A GPU that never finds a hand may be broken on this device (it happens with
   * some WebGL drivers). While no hand is seen, every 1.5 s the same frame is
   * also analysed on the CPU: if the CPU finds a hand, switch to the CPU.
   */
  crossCheck(source, now) {
    if (this.activeDelegate !== 'GPU' || this.gpuVerified || this.switching) return;
    const interval = this.diag.checks < 20 ? 1500 : 5000;
    if (now - this.lastHandAt < 2500 || now - this.lastCheckAt < interval) return;
    this.lastCheckAt = now;
    if (!this.checker) {
      if (!this.checkerLoading) {
        this.checkerLoading = createRecognizer({ numHands: 1, delegate: 'CPU', runningMode: 'IMAGE' })
          .then(({ recognizer }) => (this.checker = recognizer))
          .catch((err) => this.note(`Verifica CPU non disponibile: ${err.message}`));
      }
      return;
    }
    this.diag.checks++;
    const found = this.checker.recognize(source).landmarks?.length > 0;
    if (found) this.fallbackToCpu('La GPU non vedeva la mano: ora il riconoscimento usa la CPU');
  }

  closeChecker() {
    this.checker?.close();
    this.checker = null;
    this.checkerLoading = null;
  }

  /** Snapshot of what the pipeline is doing, for troubleshooting. */
  diagnostics() {
    const v = this.video;
    return {
      stato: this.status,
      delegato: this.activeDelegate ?? '-',
      ingresso: this.input,
      ciclo: this.loopMode,
      video: `${v.videoWidth}×${v.videoHeight}${v.paused ? ' (in pausa)' : ''}`,
      fps: this.frameTimes.length,
      msInferenza: Math.round(this.inferenceMs),
      fotogrammi: this.diag.frames,
      conMano: this.diag.framesWithHands,
      luminosita: this.diag.brightness,
      verificheCpu: this.diag.checks,
      errori: this.diag.errors,
      ultimoErrore: this.diag.lastError,
      note: this.diag.notes,
    };
  }
}
