/**
 * Names on the high score table: what is allowed, and what the goblins refuse
 * to write down.
 *
 * Names are upper case, up to ten characters, from a set both games can draw
 * (GOBLIN HOARD renders text with its own 5x7 bitmap font).
 */

export const NAME_MAX = 10;

export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .slice(0, 64)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ._!?-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

// The word lists are rot13 so the source does not read as a list of slurs.
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 84) % 26) + 97));
const words = (s) => rot13(s).toUpperCase().split(' ');

// Rude wherever they appear in a name.
const ANYWHERE = words(
  'shpx spx fuvg phag avtt sntt ergneq juber fyhg ovgpu gjng jnaxre chffl cravf intvan qvyqb ' +
  'cbea wvmm anmv uvgyre xxx qvpxurnq nffubyr nefrubyr jrgonpx genaal zbyrfg crqbcuvy ' +
  'cnrqbcuvy gvggvrf',
);

// Rude only as a whole word, because they hide inside innocent ones
// (CLASSIC, GRAPE, THERAPIST, PEACOCK, DICKENS, ANALYST, TITAN, SWANK, TORPEDO).
const WHOLE = new Set(words(
  'nff nefr phz gvg gvgf frk encr encvfg nany pbpx pbpxf qvpx qvpxf snt sntf fcvp puvax xvxr ' +
  'pbba tbbx qlxr obbo obbof avtn urvy jnax crqb crqbf cnrqb',
));

const RAW = ['1488'];

const LEET = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 7: 'T', 8: 'B', 9: 'G', '!': 'I' };
const squash = (s) => [...s].map((c) => LEET[c] ?? c).join('').replace(/[^A-Z]/g, '');
const collapse = (s) => s.replace(/(.)\1+/g, '$1');

/** `name` must already be cleaned. */
export function isRude(name) {
  if (RAW.some((w) => name.includes(w))) return true;

  const all = squash(name);
  const flat = collapse(all);
  for (const w of ANYWHERE) {
    if (all.includes(w)) return true;
    // FUUUCK -> FUCK. Only for words with no doubled letter of their own,
    // since collapsing those would shrink them into innocent substrings.
    if (!/(.)\1/.test(w) && flat.includes(w)) return true;
  }

  const tokens = name.split(/[^A-Z0-9]+/).map(squash).filter(Boolean);
  return [all, flat, ...tokens, ...tokens.map(collapse)].some((t) => WHOLE.has(t));
}
