// Persisted user settings (localStorage, with safe fallbacks).

const KEY = 'gesto.settings.v1';

export const DEFAULT_SETTINGS = {
  facingMode: 'user',
  numHands: 1,
  gpu: true,
  showPreview: true,
  showSkeleton: true,
  swipeSensitivity: 'medium',
  holdMs: 800,
  classifier: 'fusion',
  globalCursor: false,
  haptics: true,
  broadcast: false,
  keyboard: false,
  bridgeUrl: '',
  app: 'prova',
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or storage disabled: settings just won't persist */
  }
}

const SWIPE = {
  low: { minDistance: 0.28, minSpeed: 0.9 },
  medium: { minDistance: 0.2, minSpeed: 0.6 },
  high: { minDistance: 0.14, minSpeed: 0.45 },
};

/** Translates user settings into GestureEngine options. */
export function engineOptionsFrom(settings) {
  return {
    classifier: settings.classifier,
    swipe: SWIPE[settings.swipeSensitivity] ?? SWIPE.medium,
    hold: { ms: Number(settings.holdMs) || 800 },
  };
}
