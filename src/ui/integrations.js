// Forwards recognised gestures to other applications.
//
//  - postMessage to the parent window when Gesto is embedded in an <iframe>
//    (the host page must add allow="camera" to the iframe)
//  - BroadcastChannel "gesto" for other tabs / windows of the same site
//  - synthetic keyboard events in this page (for embedded widgets that use keys)
//  - WebSocket to the PC bridge (bridge/server.mjs), which turns gestures into
//    real key presses on the computer: slides, video players, music, …

export const CHANNEL = 'gesto';

/** Default gesture -> key mapping, shared with the PC bridge. */
export const KEY_MAP = {
  swipe_left: 'ArrowRight',
  swipe_right: 'ArrowLeft',
  swipe_up: 'ArrowDown',
  swipe_down: 'ArrowUp',
  hold_open_palm: ' ',
  hold_fist: 'Escape',
  tap: 'Enter',
  hold_thumb_up: 'AudioVolumeUp',
  hold_thumb_down: 'AudioVolumeDown',
};

export class Integrations {
  constructor({ onBridgeStatus } = {}) {
    this.embedded = window.parent !== window;
    this.channel = null;
    this.keyboard = false;
    this.ws = null;
    this.wsUrl = '';
    this.onBridgeStatus = onBridgeStatus ?? (() => {});
    this.retry = null;
  }

  configure({ broadcast, keyboard }) {
    this.keyboard = !!keyboard;
    if (broadcast && !this.channel && 'BroadcastChannel' in window) this.channel = new BroadcastChannel(CHANNEL);
    if (!broadcast && this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  /** Sends an event to every enabled output. */
  send(type, detail) {
    const message = { source: 'gesto', type, ...detail, time: Date.now() };
    if (this.embedded) window.parent.postMessage(message, '*');
    this.channel?.postMessage(message);
    if (type === 'gesture') {
      if (this.keyboard) this.pressKey(detail.id);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    } else if (type === 'pointer' && this.ws?.readyState === WebSocket.OPEN && this.wantsPointer) {
      this.ws.send(JSON.stringify(message));
    }
  }

  pressKey(gestureId) {
    const key = KEY_MAP[gestureId];
    if (!key) return;
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key, code: key === ' ' ? 'Space' : key, bubbles: true }));
    }
  }

  connectBridge(url) {
    this.disconnectBridge();
    if (!url) return;
    this.wsUrl = url;
    this.onBridgeStatus('connecting', `Connessione a ${url}…`);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.onBridgeStatus('error', `Indirizzo non valido: ${err.message}`);
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => this.onBridgeStatus('open', 'Collegato al PC ✓'));
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'hello') {
          this.wantsPointer = !!msg.pointer;
          this.onBridgeStatus('open', `Collegato a ${msg.host ?? 'PC'} (${msg.platform ?? '?'}) ✓`);
        }
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.onBridgeStatus('closed', 'Ponte disconnesso: nuovo tentativo tra 3 s…');
      this.retry = setTimeout(() => this.ws === ws && this.connectBridge(this.wsUrl), 3000);
    });
    ws.addEventListener('error', () => this.onBridgeStatus('error', 'Impossibile collegarsi al ponte PC.'));
  }

  disconnectBridge() {
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
