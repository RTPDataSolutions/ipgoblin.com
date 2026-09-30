/**
 * input.js - keyboard, gamepad and touch, folded into one action model.
 *
 * The three sources are tracked separately and OR'd together, so a gamepad
 * poll can never clear a held key. `down()` is the live state and `pressed()`
 * is true only on the frame an action went down; call `endFrame()` once per
 * frame, after the game has read input.
 */

const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'pause', 'start'];

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  KeyX: 'attack', KeyJ: 'attack', KeyF: 'attack',
  KeyP: 'pause', Escape: 'pause',
  Enter: 'start', NumpadEnter: 'start',
};

// Standard gamepad mapping: 0=A 1=B 2=X 3=Y, 12-15 = dpad.
const PADMAP = {
  0: 'jump', 1: 'jump', 2: 'attack', 3: 'attack',
  9: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

const blank = () => ACTIONS.reduce((o, a) => { o[a] = false; return o; }, {});

/** Keys typed into the name form belong to it, not the goblin. */
function inForm(e) {
  const t = e.target;
  return !!(t && t.closest && t.closest('#entry'));
}

export class Input {
  constructor(root) {
    this.keys = blank();
    this.pad = blank();
    this.touch = blank();
    this.prev = blank();
    this.padPrev = blank();
    this.usedTouch = false;
    this.onMute = null;
    // Edge-triggered focus tracking. Checked once per frame in poll().
    this.hadFocus = typeof document !== 'undefined' && document.hasFocus();

    window.addEventListener('keydown', (e) => {
      if (inForm(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) {
        // A browser shortcut is starting (Cmd+L, Ctrl+T, Alt+Tab...). Focus is
        // usually about to leave the page, and the matching keyup for anything
        // already held will be delivered somewhere else. Let go of everything
        // now, or the goblin keeps running at a wall forever.
        this.releaseAll();
        return;
      }
      const a = KEYMAP[e.code];
      if (a) {
        if (!e.repeat) this.keys[a] = true;
        e.preventDefault();
      }
      if (e.code === 'KeyM' && !e.repeat && this.onMute) { this.onMute(); e.preventDefault(); }
    }, { passive: false });

    // Deliberately not filtered like keydown: a key pressed before the name
    // form took focus must still be let go of, or it stays held forever.
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) {
        this.keys[a] = false;
        if (!inForm(e)) e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    if (root) this.bindTouch(root);
  }

  releaseAll() {
    for (const a of ACTIONS) { this.keys[a] = false; this.pad[a] = false; this.touch[a] = false; }
    for (const el of document.querySelectorAll('.tbtn.is-down')) el.classList.remove('is-down');
  }

  bindTouch(root) {
    const press = (el, on) => {
      this.touch[el.dataset.key] = on;
      el.classList.toggle('is-down', on);
      if (on) this.usedTouch = true;
    };
    for (const el of root.querySelectorAll('[data-key]')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch { /* some pointers cannot be captured */ }
        press(el, true);
      });
      const off = (e) => { e.preventDefault(); press(el, false); };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', () => press(el, false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** A tap anywhere on the screen counts as "start" on menu screens. */
  bindScreenTap(el) {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.usedTouch = true;
      this.touch.start = true;
    });
    const off = () => { this.touch.start = false; };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  poll() {
    // The backstop for stuck keys. `blur` is not fired reliably for every way
    // focus can leave the page (browser chrome, devtools, another window), and
    // `visibilitychange` only fires when the tab is actually hidden. If the
    // document does not have focus then the player cannot be pressing anything
    // into it, so anything still held is stale.
    //
    // Edge-triggered rather than continuous: clearing every frame while
    // unfocused would also stomp input that tests and tooling inject directly.
    const focused = document.hasFocus();
    if (this.hadFocus && !focused) this.releaseAll();
    this.hadFocus = focused;

    for (const a of ACTIONS) this.pad[a] = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      for (const idx in PADMAP) {
        const b = p.buttons[idx];
        if (b && (b.pressed || b.value > 0.5)) this.pad[PADMAP[idx]] = true;
      }
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      if (ax < -0.4) this.pad.left = true;
      if (ax > 0.4) this.pad.right = true;
      if (ay < -0.5) this.pad.up = true;
      if (ay > 0.5) this.pad.down = true;
    }
  }

  down(a) { return this.keys[a] || this.pad[a] || this.touch[a]; }

  pressed(a) { return this.down(a) && !this.prev[a]; }

  /** Like `pressed`, but only for the gamepad. */
  padPressed(a) { return this.pad[a] && !this.padPrev[a]; }

  /** "Any of the confirm buttons" - used by the menu screens. */
  confirmPressed() {
    return this.pressed('start') || this.pressed('jump') || this.pressed('attack');
  }

  get axis() { return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0); }

  endFrame() {
    for (const a of ACTIONS) {
      this.prev[a] = this.down(a);
      this.padPrev[a] = this.pad[a];
    }
  }
}
