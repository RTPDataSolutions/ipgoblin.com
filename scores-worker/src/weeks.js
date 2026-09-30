/**
 * Weekly boards run from Monday 00:00 UTC to the next Monday and are named by
 * ISO week, e.g. 2026-W40. The ISO rule (a week belongs to the year its
 * Thursday falls in) is what keeps the days around New Year in one week.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function isoWeek(ms) {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY;
  const year = new Date(start + 3 * DAY).getUTCFullYear();
  // Week 1 is the week holding 4 January.
  const jan4 = Date.UTC(year, 0, 4);
  const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const n = Math.round((start - week1) / WEEK) + 1;
  return { id: `${year}-W${String(n).padStart(2, '0')}`, start, end: start + WEEK };
}

export function previousWeek(week) {
  return isoWeek(week.start - DAY);
}
