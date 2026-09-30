/**
 * entry.js - the "carve your name" form shown when a run ends.
 *
 * A real form rather than text entry drawn on the canvas, so phones get their
 * keyboard, screen readers get a label, and IMEs and autocorrect just work.
 */

import { cleanName, NAME_MAX } from './scores.js';

export class NameEntry {
  constructor(stage) {
    this.stage = stage;
    this.form = document.getElementById('entry');
    this.title = document.getElementById('entry-title');
    this.scoreEl = document.getElementById('entry-score');
    this.input = document.getElementById('entry-name');
    this.postBtn = document.getElementById('entry-post');
    this.skipBtn = document.getElementById('entry-skip');
    this.msg = document.getElementById('entry-msg');
    this.onPost = null;
    this.onSkip = null;
    this.busy = false;
    this.shownAt = 0;

    this.input.maxLength = NAME_MAX;
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.post(); });
    this.skipBtn.addEventListener('click', () => this.skip());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.skip(); }
      // An Enter still held from before the form opened is not a decision.
      if (e.key === 'Enter' && (e.repeat || performance.now() - this.shownAt < 300)) e.preventDefault();
    });
    this.input.addEventListener('input', () => {
      const v = this.input.value;
      const clean = v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
        .replace(/[^A-Z0-9 ._!?-]/g, '').slice(0, NAME_MAX);
      if (clean !== v) this.input.value = clean;
      this.say('');
    });
  }

  get open() { return !this.form.hidden; }

  show({ title, score, name }) {
    this.title.textContent = title;
    this.scoreEl.textContent = score.toLocaleString('en-US');
    this.input.value = name;
    this.say('');
    this.setBusy(false);
    this.form.hidden = false;
    this.stage.classList.add('entry-open');
    this.shownAt = performance.now();
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  hide() {
    this.form.hidden = true;
    this.stage.classList.remove('entry-open');
    this.input.blur();
  }

  say(text, error = false) {
    this.msg.textContent = text;
    this.msg.classList.toggle('is-error', error);
  }

  setBusy(on) {
    this.busy = on;
    this.input.disabled = on;
    this.postBtn.disabled = on;
    this.skipBtn.disabled = on;
    if (!on && this.open) this.input.focus({ preventScroll: true });
  }

  post() {
    if (this.busy) return;
    const name = cleanName(this.input.value);
    if (!/[A-Z0-9]/.test(name)) {
      this.say('TYPE A NAME FIRST', true);
      this.input.focus({ preventScroll: true });
      return;
    }
    this.input.value = name;
    this.onPost?.(name);
  }

  skip() {
    if (!this.busy) this.onSkip?.();
  }
}
