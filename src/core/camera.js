// Camera helper: opens the front or rear camera at a resolution that is
// plenty for hand tracking and cheap to process on a phone.

export class CameraError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

const MESSAGES = {
  insecure: 'La fotocamera è disponibile solo su HTTPS (o su localhost).',
  unsupported: 'Questo browser non permette di usare la fotocamera.',
  denied: 'Permesso fotocamera negato. Abilitalo dalle impostazioni del browser e riprova.',
  notfound: 'Nessuna fotocamera trovata su questo dispositivo.',
  busy: 'La fotocamera è già in uso da un\'altra applicazione.',
  unknown: 'Impossibile avviare la fotocamera.',
};

export function cameraErrorMessage(code) {
  return MESSAGES[code] ?? MESSAGES.unknown;
}

export async function openCamera(video, { facingMode = 'user', width = 640, height = 480 } = {}) {
  if (!window.isSecureContext) throw new CameraError('insecure', MESSAGES.insecure);
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', MESSAGES.unsupported);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (err) {
    const code =
      err.name === 'NotAllowedError' || err.name === 'SecurityError'
        ? 'denied'
        : err.name === 'NotFoundError' || err.name === 'OverconstrainedError'
          ? 'notfound'
          : err.name === 'NotReadableError'
            ? 'busy'
            : 'unknown';
    throw new CameraError(code, MESSAGES[code], err);
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  await new Promise((resolve) => {
    if (video.readyState >= 2) resolve();
    else video.addEventListener('loadeddata', resolve, { once: true });
  });
  await video.play().catch(() => {});
  const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
  return { stream, facingMode: settings.facingMode || facingMode };
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}
