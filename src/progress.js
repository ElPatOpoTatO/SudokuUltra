// progress.js — wires the PROGRESSION layer (step 7) into the game: profile
// recording, the results card, the Master gate and end-of-world reward, Home,
// the keyboard map, unlocks, Fill all candidates, navigation events, DEV tools.
// Called once from main.js, last. See docs/progression.md.
import { $, div, DEBUG } from './util.js';
import { sfx } from './audio.js';
import { S } from './state.js';
import { toastEl } from './board.js';
import { makeKey } from './pad.js';
import { bindPress, bindHeaderBtn } from './input.js';
import { toastHooks, hideToast } from './actions.js';
import { gameHooks, startPuzzle } from './game.js';
import { has } from './puzzles.js';
import { campHooks, campCurrent, startCampaign, startLevel0Alone } from './campaign.js';
import { openSettings } from './settingsui.js';
import { openDev } from './devmenu.js';
import { startClock, emitSolved, getLastSolved, chargesFor, nav } from './events.js';
import {
  initProfile, getProfile, setProfile, getLastResult, recordSolved, levelInfo, levelIds, worldStats, totals,
  expertise, onProfile, setDevUnlockAll, WORLD_IDS, isUnlocked
} from './profile.js';
import { showResults, clearResults, RC, meter, setMeter } from './chargeui.js';
import { showScreen, hideScreens, currentScreen } from './screens.js';
import { buildHome, paintHome, showHome, lastPlayed, markSessionPlayed, forgetSessionPlayed, ICON } from './home.js';
import { initCampMap, openMap, openWorld, paintMap, paintWorld, mapWorld, MAP } from './campmap.js';
import { initUnlockUI, showReward, paintBadge } from './unlockui.js';
import { initFillNotes, fillAll, fillVisible, fillKey } from './fillnotes.js';
import { SPARKS } from './sparks.js';
import { devMaster, devGate } from './devprog.js';
import { WORLD_CHARGES } from './progcfg.js';
/* --- step10: effects pass (spatial transitions, sheet springs, last-seen deltas) --- */
import { morphReady, regSheet, settle, MORPH } from './morph.js';
import { seenSet, seenAll, reloadSeen, reseedSeen } from './uistate.js';
import { CFX } from './campmap.js';
import { FXLOG } from './home.js';
import { isClassic } from './settings.js';
/* --- end step10 --- */

let booted = false, directBoot = false;

/* ---- what the player last played (Continue) ----------------------------------- */
function recordLast() {
  if (!S.id || !(booted || directBoot)) return;    // the boot puzzle behind Home is not "played" yet
  const c = campCurrent();
  const ctx = c && c.id === S.id ? { id: S.id, world: c.world, k: c.k } : { id: S.id };
  if (!c && /^w\d-l0$/.test(S.id)) ctx.alone = true;
  try { localStorage.setItem('sudoku.lastctx', JSON.stringify(ctx)); localStorage.setItem('sudoku.last', S.id); } catch (e) {}
  if (booted) markSessionPlayed();
  /* step10: the map pulses the world key just played */ if (booted && ctx.world != null) seenSet('pulse', ctx.world);
}
function doContinue() {
  const lp = lastPlayed();
  hideScreens();
  if (!lp) return;
  if (sessionStarted) return;                            // the game underneath is the last puzzle
  sessionStarted = true;
  const c = lp.ctx;
  if (c && c.world != null && c.k != null) startCampaign(c.world, c.k, true);
  else if (/^w(\d)-l0$/.test(lp.id)) startLevel0Alone(+lp.id[1]);
  else if (has(lp.id)) startPuzzle(lp.id, true);   // also re-runs the start hooks (Free Mode session, clock)
  recordLast();
}
let sessionStarted = false;
/* --- step 9: a backup code was loaded (or undone). The stored state is new, so
   the puzzle underneath is stale: Continue must start the stored last puzzle.
   When the board is showing (the sheet was opened in a game), switch now. --- */
export function resumeAfterRestore(show) {
  sessionStarted = false;
  /* step10: a loaded (or undone) backup is not a gain: bars and counters start from it, static */
  reseedSeen();
  forgetSessionPlayed();
  if (show) doContinue();
  const c = currentScreen();
  if (c === 'home') paintHome(); else if (c === 'campaign') paintMap(); else if (c === 'world') paintWorld(mapWorld());
}
/* --- end step 9 --- */

/* ---- the results card and the end-of-world toast ------------------------------ */
function onToast() {
  const r = getLastResult(), d = getLastSolved();
  if (!r || !d || r.id !== S.id || d.id !== S.id || !r.level || r.k === 0 || !S.solved) { clearResults(); return; }
  showResults(r, d, `World ${r.world}`);
}
function worldToast(w) {
  clearResults();
  toastEl.classList.add('wtoast');
  const ak = $('againKey');
  const box = showReward(w, toastEl, ak);
  const mrow = div('rc-m', box);
  const ml = div('rc-ml', mrow); ml.textContent = `World ${w}`;
  const m = meter(mrow, { label: `World ${w} charges`, ticks: 13 });
  setMeter(m, worldStats(w).earned, WORLD_CHARGES);
  const row = document.createElement('div'); row.className = 'tkeys';
  toastEl.insertBefore(row, ak);
  const kb = makeKey('mod tk2', `<span class="lbl">Keyboard</span>`, row);
  kb.setAttribute('aria-label', 'See your keyboard');
  row.appendChild(ak);
  bindPress(kb, () => { sfx.mod(); openMap(1); });
}

/* ---- navigation --------------------------------------------------------------- */
function go(to) {
  if (to === 'home') showHome(currentScreen() ? -1 : 0);
  else if (to === 'campaign') openMap(currentScreen() === 'home' ? 1 : 0);
  else if (to === 'settings') openSettings();
  else if (to === 'free') hideScreens();              // Free Mode screens (src/freemode.js) take over
}
/* ---- the game header's one back control ---------------------------------------
   Free Mode puzzle (Quick Play / Daily) → the Free Mode screen; campaign runner
   or a world's Level 0 → that world's level list; anything else → Home. */
let homeBtn = null;
function backTarget() {
  if (S.kind === 'quick' || S.kind === 'daily') return { to: 'free', label: 'Back to Free Mode' };
  const c = campCurrent();
  const w = c ? c.world : (S.mode === 'l0' || S.mode === 'l0demo') && typeof S.world === 'number' ? S.world : null;
  if (w != null && WORLD_IDS.includes(w)) return { to: 'world', world: w, label: `Back to World ${w}` };
  return { to: 'home', label: 'Home' };
}
function syncBack() {
  if (!homeBtn) return;
  const t = backTarget();
  if (homeBtn.dataset.to === t.to && homeBtn.getAttribute('aria-label') === t.label) return;
  homeBtn.dataset.to = t.to;
  homeBtn.setAttribute('aria-label', t.label);
  homeBtn.title = t.label;
  homeBtn.innerHTML = t.to === 'home' ? ICON.home : ICON.back;
}
function goBack() {
  const t = backTarget();
  if (t.to === 'free') nav('free');
  else if (t.to === 'world') openWorld(t.world, 0);
  else showHome(0);
}
function playLevel(w, k) {
  hideScreens();
  sessionStarted = true;
  startCampaign(w, k, false);
}

/* ---- init --------------------------------------------------------------------- */
export function initProgress() {
  initProfile();
  startClock(S.id);
  gameHooks.start.push(id => { startClock(id); clearResults(); });
  const label = gameHooks.label;
  gameHooks.label = () => { recordLast(); syncBack(); return label ? label() : null; };
  const after = toastHooks.after;
  toastHooks.after = () => { if (after) after(); onToast(); };
  campHooks.blocked = w => openWorld(w, 1, { blocked: true });
  campHooks.worldToast = worldToast;

  buildHome({
    onContinue: doContinue,
    onCampaign: () => openMap(1),
    onFree: () => nav('free'),
    onSettings: () => nav('settings'),
    onDevMenu: () => openDev()
  });
  initCampMap({ home: () => showHome(-1), play: playLevel,
    /* step10: what the game screen collapses into on the map / a level list */
    gameWorld: () => { const c = campCurrent(); if (c) return c.world; const t = backTarget(); return t.to === 'world' ? t.world : null; },
    gameLevel: () => { const c = campCurrent(); if (c) return `${c.world}.${c.k}`; const t = backTarget(); return t.to === 'world' ? `${t.world}.0` : null; }
  });
  initUnlockUI();
  initFillNotes();

  // the in-game way back Home
  const hdr = document.querySelector('.hdr');
  const hb = div('hbtn', null); hb.id = 'homeBtn';
  hb.setAttribute('role', 'button'); hb.setAttribute('aria-label', 'Home'); hb.innerHTML = ICON.home;
  hdr.insertBefore(hb, hdr.firstChild);
  homeBtn = hb;
  bindHeaderBtn(hb, () => { sfx.mod(); goBack(); });
  syncBack();

  document.addEventListener('sudoku:nav', e => { const to = e.detail && e.detail.to; if (to) go(to); });
  onProfile(() => { paintBadge(); const c = currentScreen(); if (c === 'home') paintHome(); else if (c === 'campaign') paintMap(); else if (c === 'world') paintWorld(mapWorld()); });

  // launch: Home, unless the URL opens a puzzle / the runner / a Level 0 (#p= #camp= #l0=)
  const direct = directBoot = /[#&](p|camp|l0)=/.test(location.hash);
  recordLast();
  if (direct) sessionStarted = true;
  else showScreen('home', null, 0);
  booted = true;
  /* --- step10: spatial transitions from now on; sheets and the solved toast spring from their source --- */
  morphReady(true);
  const toastSrc = () => { const d = getLastSolved(); const i = d && d.id === S.id && d.cell >= 0 ? d.cell : S.selected; return i >= 0 ? document.querySelector(`.cell[data-i="${i}"]`) : null; };
  regSheet(toastEl, { source: toastSrc, skip: isClassic });
  for (const id of ['setSheet', 'sheet', 'devSheet']) regSheet($(id), { skip: isClassic });
  /* --- end step10 --- */
  if (!direct && /[#&]free\b/.test(location.hash)) nav('free');    // #free: Free Mode over Home

  if (DEBUG) {
    window.__debug = window.__debug || {};
    window.__debug.prog = {
      getProfile, setProfile, recordSolved, emitSolved, chargesFor, nav, worldStats, totals, expertise, levelIds, levelInfo,
      isUnlocked, setDevUnlockAll, RC, MAP, SPARKS, fillAll, fillVisible, fillKey, openMap, openWorld, showHome, hideScreens,
      screen: currentScreen, lastResult: getLastResult, lastSolved: getLastSolved, devMaster, devGate,
      hideToast, backTarget,
      /* step10 */ settle, MORPH, seen: seenAll, reloadSeen, CFX, FXLOG
    };
  }
}
