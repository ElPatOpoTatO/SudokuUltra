// daily.js — Daily Puzzle logic (no DOM): today's puzzle, the week strip, the
// streak. Same puzzle for everyone on a local calendar date, no server.
//
// Two numbers per date:
//   day   = days since DAILY_EPOCH (Monday 2026-01-05), NOT wrapped. Streaks,
//           solved days and the week strip use it (day 400 is not day 0).
//   index = dailyIndex(date) from shared.js = day mod 400, the puzzle slot.
// Day 0 is a Monday, so (day mod 7) is the weekday, 0 = Monday.
//
// Streak = consecutive days whose daily was solved ON that day. Solving a
// past day marks it solved (week strip) but never touches the streak; a
// replay of a solved day changes nothing. Missing a day: the shown streak
// drops to 0, and the next solve starts again at 1.
import { DAILY_EPOCH, DAILY_COUNT, dailyIndex, dailyBand } from './shared.js';
import { daily } from './puzzles.js';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const EPOCH_UTC = Date.UTC(DAILY_EPOCH[0], DAILY_EPOCH[1] - 1, DAILY_EPOCH[2]);
const mod = (a, n) => ((a % n) + n) % n;

/** Day number of a local calendar date (same arithmetic as shared.dailyIndex, unwrapped). */
export function dayNumber(date = new Date()) {
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - EPOCH_UTC) / 864e5);
}
/** Local Date (noon) of a day number. */
export function dayDate(day) {
  const u = new Date(EPOCH_UTC + day * 864e5);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12);
}
export const indexOfDay = day => mod(day, DAILY_COUNT);
export const weekdayOf = day => mod(day, 7);

/** Everything about one day's daily. */
export function dayInfo(day) {
  const index = indexOfDay(day), item = daily[index % daily.length];
  return { day, index, id: item.id, band: item.band || dailyBand(index), weekday: WEEKDAYS[weekdayOf(day)] };
}
/** Today (local date). index always equals shared.dailyIndex(now). */
export function todayInfo(now = new Date()) {
  const info = dayInfo(dayNumber(now));
  info.index = dailyIndex(now);
  return info;
}
/** The latest day ≤ today whose puzzle slot is `index` (a daily opened without a session). */
export function dayForIndex(index, today) {
  return today - mod(indexOfDay(today) - index, DAILY_COUNT);
}
/** Monday..Sunday of the week holding `today`: [{day, weekday, solved, late, today, future}]. */
export function weekStrip(state, today) {
  const start = today - weekdayOf(today), out = [];
  for (let k = 0; k < 7; k++) {
    const day = start + k;
    out.push({
      day, weekday: WEEKDAYS[k], solved: state.daily.solved[day] != null, late: !!state.daily.late[day],
      today: day === today, future: day > today
    });
  }
  return out;
}

/** The streak as shown today: alive if the last streak solve was today or yesterday. */
export function currentStreak(state, today) {
  const d = state.daily;
  return d.lastDay >= today - 1 && d.lastDay <= today ? d.streak : 0;
}

/** Record a daily solve (mutates state). countsToday: this solve is of the
    day's own puzzle on that day. Returns { first, streakUp, streak }. */
export function recordDailySolve(state, day, ms, countsToday) {
  const d = state.daily, first = d.solved[day] == null;
  let streakUp = false;
  if (first) {
    d.solved[day] = Math.max(0, Math.round(ms || 0));
    if (!countsToday) d.late[day] = 1;
    else {
      if (d.lastDay === day - 1) d.streak += 1;
      else if (d.lastDay !== day) d.streak = 1;
      d.lastDay = day;
      streakUp = true;
    }
  }
  return { first, streakUp, streak: d.streak };
}

/** Milliseconds until the next local midnight (next daily). */
export function msToNextDaily(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}
