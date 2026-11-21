# Componenti di terze parti

| File | Origine | Licenza |
|------|---------|---------|
| `vendor/mediapipe/vision_bundle.mjs`, `vendor/mediapipe/wasm/*` | [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.21 (npm), Google LLC | Apache 2.0 (`LICENSE`) |
| `models/gesture_recognizer.task` | [MediaPipe Gesture Recognizer](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer) (float16, v1), Google LLC | Apache 2.0 |
| `tests/fixtures/hands/*.jpg` | Immagini di test di MediaPipe (`storage.googleapis.com/mediapipe-assets`) | Apache 2.0 |

Modifiche: da `vision_bundle.mjs` è stato rimosso solo il riferimento alla source map.
Il runtime WebAssembly "nosimd" (per browser senza SIMD) non è incluso: viene
scaricato da jsDelivr solo su quei browser.
