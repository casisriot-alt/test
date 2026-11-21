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
//   stats  {fps, inferenceMs, delegate}

import { GestureEngine } from './core/engine.js';
import { closeCamera, openCamera } from './core/camera.js';
import { createRecognizer, toEngineHands } from './core/tracker.js';

export { GestureEngine } from './core/engine.js';
export { GESTURES, POSES, describeGesture, describePose } from './core/gestures.js';

export class GestureController extends EventTarget {
  /**
   * @param {object} options
   * @param {HTMLVideoElement} [options.video]  element that shows the camera (created if missing)
   * @param {'user'|'environment'} [options.facingMode]
   * @param {number} [options.numHands]
   * @param {'GPU'|'CPU'} [options.delegate]
   * @param {object} [options.engine]  GestureEngine options
   */
  constructor({ video, facingMode = 'user', numHands = 1, delegate = 'GPU', engine = {} } = {}) {
    super();
    this.video = video ?? Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    this.facingMode = facingMode;
    this.numHands = numHands;
    this.delegate = delegate;
    this.engine = new GestureEngine({ mirror: facingMode === 'user', ...engine });
    this.recognizer = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.frameTimes = [];
    this.inferenceMs = 0;
    this.frameCount = 0;
    this.lastResult = null;
    this.loop = this.loop.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
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

  async loadModel() {
    if (this.recognizer) return;
    this.setStatus('loading', 'Caricamento del modello di riconoscimento…');
    const { recognizer, delegate } = await createRecognizer({ numHands: this.numHands, delegate: this.delegate });
    this.recognizer = recognizer;
    this.activeDelegate = delegate;
  }

  async fallbackToCpu() {
    try {
      const { recognizer } = await createRecognizer({ numHands: this.numHands, delegate: 'CPU' });
      const old = this.recognizer;
      this.recognizer = recognizer;
      this.activeDelegate = 'CPU';
      this.inferenceMs = 0;
      this.lastTimestamp += 1;
      old.close();
      this.setStatus('running', 'La GPU era lenta: ora il riconoscimento usa la CPU');
    } catch (err) {
      console.warn('CPU fallback failed', err);
    }
  }

  async start() {
    try {
      // Camera and model load in parallel: the permission prompt shows up immediately.
      this.setStatus('loading', 'Avvio della fotocamera…');
      const [cam] = await Promise.all([openCamera(this.video, { facingMode: this.facingMode }), this.loadModel()]);
      this.stream = cam.stream;
      this.applyFacing(cam.facingMode);
      this.running = true;
      document.addEventListener('visibilitychange', this.onVisibility);
      this.setStatus('running');
      this.schedule();
    } catch (err) {
      this.setStatus('error', err.message || String(err));
      throw err;
    }
  }

  stop() {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    closeCamera(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    this.engine.reset();
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

  schedule() {
    if (!this.running || document.hidden || this.scheduled) return;
    this.scheduled = true;
    if ('requestVideoFrameCallback' in this.video) this.video.requestVideoFrameCallback(this.loop);
    else requestAnimationFrame(this.loop);
  }

  loop() {
    this.scheduled = false;
    if (!this.running) return;
    try {
      this.processFrame();
    } catch (err) {
      console.error(err);
    }
    this.schedule();
  }

  processFrame() {
    const v = this.video;
    if (this.paused || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    // MediaPipe needs strictly increasing timestamps.
    const now = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;

    const t0 = performance.now();
    const result = this.recognizer.recognizeForVideo(v, now);
    this.inferenceMs = this.inferenceMs * 0.9 + (performance.now() - t0) * 0.1;
    this.lastResult = result;
    // Some devices expose WebGL without a usable GPU (software rendering):
    // there the CPU (WebAssembly SIMD) is several times faster.
    if (++this.frameCount === 45 && this.activeDelegate === 'GPU' && this.inferenceMs > 70) this.fallbackToCpu();

    this.engine.process({ timestamp: now, width: v.videoWidth, height: v.videoHeight, hands: toEngineHands(result) });

    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.dispatchEvent(
      new CustomEvent('stats', {
        detail: { fps: this.frameTimes.length, inferenceMs: this.inferenceMs, delegate: this.activeDelegate },
      }),
    );
  }
}
