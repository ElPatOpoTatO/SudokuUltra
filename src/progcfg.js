// progcfg.js — every PROGRESSION tuning number in one place (step 7).
// See docs/progression.md. Edit here; nothing else hard-codes these.

/* ---- power charges (⚡) ---------------------------------------------------- */
export const CHARGES_PER_LEVEL = 3;   // 1 solved · 2 no paid hints · 3 few mistakes
export const MISTAKE_LIMIT = 1;       // mistakes <= this earns the 3rd charge (a dead-end rewind counts 1)
export const LEVELS_PER_WORLD = 14;   // Level 0 + Spot it 1-6 + Use it 1-6 + Master
export const CHARGED_LEVELS = 13;     // Level 0 gives no charges
export const WORLD_CHARGES = CHARGED_LEVELS * CHARGES_PER_LEVEL;   // 39, Master included

/* ---- gates ------------------------------------------------------------------ */
export const MASTER_GATE = 24;        // of the 36 charges from a world's Spot it + Use it levels

/* ---- the keyboard map ------------------------------------------------------- */
export const SOCKETS = 16;            // planned worlds (keycaps); only the ones with content are playable
export const WORLD_INFO = [
  { name: 'Full house', short: 'Full house' },
  { name: 'Hidden singles', short: 'Hidden' },
  { name: 'Naked single', short: 'Naked' },
  { name: 'Pointing & claiming', short: 'Pointing' },
  { name: 'Pairs', short: 'Pairs' }
];

/* ---- unlocks: what mastering a world adds to Settings ------------------------
   kind: 'style' | 'layout' | 'preset' (ids from settings.js STYLES / colorways.js).
   FREE items are available from the start. Edit this table to move rewards. */
export const FREE_ITEMS = { style: ['sa'], layout: ['plain'], preset: ['retro'] };
export const UNLOCKS = [
  { world: 0, items: [{ kind: 'preset', id: 'ink' }] },
  { world: 1, items: [{ kind: 'style', id: 'cherry' }] },
  { world: 2, items: [{ kind: 'layout', id: 'checker' }, { kind: 'preset', id: 'mint' }] },
  { world: 3, items: [{ kind: 'style', id: 'lp' }, { kind: 'preset', id: 'rose' }] },
  { world: 4, items: [{ kind: 'preset', id: 'ocean' }, { kind: 'preset', id: 'forest' }] }
];

/* ---- expertise ---------------------------------------------------------------
   Tier = the highest entry whose `world` is mastered (Novice needs none).
   Inner level 1-10 rises with CLEAN solves (3 charges): each adds
   points = world + 1 (Free Mode: the band's world, gentle 1 … tricky 4).
   Every `perInner` points = +1 inner level. Never drops; a new tier starts at 1. */
export const TIERS = [
  { tier: 1, name: 'Novice', world: -1, perInner: 6 },
  { tier: 2, name: 'Solver', world: 3, perInner: 10 }
  // planned: 3 … 5
];
export const TIERS_PLANNED = 5;
export const INNER_MAX = 10;
export const BAND_WORLD = { gentle: 1, easy: 2, medium: 3, tricky: 4 };
