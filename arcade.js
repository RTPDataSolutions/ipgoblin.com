/**
 * arcade.js - puts each game's current leader on its arcade card, from the
 * high score tables at scores.ipgoblin.com.
 *
 * Decoration only: if the scoreboard cannot be reached the lines stay hidden.
 */
(() => {
  const lines = document.querySelectorAll('[data-leader]');
  if (!lines.length || !window.fetch || !window.AbortController) return;

  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const base = local ? 'http://127.0.0.1:8789' : 'https://scores.ipgoblin.com';
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 8000);

  fetch(`${base}/v1/boards?limit=1`, { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      for (const el of lines) {
        const game = data.games && data.games[el.dataset.leader];
        if (!game) continue;
        const top = game.top[0];
        if (top) {
          const name = document.createElement('strong');
          name.textContent = top.name;
          el.replaceChildren('Top goblin: ', name, ` with ${Number(top.score).toLocaleString('en-US')}`);
        } else {
          el.textContent = 'Nobody is on the table yet. The top spot is up for grabs.';
        }
        el.hidden = false;
      }
    })
    .catch(() => {});
})();
