// main.js — boot. Same order as the feel prototype: build, first render,
// then the token/autosave hook, then restore the saved board.
import { $, DEBUG } from './util.js';
import { sfx } from './audio.js';
import * as solver from './solver.js';
import { S, UI, isSolvedBoard, checkDeadEnd } from './state.js';
import { buildBoard, cells, refresh } from './board.js';
import { makeKey } from './pad.js';
import { FX } from './particles.js';
import { deadEl, shell, doRewind } from './actions.js';
import { initInput, buildBoundPad, bindPress } from './input.js';
import { initToken, loadSaved, saveNow, Token, packState } from './token.js';
import { startPuzzle, initialId, initGame } from './game.js';
import { initDevMenu, openDev, closeDev } from './devmenu.js';
import { boardFor, allIds, entry, solutionOf } from './puzzles.js';
import { ALLOW, WORLD_TECHS, decodeCands } from './shared.js';
/* --- level0: Level 0 engine + campaign runner --- */
import { initLevel0, L0 } from './level0.js';
import { initCampaign, camp } from './campaign.js';
/* --- end level0 --- */
/* --- hints --- */
import { initHints, hintTap, enterCheck, exitCheck, hintState, hintOpts } from './hintui.js';
import * as hintlogic from './hintlogic.js';
/* --- end hints --- */
/* --- keys: keycap styles, colorways, switch sounds, Settings sheet --- */
import { initKeys } from './settingsui.js';
/* --- end keys --- */

const REWIND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 18 4 12l7-6z"/><path d="M20 18l-7-6 7-6z"/></svg>';

initInput();
buildBoard();
buildBoundPad();
startPuzzle(initialId(), false);    // first render (renderAll + refresh), no autosave hook yet

// Dead-end banner keycap (styled like the mod keys)
shell.rewindKey = makeKey('mod', `${REWIND_ICON}<span class="lbl">Rewind</span>`, deadEl);
shell.rewindKey.setAttribute('aria-label', 'Rewind to the last correct board');
bindPress(shell.rewindKey, () => { doRewind(); });

initToken();
initGame();
initDevMenu();
/* --- level0 --- */
initLevel0();     // after initToken: wraps the autosave refresh hook
/* --- end level0 --- */
/* --- hints --- */ initHints(); /* --- end hints --- */
/* --- keys --- */ initKeys(); /* --- end keys --- */

/* PWA: offline cache + install (needs https; skipped in sandboxed frames) */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
  });
}

loadSaved();
/* --- level0: after loadSaved; may start the runner / a Level 0 from the URL (#camp=0, #l0=w0) --- */
initCampaign();
/* --- end level0 --- */

/* Test hooks, only with ?debug=1 */
if (DEBUG) {
  window.__debug = {
    S, UI, sfx, FX, cells, solver, ALLOW, WORLD_TECHS, decodeCands, Token, packState,
    refresh, saveNow, isSolvedBoard, checkDeadEnd, openDev, closeDev,
    startPuzzle, boardFor, allIds, entry, solutionOf,
    /* --- level0 --- */ L0, camp, /* --- end level0 --- */
    /* --- hints --- */ hintTap, enterCheck, exitCheck, hintState, hintOpts, hintlogic /* --- end hints --- */
  };
}
