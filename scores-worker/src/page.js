/**
 * The public hall of fame at scores.ipgoblin.com: every table, server-rendered,
 * no script. Names are already restricted to [A-Z0-9 ._!?-], and everything is
 * escaped anyway.
 */

import { GAMES } from './games.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (n) => Number(n).toLocaleString('en-US');

function progress(game, e) {
  if (e.won) return '<span class="won" title="Beat the Root Daemon">&#9733; won</span>';
  return GAMES[game].canWin ? `level ${e.level}` : `lv ${e.level}`;
}

function table(game, t) {
  if (!t.top.length) {
    return `<p class="empty">Nobody yet. The top spot is up for grabs.</p>`;
  }
  const body = t.top.map((e) => `
      <tr${e.rank === 1 ? ' class="first"' : ''}>
        <td class="rank">${e.rank === 1 ? '&#128081;' : e.rank}</td>
        <td class="name">${esc(e.name)}</td>
        <td class="score">${num(e.score)}</td>
        <td class="prog">${progress(game, e)}</td>
      </tr>`).join('');
  return `
    <table class="board">
      <caption class="sr">${esc(GAMES[game].title)} high scores</caption>
      <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Score</th><th scope="col">Reached</th></tr></thead>
      <tbody>${body}
      </tbody>
    </table>`;
}

/** What it takes to get on the table. */
function cutoff(t) {
  const open = t.size - t.top.length;
  if (t.cutoff > 0) return `To get on, beat <strong>${num(t.cutoff)}</strong>.`;
  if (open === t.size) return 'Any score gets on.';
  return `${open} ${open === 1 ? 'place' : 'places'} left, so any score gets on.`;
}

function card(game, t) {
  const g = GAMES[game];
  return `
  <section class="game" aria-labelledby="h-${game}">
    <header class="game-head">
      <h2 id="h-${game}">${esc(g.title)}</h2>
      <p class="blurb">${esc(g.blurb)}</p>
    </header>
    ${table(game, t)}
    <p class="cutoff">${cutoff(t)}</p>
    <a class="play" href="${esc(g.url)}">Play ${esc(g.title)} &rarr;</a>
  </section>`;
}

export function renderPage(tables) {
  const cards = Object.entries(tables).map(([game, t]) => card(game, t)).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>High scores &mdash; the goblin arcade</title>
<meta name="description" content="The top ten runs in GOBLIN HOARD and GHOUL TIME, the goblin arcade at ipgoblin.com.">
<meta name="theme-color" content="#0d1408">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%230d1408'/%3E%3Cpath d='M3 5h10v6H3z' fill='%238ede4f'/%3E%3Cpath d='M5 7h2v2H5zm4 0h2v2H9z' fill='%23d8382f'/%3E%3C/svg%3E">
<style>
  :root { --bg:#0d1408; --panel:rgba(16,28,10,.92); --slime:#7dff3c; --gold:#ffc63c; --ink:#e7ffd8; --muted:#9bbd83; --border:rgba(125,255,60,.28); }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; padding:40px 16px 56px; color:var(--ink);
    font-family:ui-monospace,"SFMono-Regular","Courier New",monospace;
    background:radial-gradient(circle at 20% 0%,#26401356 0%,transparent 55%),linear-gradient(180deg,#0d1408 0%,#16240d 100%);
    background-attachment:fixed; }
  a { color:var(--slime); }
  .wrap { max-width:960px; margin:0 auto; }
  .kicker { margin:0; font-size:.8rem; color:var(--muted); letter-spacing:.06em; }
  h1 { margin:.2em 0 .1em; font-size:clamp(2rem,7vw,3.4rem); letter-spacing:.12em; color:var(--gold);
    text-shadow:0 0 18px rgba(255,198,60,.35); }
  .sub { margin:0 0 28px; color:var(--muted); font-size:.9rem; line-height:1.6; }
  .games { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:18px; }
  .game { display:flex; flex-direction:column; padding:20px; border:1px solid var(--border); border-radius:14px; background:var(--panel); }
  .game-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  h2 { margin:0; font-size:1.25rem; letter-spacing:.1em; color:var(--gold); }
  .blurb { margin:0; font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
  .board { width:100%; border-collapse:collapse; font-size:.9rem; }
  .board th { text-align:left; font-weight:normal; font-size:.68rem; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); padding:0 6px 6px; border-bottom:1px solid var(--border); }
  .board td { padding:6px; border-bottom:1px solid rgba(125,255,60,.08); }
  .board .rank { width:2.4em; color:var(--muted); text-align:right; }
  .board .name { letter-spacing:.06em; word-break:break-all; }
  .board .score, .board th:nth-child(3) { text-align:right; color:var(--gold); font-variant-numeric:tabular-nums; }
  .board .prog, .board th:nth-child(4) { text-align:right; color:var(--muted); font-size:.75rem; white-space:nowrap; }
  .board tr.first .name { color:var(--gold); font-weight:700; }
  .won { color:var(--gold); }
  .empty { margin:0; padding:14px; border:1px dashed var(--border); border-radius:10px; color:var(--muted); font-size:.85rem; }
  .cutoff { margin:14px 0 0; font-size:.82rem; color:var(--muted); }
  .cutoff strong { color:var(--gold); }
  .play { align-self:flex-start; margin-top:auto; padding:9px 16px; border:1px solid var(--slime); border-radius:999px;
    text-decoration:none; font-weight:700; letter-spacing:.04em; }
  .cutoff + .play { margin-top:18px; }
  .play:hover, .play:focus-visible { background:var(--slime); color:#0d1408; outline:none; }
  footer { margin-top:32px; font-size:.78rem; line-height:1.7; color:var(--muted); }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
</style>
</head>
<body>
<main class="wrap">
  <p class="kicker"><a href="https://ipgoblin.com/#arcade">ipgoblin.com</a> / the goblin arcade</p>
  <h1>HIGH SCORES</h1>
  <p class="sub">The top ten in each game. Nothing is ever reset: a name stays on the table until ten
    better runs push it off.</p>
  <div class="games">${cards}
  </div>
  <footer>
    <p>One line per player: your best run. Names and scores are all the goblins keep &mdash;
      no accounts, no cookies. The JSON behind this page is at <a href="/v1/boards?limit=10">/v1/boards</a>.</p>
    <p><a href="https://github.com/RTPDataSolutions/ipgoblin.com">Source on GitHub</a></p>
  </footer>
</main>
</body>
</html>
`;
}
