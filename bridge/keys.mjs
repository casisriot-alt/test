// Turns logical key names into real key presses on the computer.
// Only the names below are accepted: nothing coming from the network is ever
// passed to a shell.
import { execFile, spawn } from 'node:child_process';

/** Logical key -> per platform code. */
export const KEYS = {
  Right: { linux: 'Right', darwin: 124, win32: '{RIGHT}' },
  Left: { linux: 'Left', darwin: 123, win32: '{LEFT}' },
  Up: { linux: 'Up', darwin: 126, win32: '{UP}' },
  Down: { linux: 'Down', darwin: 125, win32: '{DOWN}' },
  PageDown: { linux: 'Next', darwin: 121, win32: '{PGDN}' },
  PageUp: { linux: 'Prior', darwin: 116, win32: '{PGUP}' },
  Space: { linux: 'space', darwin: 49, win32: ' ' },
  Enter: { linux: 'Return', darwin: 36, win32: '{ENTER}' },
  Escape: { linux: 'Escape', darwin: 53, win32: '{ESC}' },
  F5: { linux: 'F5', darwin: 96, win32: '{F5}' },
  VolumeUp: { linux: 'XF86AudioRaiseVolume', darwin: 'volume+', win32: 175 },
  VolumeDown: { linux: 'XF86AudioLowerVolume', darwin: 'volume-', win32: 174 },
  Mute: { linux: 'XF86AudioMute', darwin: 'mute', win32: 173 },
  PlayPause: { linux: 'XF86AudioPlay', darwin: 49, win32: 179 },
  NextTrack: { linux: 'XF86AudioNext', darwin: 124, win32: 176 },
  PrevTrack: { linux: 'XF86AudioPrev', darwin: 123, win32: 177 },
};

/** Default gesture -> key mapping: presentations, video and music players. */
export const DEFAULT_MAP = {
  swipe_left: 'Right', // next slide / seek forward
  swipe_right: 'Left', // previous slide / seek back
  swipe_up: 'PageDown',
  swipe_down: 'PageUp',
  hold_open_palm: 'Space', // play / pause
  hold_fist: 'Escape',
  hold_thumb_up: 'VolumeUp',
  hold_thumb_down: 'VolumeDown',
  hold_victory: 'PlayPause',
};

/** Keys that may repeat while a pose is held (others fire once). */
export const REPEATABLE = new Set(['VolumeUp', 'VolumeDown', 'Right', 'Left', 'Up', 'Down', 'PageDown', 'PageUp']);

export function createKeySender({ platform = process.platform, dryRun = false, log = console.log } = {}) {
  if (dryRun) return { platform: `${platform} (prova)`, press: (key) => log(`  ⌨  ${key} (modalità prova: nessun tasto inviato)`), close() {} };

  if (platform === 'win32') {
    // One persistent PowerShell: spawning one per key is too slow.
    const ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', '-'], { stdio: ['pipe', 'ignore', 'inherit'] });
    ps.stdin.write('$w = New-Object -ComObject WScript.Shell\n');
    return {
      platform,
      press(key) {
        const code = KEYS[key]?.win32;
        if (code === undefined) return;
        const arg = typeof code === 'number' ? `[char]${code}` : `'${code}'`;
        ps.stdin.write(`$w.SendKeys(${arg})\n`);
      },
      close: () => ps.kill(),
    };
  }

  if (platform === 'darwin') {
    return {
      platform,
      press(key) {
        const code = KEYS[key]?.darwin;
        if (code === undefined) return;
        const script =
          code === 'volume+'
            ? 'set volume output volume ((output volume of (get volume settings)) + 6)'
            : code === 'volume-'
              ? 'set volume output volume ((output volume of (get volume settings)) - 6)'
              : code === 'mute'
                ? 'set volume output muted (not (output muted of (get volume settings)))'
                : `tell application "System Events" to key code ${Number(code)}`;
        execFile('osascript', ['-e', script], (err) => err && log(`  ⚠ osascript: ${err.message} (serve il permesso "Accessibilità" per il Terminale)`));
      },
      close() {},
    };
  }

  // Linux: X11 via xdotool (on Wayland, install ydotool or use an X session).
  return {
    platform,
    press(key) {
      const code = KEYS[key]?.linux;
      if (!code) return;
      execFile('xdotool', ['key', code], (err) => err && log(`  ⚠ xdotool: ${err.message} (installalo con: sudo apt install xdotool)`));
    },
    close() {},
  };
}
