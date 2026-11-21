// Air pointer: turns the engine's pointer / pinch events into an on-screen
// cursor and synthetic DOM events, so any control of the page can be used
// without touching the screen:
//   - pointer moves the cursor and highlights the element under it
//   - a pinch dispatches pointerdown / pointermove / pointerup to elements
//     that accept drags ([data-air-drag]: sliders, canvases, …); anywhere else
//     pinch-and-move scrolls the page like a finger on the screen
//   - a quick pinch ("tap") clicks the element under the cursor

const CLICKABLE = 'button, a[href], label, select, input, summary, [data-air-click], [role="button"], [role="tab"]';
const CIRCUMFERENCE = 2 * Math.PI * 20;

function scrollableAncestor(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

export class AirPointer {
  constructor({ cursor, progress, isEnabled }) {
    this.cursor = cursor;
    this.progress = progress;
    this.isEnabled = isEnabled; // () => boolean
    this.hover = null;
    this.dragTarget = null;
    this.pos = { x: 0, y: 0 };
    this.pointerId = 9001;
  }

  /** Element under the cursor, ignoring the preview and overlays. */
  elementAt(x, y) {
    const els = document.elementsFromPoint(x, y);
    return els.find((el) => !el.closest('[data-air-ignore]') && el !== document.documentElement) ?? null;
  }

  toClient(p) {
    return { x: p.x * window.innerWidth, y: p.y * window.innerHeight };
  }

  setVisible(visible) {
    this.cursor.classList.toggle('visible', visible);
    if (!visible) this.setHover(null);
  }

  setHover(el) {
    const target = el?.closest(CLICKABLE) ?? null;
    if (target === this.hover) return;
    this.hover?.classList.remove('air-hover');
    this.hover = target;
    this.hover?.classList.add('air-hover');
  }

  setProgress(progress) {
    this.progress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
  }

  onPointer(p) {
    if (!this.isEnabled()) return this.setVisible(false);
    const { x, y } = this.toClient(p);
    this.pos = { x, y };
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
    this.cursor.classList.toggle('pinching', !!p.pinching);
    this.setVisible(true);
    if (!this.dragTarget) this.setHover(this.elementAt(x, y));
  }

  dispatch(target, type, { x, y }) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        pointerId: this.pointerId,
        pointerType: 'pen', // marks synthetic air events (handlers may want to know)
        isPrimary: true,
        buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : 0.5,
      }),
    );
  }

  onPinchStart(p) {
    if (!this.isEnabled()) return;
    const pos = this.toClient(p);
    const el = this.elementAt(pos.x, pos.y);
    if (!el) return;
    this.dragTarget = el;
    this.dispatch(el, 'pointerdown', pos);
    const scroller = el.closest('[data-air-drag]') ? null : scrollableAncestor(el);
    this.scroll = scroller ? { el: scroller, top: scroller.scrollTop, y: pos.y } : null;
  }

  onPinchMove(p) {
    if (!this.dragTarget) return;
    const pos = this.toClient(p);
    this.dispatch(this.dragTarget, 'pointermove', pos);
    // Hand up = content up, as with a finger. Amplified: the hand moves less than a finger.
    if (this.scroll) this.scroll.el.scrollTop = this.scroll.top - (pos.y - this.scroll.y) * 1.5;
  }

  onPinchEnd(p) {
    if (!this.dragTarget) return;
    const pos = this.toClient(p.x === undefined ? { x: this.pos.x / innerWidth, y: this.pos.y / innerHeight } : p);
    this.dispatch(this.dragTarget, p.cancelled ? 'pointercancel' : 'pointerup', pos);
    this.dragTarget = null;
    this.scroll = null;
  }

  /** Quick pinch: click what is under the cursor. Returns true if something was clicked. */
  onTap(p) {
    if (!this.isEnabled()) return false;
    const pos = this.toClient(p);
    this.ripple(pos);
    const el = this.elementAt(pos.x, pos.y);
    const target = el?.closest(CLICKABLE);
    if (!target || target.disabled) return false;
    if (target.matches('input[type="checkbox"], input[type="radio"]')) target.click();
    else if (target.matches('input, select')) target.focus();
    else target.click();
    return true;
  }

  ripple({ x, y }) {
    const r = document.createElement('div');
    r.className = 'air-ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    setTimeout(() => r.remove(), 500);
  }
}
