// App shell: camera + gesture engine + demo applications.

import { GestureController, describeGesture, describePose } from './gesture-control.js';
import { cameraErrorMessage } from './core/camera.js';
import { AirPointer } from './ui/air-pointer.js';
import { Integrations } from './ui/integrations.js';
import { SkeletonOverlay } from './ui/overlay.js';
import { engineOptionsFrom, loadSettings, saveSettings } from './ui/settings.js';
import playground from './apps/playground.js';
import gallery from './apps/gallery.js';
import music from './apps/music.js';
import pointerApp from './apps/pointer.js';
import paint from './apps/paint.js';
import reader from './apps/reader.js';

const APPS = [playground, gallery, music, pointerApp, paint, reader];
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const settings = loadSettings();
// Opened from the PC bridge (https://<pc>:8443/?bridge=<token>): connect back to it.
if (params.get('bridge')) {
  settings.bridgeUrl = `wss://${location.host}/gesto?token=${encodeURIComponent(params.get('bridge'))}`;
  saveSettings(settings);
}

const video = $('video');
const preview = $('preview');
const overlay = new SkeletonOverlay($('overlay'), video);
const controller = new GestureController({
  video,
  facingMode: settings.facingMode,
  numHands: Number(settings.numHands),
  delegate: settings.gpu ? 'GPU' : 'CPU',
  engine: engineOptionsFrom(settings),
});
const engine = controller.engine;

let active = null;
let audioContext = null;
let lastStats = { fps: 0 };

// ---------------------------------------------------------------- helpers
let toastTimer;
function toast(emoji, text, ms = 1300) {
  const el = $('toast');
  el.querySelector('.toast-emoji').textContent = emoji;
  el.querySelector('.toast-text').textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function haptic(pattern = 18) {
  if (settings.haptics) navigator.vibrate?.(pattern);
}

function getAudio() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioContext = new Ctx();
  }
  if (audioContext?.state === 'suspended') audioContext.resume();
  return audioContext;
}

function persist() {
  saveSettings(settings);
}

// ---------------------------------------------------------------- apps
const ctx = {
  toast,
  haptic,
  persist: () => persist(),
  audio: getAudio,
  settings,
  controller,
  /** Subscribe to engine events; the handler only runs while the app is active. */
  on(app, type, handler) {
    return controller.on(type, (detail) => {
      if (active === app) handler(detail);
    });
  },
};

const stage = $('stage');
const tabbar = $('tabbar');
for (const app of APPS) {
  const view = document.createElement('section');
  view.className = 'view';
  view.dataset.app = app.id;
  view.setAttribute('aria-label', app.name);
  stage.append(view);
  app.view = view;
  app.mount(view, ctx);

  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.app = app.id;
  tab.innerHTML = `<span aria-hidden="true">${app.icon}</span><span>${app.name}</span>`;
  tab.addEventListener('click', () => switchApp(app.id));
  tabbar.append(tab);
  app.tab = tab;
}

function renderHints(app) {
  const hints = $('hints');
  hints.replaceChildren(
    ...[...app.hints, ['hold_rock', 'App successiva']].map(([id, label]) => {
      const chip = document.createElement('span');
      chip.className = 'hint';
      chip.dataset.gesture = id;
      chip.innerHTML = `<b>${describeGesture(id).emoji}</b>${label}`;
      return chip;
    }),
  );
}

function flashHint(id) {
  const chip = $('hints').querySelector(`[data-gesture="${id}"]`);
  if (!chip) return;
  chip.classList.add('flash');
  chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  setTimeout(() => chip.classList.remove('flash'), 500);
}

function switchApp(id) {
  const next = APPS.find((a) => a.id === id) ?? APPS[0];
  if (next === active) return;
  active?.deactivate?.();
  active?.view.classList.remove('active');
  active?.tab.removeAttribute('aria-current');
  active = next;
  active.view.classList.add('active');
  active.tab.setAttribute('aria-current', 'page');
  active.view.scrollTop = 0;
  renderHints(active);
  active.activate?.();
  settings.app = active.id;
  persist();
  if (!pointerEnabled()) airPointer.setVisible(false);
}

// ---------------------------------------------------------------- air pointer
const pointerEnabled = () => controller.running && (settings.globalCursor || !!active?.pointer);
const airPointer = new AirPointer({ cursor: $('cursor'), progress: $('cursor-progress'), isEnabled: pointerEnabled });

const integrations = new Integrations({
  onBridgeStatus: (state, text) => {
    $('bridge-status').textContent = text;
    $('bridge-status').dataset.state = state;
  },
});

controller.on('pointer', (p) => {
  airPointer.onPointer(p);
  integrations.send('pointer', { x: p.x, y: p.y, pinching: p.pinching });
});
controller.on('pinchstart', (p) => airPointer.onPinchStart(p));
controller.on('pinchmove', (p) => airPointer.onPinchMove(p));
controller.on('pinchend', (p) => airPointer.onPinchEnd(p));

controller.on('holdprogress', ({ progress }) => {
  airPointer.setProgress(progress);
  preview.style.setProperty('--hold', progress.toFixed(3));
});

controller.on('gesture', (g) => {
  integrations.send('gesture', g);
  if (g.id === 'tap') {
    const clicked = airPointer.onTap(g);
    const handled = active?.onGesture?.(g);
    if (clicked || handled) haptic(12);
    if (handled && typeof handled === 'string') toast('🤏', handled);
    flashHint(g.id);
    return;
  }
  let label = active?.onGesture?.(g);
  if (!label && g.id === 'hold_rock' && !g.repeat) {
    const i = APPS.indexOf(active);
    const next = APPS[(i + 1) % APPS.length];
    switchApp(next.id);
    label = `${next.icon} ${next.name}`;
  }
  if (label) {
    if (!g.repeat) haptic();
    toast(describeGesture(g.id).emoji, typeof label === 'string' ? label : describeGesture(g.id).label);
    flashHint(g.id);
  }
  airPointer.setProgress(0);
  preview.style.setProperty('--hold', '0');
});

controller.on('pose', ({ pose }) => {
  $('status-pose').textContent = describePose(pose).emoji;
  $('preview-label').textContent = pose === 'none' ? '' : describePose(pose).label;
  integrations.send('pose', { pose });
});

controller.on('hand', ({ present }) => {
  preview.classList.toggle('hand', present);
  if (!present) {
    airPointer.setVisible(false);
    $('status-pose').textContent = '·';
    $('preview-label').textContent = '';
  }
  updateStatus();
});

controller.on('frame', (f) => {
  const result = controller.lastResult;
  if (!settings.showPreview || !settings.showSkeleton || !result) return overlay.clear();
  const hands = result.landmarks ?? [];
  overlay.draw(hands, { pinching: f.pinching, primary: Math.max(0, hands.findIndex((h) => h === f.hand?.landmarks)) });
});

controller.on('stats', (s) => {
  lastStats = s;
  updateStatusThrottled();
});

controller.on('status', ({ state, message }) => {
  if (state === 'running' && message) {
    toast('⚙️', message, 2500);
    $('about').textContent = `Motore: MediaPipe GestureRecognizer (${controller.activeDelegate}).`;
  }
  if (state === 'error') $('status-text').textContent = 'Errore';
  if (state === 'loading') $('status-text').textContent = 'Avvio…';
  updateStatus();
  if (message && state === 'loading') $('intro-error').textContent = '';
});

let statusTick = 0;
function updateStatusThrottled() {
  const now = performance.now();
  if (now - statusTick > 500) {
    statusTick = now;
    updateStatus();
  }
}

function updateStatus() {
  const s = $('status');
  const state = controller.status === 'running' ? (engine.present ? 'hand' : 'running') : controller.status;
  s.dataset.state = state ?? 'stopped';
  if (controller.status === 'running') {
    $('status-text').textContent = engine.present ? `Mano · ${lastStats.fps} fps` : `Cerco la mano · ${lastStats.fps} fps`;
  } else if (controller.status === 'stopped' || !controller.status) {
    $('status-text').textContent = 'Spento';
  }
}

// ---------------------------------------------------------------- screen wake lock
// Nobody touches the screen while using gestures: keep it from turning off.
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.hidden || !controller.running) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* battery saver or not allowed: the screen may turn off as usual */
  }
}
// The browser releases the lock when the page is hidden: take it again on return.
document.addEventListener('visibilitychange', () => !document.hidden && keepAwake());

// ---------------------------------------------------------------- start / stop
async function start() {
  const btn = $('btn-start');
  btn.disabled = true;
  btn.textContent = 'Avvio in corso…';
  $('intro-error').textContent = '';
  getAudio(); // unlock audio inside the user gesture (iOS)
  try {
    await controller.start();
    keepAwake();
    preview.classList.toggle('mirrored', controller.mirrored);
    $('intro').classList.add('hidden');
    $('about').textContent = `Motore: MediaPipe GestureRecognizer (${controller.activeDelegate}). Video ${video.videoWidth}×${video.videoHeight}.`;
    if (settings.bridgeUrl) integrations.connectBridge(settings.bridgeUrl);
  } catch (err) {
    console.error(err);
    $('intro-error').textContent = err.code ? cameraErrorMessage(err.code) : `Errore: ${err.message || err}`;
    btn.disabled = false;
    btn.textContent = 'Riprova';
  }
}

$('btn-start').addEventListener('click', start);
// Tap the preview to move it to the other corner when it covers something.
preview.addEventListener('click', () => preview.classList.toggle('left'));
$('btn-stop').addEventListener('click', () => {
  controller.stop();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $('settings').close();
  overlay.clear();
  airPointer.setVisible(false);
  $('intro').classList.remove('hidden');
  $('btn-start').disabled = false;
  $('btn-start').textContent = 'Avvia la fotocamera';
});

// ---------------------------------------------------------------- settings UI
const form = $('settings-form');

function fillForm() {
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = String(settings[el.name]);
  }
}

function applySettings(changed) {
  engine.setOptions(engineOptionsFrom(settings));
  preview.classList.toggle('hidden', !settings.showPreview);
  integrations.configure(settings);
  if (changed === 'facingMode') {
    controller
      .setFacingMode(settings.facingMode)
      .then(() => preview.classList.toggle('mirrored', controller.mirrored))
      .catch((err) => toast('⚠️', err.message));
  }
  if (changed === 'numHands') controller.setNumHands(Number(settings.numHands));
  if (changed === 'gpu') {
    controller.setDelegate(settings.gpu ? 'GPU' : 'CPU').then(() => {
      if (controller.running) toast('⚙️', `Riconoscimento su ${controller.activeDelegate}`);
    });
  }
  if (changed === 'globalCursor' && !pointerEnabled()) airPointer.setVisible(false);
}

form.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.name || !(el.name in settings)) return;
  settings[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  persist();
  applySettings(el.name);
});

$('btn-settings').addEventListener('click', () => {
  fillForm();
  $('settings').showModal();
});
$('settings').addEventListener('click', (e) => {
  if (e.target === $('settings')) $('settings').close(); // click on the backdrop
});
$('btn-bridge').addEventListener('click', () => {
  settings.bridgeUrl = form.elements.bridgeUrl.value.trim();
  persist();
  if (settings.bridgeUrl) integrations.connectBridge(settings.bridgeUrl);
  else {
    integrations.disconnectBridge();
    $('bridge-status').textContent = 'Non collegato.';
  }
});

// ---------------------------------------------------------------- boot
applySettings();
switchApp(params.get('app') || settings.app);
updateStatus();

if (!window.isSecureContext) {
  $('intro-error').textContent = cameraErrorMessage('insecure');
}

if ('serviceWorker' in navigator && window.isSecureContext && params.get('nosw') === null) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker', err));
}

// Exposed for debugging, automated tests and other scripts on the page.
window.gesto = { controller, engine, apps: APPS, switchApp, settings, integrations, airPointer, start };
