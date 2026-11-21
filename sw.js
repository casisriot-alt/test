// Service worker: makes Gesto installable and usable offline.
// App code: network first (updates arrive immediately), cache as fallback.
// Heavy assets (WebAssembly runtime, ML model): cache first.

const VERSION = 'gesto-v1';
const HEAVY = ['vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_internal.js', 'models/gesture_recognizer.task'];
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'vendor/mediapipe/vision_bundle.mjs',
  'src/main.js',
  'src/gesture-control.js',
  'src/core/camera.js',
  'src/core/classifier.js',
  'src/core/engine.js',
  'src/core/filters.js',
  'src/core/geometry.js',
  'src/core/gestures.js',
  'src/core/tracker.js',
  'src/ui/air-pointer.js',
  'src/ui/integrations.js',
  'src/ui/overlay.js',
  'src/ui/settings.js',
  'src/apps/playground.js',
  'src/apps/gallery.js',
  'src/apps/music.js',
  'src/apps/pointer.js',
  'src/apps/paint.js',
  'src/apps/reader.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([...SHELL, ...HEAVY]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  const heavy = HEAVY.some((p) => url.pathname.endsWith(p));
  if (heavy) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            if (res.ok) caches.open(VERSION).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(VERSION).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
