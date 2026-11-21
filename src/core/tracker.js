// Loads MediaPipe's GestureRecognizer (hand landmarks + gesture model) and
// runs it on video frames. The library, its WebAssembly runtime and the model
// are served from this site (vendor/ and models/), so the app works offline
// once cached and no image ever leaves the device.

import { FilesetResolver, GestureRecognizer } from '../../vendor/mediapipe/vision_bundle.mjs';

const VERSION = '0.10.21';
const LOCAL_WASM = new URL('../../vendor/mediapipe/wasm/', import.meta.url).href;
// Very old browsers without WebAssembly SIMD need the "nosimd" runtime, which
// is not bundled to keep the app small: it is fetched from the CDN.
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/`;
export const DEFAULT_MODEL = new URL('../../models/gesture_recognizer.task', import.meta.url).href;

async function wasmFileset() {
  const simd = await FilesetResolver.isSimdSupported();
  const base = simd ? LOCAL_WASM : CDN_WASM;
  const name = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  return { wasmLoaderPath: `${base}${name}.js`, wasmBinaryPath: `${base}${name}.wasm` };
}

/**
 * Creates the recognizer, preferring the GPU delegate and falling back to the
 * CPU when WebGL is not usable.
 * @returns {Promise<{recognizer: GestureRecognizer, delegate: string}>}
 */
export async function createRecognizer({ numHands = 1, delegate = 'GPU', modelAssetPath = DEFAULT_MODEL, runningMode = 'VIDEO' } = {}) {
  const fileset = await wasmFileset();
  const make = (d) =>
    GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: d },
      runningMode,
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  if (delegate === 'GPU') {
    try {
      return { recognizer: await make('GPU'), delegate: 'GPU' };
    } catch (err) {
      console.warn('GPU delegate not available, using CPU', err);
    }
  }
  return { recognizer: await make('CPU'), delegate: 'CPU' };
}

/** Converts a GestureRecognizer result into the engine's frame format. */
export function toEngineHands(result) {
  return (result.landmarks ?? []).map((landmarks, i) => ({
    landmarks,
    world: result.worldLandmarks?.[i],
    handedness: result.handedness?.[i]?.[0]?.categoryName ?? result.handednesses?.[i]?.[0]?.categoryName,
    category: result.gestures?.[i]?.[0]?.categoryName,
    score: result.gestures?.[i]?.[0]?.score ?? 0,
  }));
}
