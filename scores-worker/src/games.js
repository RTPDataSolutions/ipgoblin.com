/**
 * The games with a high score table, and what a believable score looks like
 * for each. The checks are deliberately generous: turning away a real run is
 * worse than letting an odd one through, and moderation handles the rest.
 */

// GOBLIN HOARD's levels are finite and nothing respawns, so every score has a
// ceiling. These are the points available by the end of each level, counted
// from js/levels.js with every coin, gem and idol, a gem from every chest, a
// full clear bonus, and every enemy in the level killed in one unbroken chain.
// That came to 5858, 21039, 36729 and 45479; each is rounded up about 30% so
// a scoring path the count missed never rejects a real run. Raise these if
// the levels get richer.
const HOARD_CEILINGS = [7_600, 27_400, 47_800, 59_200];

export const GAMES = {
  'goblin-hoard': {
    title: 'GOBLIN HOARD',
    blurb: 'A 16-bit smash and grab',
    url: 'https://hoard.ipgoblin.com/',
    origin: 'https://hoard.ipgoblin.com',
    maxLevel: 4,
    canWin: true,
    implausible({ score, level, won, seconds }) {
      if (won && level !== 4) return 'won before the last level';
      if (score > HOARD_CEILINGS[level - 1]) return `over the level ${level} ceiling`;
      if (seconds < 10 * (level - 1)) return `reached level ${level} in ${seconds}s`;
      return null;
    },
  },

  // GHOUL TIME never ends and its ghouls respawn, so there is no ceiling, only
  // a pace. A strong level is worth 10-15k and takes a minute or more; these
  // allow several times that.
  'ghoul-time': {
    title: 'GHOUL TIME',
    blurb: 'Slime Chef',
    url: 'https://ghoultime.ipgoblin.com/',
    origin: 'https://ghoultime.ipgoblin.com',
    maxLevel: 999,
    canWin: false,
    implausible({ score, level, seconds }) {
      if (level > 1 + Math.floor(seconds / 12)) return `reached level ${level} in ${seconds}s`;
      if (score > 100_000 * level) return `over ${100_000 * level} by level ${level}`;
      if (score > 20_000 + 2_000 * seconds) return `over pace: ${score} in ${seconds}s`;
      return null;
    },
  },
};

export const GAME_IDS = Object.keys(GAMES);
