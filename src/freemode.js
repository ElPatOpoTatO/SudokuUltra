// freemode.js — the FREE MODE screen (Daily card + Quick Play bands + the
// Free Mode feedback setting) and the Free Mode session around a puzzle:
// play clock, hints limited to learned techniques, feedback rule, solve
// bookkeeping (streak, played/solved ids, best times), the solved toast.
// Logic lives in daily.js / quickplay.js, data in fmstore.js, mastery in
// fm-progress.js. See docs/freemode.md.
//
// Navigation contract (shared with the Home screen of step 7):
//   'sudoku:nav' {to:'free'}  → openFreeMode()
//   back                      → dispatch 'sudoku:nav' {to:'home'}
//   'sudoku:nav' {to:<other>} → this screen closes (with no Home listener the
//                               game shows again: the fallback)
//   'sudoku:solved' {id, mode, world, mistakes, paidHints, silentWrong, ms, …}
//                             → bookkeeping. The event is emitted once per solve by
//                               step 7 (events.js emitSolved); its ms comes from OUR
//                               clock through events.clockHooks.ms while we own the
//                               puzzle. Mastery: fm-progress.js (profile.js).
//   The game header's back control (progress.js) sends Free Mode puzzles back here.
import { $, div, reducedMotion, haptic, DEBUG } from './util.js';
import { sfx } from './audio.js';
import { S, UI, ruleHooks } from './state.js';
import { cells, refresh, toastEl, toastMsg, hooks } from './board.js';
import { makeKey } from './pad.js';
import { release, toastHooks } from './actions.js';
import { cancelAllPresses } from './input.js';
import { startPuzzle, gameHooks, updatePid } from './game.js';
import { entry } from './puzzles.js';
import { hintOpts } from './hintui.js';
import { BANDS, dailyIndex } from './shared.js';
import { getFreeModeState, setFreeModeState, updateFreeModeState, FEEDBACK } from './fmstore.js';
import { masteredWorlds, learnedTechniques } from './fm-progress.js';
import { todayInfo, dayInfo, weekStrip, currentStreak, recordDailySolve, dayForIndex, dayNumber, msToNextDaily } from './daily.js';
import { BAND_INFO, bandOffered, bandOpen, pickPuzzle, bandStats, fmtTime } from './quickplay.js';
/* --- merge (step7 + step8) --- */
import { clockHooks } from './events.js';
import { currentScreen, onScreen } from './screens.js';
import { onProfile } from './profile.js';
/* --- end merge --- */

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.2"/><path class="shackle" d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path class="fo" d="M12 2.6c.5 3-1.2 4.6-2.8 6.3C7.6 10.6 6 12.4 6 15.2 6 18.9 8.7 21.4 12 21.4s6-2.5 6-6.2c0-2.3-1-4.1-2.1-5.4-.2 1.5-.9 2.6-2 3.1.6-3.7-.6-6.6-1.9-8.3z"/><path class="fi" d="M12 13.2c.2 1.5-.6 2.2-1.3 3-.5.5-.8 1-.8 1.8 0 1.2.9 2.1 2.1 2.1s2.1-.9 2.1-2.2c0-1-.5-1.8-1-2.3-.1.6-.4.9-.8 1.1.2-1.4-.1-2.6-.3-3.5z"/></svg>'
};
const FB_INFO = {
  instant: { name: 'Instant truth', note: 'A wrong digit turns red the moment you place it.' },
  conflicts: { name: 'Conflicts only', note: 'Only digits that clash with another digit are flagged, like the campaign.' },
  nothing: { name: 'Nothing', note: 'No red at all. Finding your own mistakes is part of the puzzle.' }
};
const FREE_KINDS = new Set(['quick', 'daily']);
const isFreeKind = k => FREE_KINDS.has(k);
const now = () => new Date();
const today = () => dayNumber(now());

/* =========================================================================
   SESSION: the Free Mode puzzle being played
   ========================================================================= */
let session = null;        // { id, kind, band, day, openedDay, acc, since }
let pendingOpen = null;    // what the screen asked for, consumed by the start hook
let lastSolve = null;      // the latest Free Mode solve, for the toast
let fbMode = 'conflicts';  // cached feedback setting
let hintsSet = false;      // we set hintOpts.unlocked (so we may clear it)

function clockRunning() { return !!(session && session.since); }
function elapsed() { return session ? session.acc + (session.since ? Date.now() - session.since : 0) : 0; }
function clockPause(persist = true) {
  if (!session) return;
  if (session.since) { session.acc += Date.now() - session.since; session.since = 0; }
  if (persist && session.live && !S.solved && !session.done) updateFreeModeState(s => { s.clock[session.id] = Math.round(session.acc); });
}
function clockResume() {
  if (!session || session.since || session.done || S.solved || document.hidden || isOpen() || currentScreen()) return;
  session.since = Date.now();
  session.live = true;      // the puzzle has really been on screen (not just booted behind Home)
}

function onPuzzleStart(id) {
  if (session) clockPause();
  killEmbers();
  const e = entry(id);
  if (!e || !isFreeKind(e.kind)) {
    session = null;
    if (hintsSet) { hintOpts.unlocked = null; hintsSet = false; }
  } else {
    const st = getFreeModeState(), t = today();
    const p = pendingOpen && pendingOpen.id === id ? pendingOpen : null;
    session = { id, kind: e.kind, band: e.kind === 'quick' ? e.band : e.item.band, acc: 0, since: 0, done: false };
    if (e.kind === 'daily') {
      session.day = p ? p.day : dayForIndex(e.index, t);
      session.openedDay = p ? p.openedDay : t;
    }
    session.acc = p && p.fresh ? 0 : (st.clock[id] || 0);
    session.live = !!(p || st.clock[id] != null);
    hintOpts.unlocked = learnedTechniques(); hintsSet = true;
  }
  pendingOpen = null;
  // the clock starts once the board is showing (after startPuzzle finishes)
  setTimeout(clockResume, 0);
}

/* sudoku:solved — emitted once per solve by step 7 (actions.js → events.js). */
function onSolved(ev) {
  const d = (ev && ev.detail) || {};
  if (!session || d.id !== session.id || session.done) return;
  clockPause(false);
  session.done = true;
  const ms = typeof d.ms === 'number' && isFinite(d.ms) ? d.ms : Math.round(elapsed());
  const t = today();
  const res = { id: session.id, kind: session.kind, band: session.band, ms, mistakes: d.mistakes | 0, cell: lastPlacedCell() };
  updateFreeModeState(s => {
    delete s.clock[session.id];
    if (session.kind === 'quick') {
      const b = session.band;
      res.newBest = s.best[b] == null || ms < s.best[b];
      res.prevBest = s.best[b] ?? null;
      if (res.newBest) s.best[b] = ms;
      if (!s.solved[b].includes(session.id)) s.solved[b].push(session.id);
      if (s.current[b] === session.id) delete s.current[b];
    } else {
      const day = session.day;
      // counts for the streak: the day's own puzzle, opened on that day, solved
      // today (or just after midnight when it was opened the evening before)
      const counts = session.openedDay === day && (day === t || day === t - 1);
      Object.assign(res, recordDailySolve(s, day, ms, counts), { day, counts });
      res.firstMs = s.daily.solved[day];
    }
  });
  lastSolve = res;
}
/* The cell of the final placement: where the last undo snapshot differs. */
function lastPlacedCell() {
  const snap = S.undo[S.undo.length - 1];
  if (snap) for (let i = 0; i < 81; i++) if (snap.v[i] !== S.values[i]) return i;
  return 40;
}

/* =========================================================================
   SCREEN
   ========================================================================= */
let fm, scroller, dTitle, dStreak, dStreakN, dStreakL, weekEl, dFoot, dStatus, dPlay, dNext, chToggle, warnEl, bandsEl, segEl, fbNote, backBtn;
const bandKeys = {};
let tick = 0, renderedDay = null, hideTimer = 0;

const isOpen = () => !!(fm && fm.classList.contains('show'));
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

/* Keycap press for a scrollable screen: the cap goes down and the switch
   sounds on pointerdown (as everywhere); the action runs on release, and a
   drag (scroll) cancels it. Enter / Space work too. */
function fmPress(k, action, opt = {}) {
  let p = null;
  k.tabIndex = 0;
  const up = (ok) => {
    if (!p) return;
    k.classList.remove('down');
    p = null;
    sfx.release();
    if (ok) action();
  };
  k.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    sfx.unlock();
    p = { x: e.clientX, y: e.clientY, id: e.pointerId };
    k.classList.add('down');
    (opt.sound || sfx.mod)();
    haptic(5);
  });
  k.addEventListener('pointermove', e => { if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { k.classList.remove('down'); p = null; } });
  k.addEventListener('pointerup', e => { if (p && e.pointerId === p.id) up(true); });
  k.addEventListener('pointercancel', () => { if (p) { k.classList.remove('down'); p = null; } });
  k.addEventListener('pointerleave', () => { if (p) { k.classList.remove('down'); p = null; } });
  k.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); k.classList.add('down'); (opt.sound || sfx.mod)(); p = { id: 'kb' }; }
  });
  k.addEventListener('keyup', e => { if ((e.key === 'Enter' || e.key === ' ') && p && p.id === 'kb') up(true); });
}

function build() {
  fm = el('div', 'fm', document.body);
  fm.id = 'fm';
  fm.style.display = 'none';
  fm.setAttribute('role', 'dialog'); fm.setAttribute('aria-label', 'Free Mode'); fm.setAttribute('aria-hidden', 'true');
  const inner = el('div', 'fm-in', fm);

  const top = el('div', 'fm-top', inner);
  backBtn = makeKey('mod fm-back', `${ICON.back}<span class="lbl">Home</span>`, top);
  backBtn.setAttribute('aria-label', 'Back to Home');
  fmPress(backBtn, goBack);
  el('h1', null, top, 'Free Mode');

  scroller = el('div', 'fm-scroll', inner);

  /* ---- Daily ---- */
  const dc = el('section', 'fm-card fm-daily', scroller);
  dc.setAttribute('aria-label', 'Daily puzzle');
  const dh = el('div', 'fm-dhead', dc);
  const dt = el('div', 'fm-dt', dh);
  el('div', 'fm-eyebrow', dt, 'Daily puzzle');
  dTitle = el('div', 'fm-dtitle', dt);
  dStreak = el('div', 'fm-streak', dh);
  dStreak.setAttribute('role', 'img');
  el('span', 'fm-flame', dStreak, ICON.flame);
  const sw = el('span', 'fm-sn', dStreak);
  dStreakN = el('b', null, sw);
  dStreakL = el('small', null, sw);
  weekEl = el('div', 'fm-week kp', dc);
  weekEl.setAttribute('aria-label', 'This week');
  dFoot = el('div', 'fm-dfoot', dc);
  dStatus = el('div', 'fm-dstatus', dFoot);
  dPlay = makeKey('fm-play', '', dFoot);
  fmPress(dPlay, () => openDaily(today()));
  dNext = el('div', 'fm-next', dc);

  /* ---- Quick Play ---- */
  const qc = el('section', 'fm-quick', scroller);
  qc.setAttribute('aria-label', 'Quick Play');
  const qh = el('div', 'fm-qhead', qc);
  el('h2', null, qh, 'Quick Play');
  const chl = el('label', 'fm-ch', qh);
  el('span', null, chl, 'Challenge me');
  chToggle = el('button', 'set-toggle', chl, '<i></i>');
  chToggle.type = 'button'; chToggle.setAttribute('role', 'switch'); chToggle.setAttribute('aria-label', 'Challenge me');
  chToggle.addEventListener('click', () => {
    const on = !getFreeModeState().challenge;
    updateFreeModeState(s => { s.challenge = on; });
    sfx.mod();
    renderQuick(true);
  });
  warnEl = el('p', 'fm-warn', qc, `${ICON.lock}<span>Bands past your mastered worlds are open. Hints only use techniques you've learned.</span>`);
  warnEl.setAttribute('role', 'note');
  bandsEl = el('div', 'fm-bands kp', qc);
  for (const b of BANDS) {
    const info = BAND_INFO[b];
    const k = makeKey('fm-band', `
      <span class="fm-bn">${info.name}</span>
      <span class="fm-bneeds">needs ${info.needs}</span>
      <span class="fm-bstat"></span>
      <span class="fm-block">${ICON.lock}<span>Master World ${info.world}</span></span>
      <i class="led"></i>`, bandsEl);
    k.dataset.band = b;
    bandKeys[b] = k;
    fmPress(k, () => openBand(b), { sound: () => (bandOpenNow(b) ? sfx.mod() : sfx.blocked()) });
  }

  /* ---- Feedback ---- */
  const fc = el('section', 'fm-fb', scroller);
  el('h3', null, fc, 'Free Mode feedback');
  segEl = el('div', 'fm-seg', fc);
  segEl.setAttribute('role', 'radiogroup'); segEl.setAttribute('aria-label', 'Free Mode feedback');
  el('div', 'thumb', segEl);
  for (const f of FEEDBACK) {
    const b = el('button', null, segEl, FB_INFO[f].name);
    b.type = 'button'; b.dataset.fb = f; b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { setFeedback(f); sfx.mod(); });
  }
  fbNote = el('p', 'fm-fbnote', fc);

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen() && !e.repeat) { e.preventDefault(); sfx.mod(); goBack(); } });
}

/* ---- render ---- */
function render() {
  renderDaily();
  renderQuick(false);
  renderFeedback();
}

function renderDaily() {
  const st = getFreeModeState(), t = today(), info = dayInfo(t);
  renderedDay = t;
  dTitle.textContent = `${info.weekday} · ${BAND_INFO[info.band].name}`;
  const streak = currentStreak(st, t);
  dStreak.classList.toggle('lit', streak > 0);
  dStreakN.textContent = String(streak);
  dStreakL.textContent = streak === 1 ? 'day streak' : 'day streak';
  dStreak.setAttribute('aria-label', `Streak: ${streak} day${streak === 1 ? '' : 's'}`);

  weekEl.textContent = '';
  for (const d of weekStrip(st, t)) {
    const date = new Date(now().getFullYear(), now().getMonth(), now().getDate() + (d.day - t));
    const k = makeKey('fm-day' + (d.solved ? (d.late ? ' late' : ' latched') : '') + (d.today ? ' today' : '') + (d.future ? ' future' : ''),
      `<span class="fm-wd">${d.weekday[0]}</span><span class="lg">${date.getDate()}</span>${d.solved ? `<span class="fm-ck">${ICON.check}</span>` : ''}<i class="led"></i>`, weekEl);
    k.dataset.day = String(d.day);
    k.setAttribute('aria-label', `${d.weekday} ${date.getDate()}${d.today ? ', today' : ''}${d.solved ? ', solved' : d.future ? ', not yet' : ''}`);
    if (d.future) { k.setAttribute('aria-disabled', 'true'); fmPress(k, () => {}, { sound: sfx.blocked }); }
    else fmPress(k, () => openDaily(d.day), { sound: sfx.mod });
  }

  const solvedMs = st.daily.solved[t];
  dFoot.classList.toggle('done', solvedMs != null);
  if (solvedMs != null) {
    dStatus.innerHTML = `<span class="fm-ok">${ICON.check}Solved</span><small>${fmtTime(solvedMs)}</small>`;
    dPlay.querySelector('.cap').innerHTML = `${ICON.replay}<span class="lbl">Replay</span>`;
    dPlay.setAttribute('aria-label', "Replay today's puzzle");
  } else {
    const inProgress = st.clock[info.id] != null;
    dStatus.innerHTML = `<span class="fm-dn">${inProgress ? 'In progress' : 'Same puzzle for everyone'}</span>${inProgress ? `<small>${fmtTime(st.clock[info.id])}</small>` : ''}`;
    dPlay.querySelector('.cap').innerHTML = `${ICON.play}<span class="lbl">${inProgress ? 'Resume' : 'Play'}</span>`;
    dPlay.setAttribute('aria-label', inProgress ? "Resume today's puzzle" : "Play today's puzzle");
  }
  renderCountdown();
}
function renderCountdown() {
  const ms = msToNextDaily(now()), h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  dNext.textContent = `Next daily in ${h ? `${h}h ${m}m` : `${Math.max(1, m)}m`}`;
}

const bandOpenNow = b => bandOpen(b, masteredWorlds(), getFreeModeState().challenge);
function renderQuick(animate) {
  const st = getFreeModeState(), mastered = masteredWorlds();
  chToggle.setAttribute('aria-checked', String(st.challenge));
  const anyLocked = BANDS.some(b => !bandOffered(b, mastered));
  warnEl.classList.toggle('show', st.challenge && anyLocked);
  for (const b of BANDS) {
    const k = bandKeys[b], offered = bandOffered(b, mastered), open = st.challenge || offered;
    const was = k.classList.contains('locked');
    k.classList.toggle('locked', !open);
    k.classList.toggle('beyond', open && !offered);
    const stats = bandStats(st, b), cur = st.current[b];
    const inProgress = open && cur && !st.solved[b].includes(cur);
    k.classList.toggle('latched', !!inProgress);
    k.querySelector('.fm-bstat').innerHTML = inProgress
      ? `<b>Resume</b>${st.clock[cur] ? ' · ' + fmtTime(st.clock[cur]) : ''}`
      : `<b>${stats.solved}</b> solved${stats.best != null ? ` · best <b>${fmtTime(stats.best)}</b>` : ''}`;
    k.setAttribute('aria-label', `${BAND_INFO[b].name}, needs ${BAND_INFO[b].needs}. ` +
      (open ? `${stats.solved} solved${stats.best != null ? ', best ' + fmtTime(stats.best) : ''}${inProgress ? ', in progress' : ''}` : `Locked: master World ${BAND_INFO[b].world}`));
    k.setAttribute('aria-disabled', String(!open));
    // the lock opens where it sits (Challenge me just switched on)
    if (animate && was && open && !reducedMotion()) {
      const sh = k.querySelector('.fm-block');
      sh.classList.remove('opening'); void sh.offsetWidth; sh.classList.add('opening');
    }
  }
}
function renderFeedback() {
  const f = getFreeModeState().feedback;
  const bs = [...segEl.querySelectorAll('button')];
  bs.forEach((b, i) => { const on = b.dataset.fb === f; b.setAttribute('aria-checked', String(on)); if (on) segEl.style.setProperty('--i', i); });
  fbNote.textContent = FB_INFO[f].note;
}
function setFeedback(f) {
  if (!FEEDBACK.includes(f)) return;
  updateFreeModeState(s => { s.feedback = f; });
  fbMode = f;
  renderFeedback();
  if (isFreeKind(S.kind)) refresh();
}

/* ---- open / close ---- */
function killEmbers() { document.querySelectorAll('.fm-embers').forEach(e => e.remove()); }
export function openFreeMode() {
  if (!fm) return;
  killEmbers();
  cancelAllPresses(); release();
  clockPause();
  render();
  UI.sheetOpen = true;              // the keyboard goes to this screen, not the board
  clearTimeout(hideTimer);
  fm.style.display = '';
  void fm.offsetWidth;              // start the entrance from the hidden state
  fm.classList.add('show');
  fm.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('fm-open');
  scroller.scrollTop = 0;
  clearInterval(tick);
  tick = setInterval(() => { if (today() !== renderedDay) render(); else renderCountdown(); }, 20e3);
}
export function closeFreeMode() {
  if (!isOpen()) return;
  fm.classList.remove('show');
  fm.setAttribute('aria-hidden', 'true');
  document.documentElement.classList.remove('fm-open');
  UI.sheetOpen = false;
  clearInterval(tick); tick = 0;
  const a = document.activeElement; if (a && fm.contains(a) && a.blur) a.blur();
  clockResume();
  // out of the layout once the exit has played (nothing hidden stays queryable)
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!isOpen()) fm.style.display = 'none'; }, 320);
}
function goBack() {
  document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'home' } }));
}

/* ---- starting puzzles ---- */
function openDaily(day) {
  const t = today();
  if (day > t) return;
  const info = dayInfo(day), st = getFreeModeState();
  const solved = st.daily.solved[day] != null;
  pendingOpen = { id: info.id, day, openedDay: t, fresh: solved };
  closeFreeMode();
  startPuzzle(info.id, !solved);    // a solved day replays from the givens
}
function openBand(b) {
  if (!bandOpenNow(b)) { nudgeLock(b); return; }
  const st = getFreeModeState(), cur = st.current[b];
  if (cur && !st.solved[b].includes(cur) && entry(cur)) {
    pendingOpen = { id: cur, fresh: false };
    closeFreeMode();
    startPuzzle(cur, true);
    return;
  }
  startNewQuick(b);
}
function startNewQuick(b) {
  let id = null;
  updateFreeModeState(s => { id = pickPuzzle(s, b); if (id) { s.current[b] = id; delete s.clock[id]; } });
  if (!id) return;
  pendingOpen = { id, fresh: true };
  closeFreeMode();
  startPuzzle(id, false);
}
function nudgeLock(b) {
  const lk = bandKeys[b].querySelector('.fm-block svg');
  if (!lk || reducedMotion()) return;
  lk.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-12deg)' }, { transform: 'rotate(9deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }],
    { duration: 320, easing: 'ease-out' });
}

/* =========================================================================
   GAME-SIDE: header back button, toast, streak ignite
   ========================================================================= */
let tStreak = null;

function toastAfter() {
  if (!tStreak) return;
  tStreak.classList.remove('on', 'lit');
  const r = lastSolve;
  if (!r || !session || r.id !== S.id || !S.solved) return;
  const title = $('toastTitle'), lbl = document.querySelector('#againKey .lbl');
  const mist = r.mistakes === 0 ? 'clean' : `${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'}`;
  if (r.kind === 'quick') {
    title.textContent = r.newBest && r.prevBest != null ? 'New best' : 'Solved';
    toastMsg.textContent = `${BAND_INFO[r.band].name} · ${fmtTime(r.ms)} · ${mist}`;
    lbl.textContent = 'Next puzzle';
  } else {
    const info = dayInfo(r.day);
    title.textContent = r.first ? 'Daily solved' : 'Solved again';
    toastMsg.textContent = `${info.weekday} · ${fmtTime(r.ms)}${!r.first && r.firstMs != null ? ` · first ${fmtTime(r.firstMs)}` : ` · ${mist}`}`;
    lbl.textContent = 'Free Mode';
    const st = getFreeModeState(), streak = currentStreak(st, today());
    tStreak.querySelector('b').textContent = String(streak);
    tStreak.querySelector('small').textContent = streak === 1 ? 'day streak' : 'day streak';
    tStreak.classList.add('on');
    if (r.streakUp && !r.ignited) { r.ignited = true; ignite(r.cell); }
    else if (streak > 0) tStreak.classList.add('lit');
  }
}

/* Embers rise from the cell that finished the daily and light the streak flame. */
function ignite(cellIdx) {
  const flame = tStreak.querySelector('.fm-flame');
  const light = () => {
    tStreak.classList.add('lit');
    igniteSfx();
    haptic([0, 10, 30, 14]);
    if (!reducedMotion()) flame.animate([{ transform: 'scale(.55)' }, { transform: 'scale(1.18)', offset: .55 }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.2,.9,.3,1)' });
    else flame.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 160 });
  };
  if (reducedMotion() || !cells[cellIdx]) { setTimeout(light, 200); return; }
  // wait for the toast to settle (its entrance moves it), then fly
  setTimeout(() => {
    const a = cells[cellIdx].el.getBoundingClientRect(), b = flame.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + b.height * .62;
    const layer = el('div', 'fm-embers', document.body);
    let first = true, left = 9;
    for (let k = 0; k < 9; k++) {
      const e = el('i', 'fm-ember', layer);
      const sx = ax + (Math.random() - .5) * a.width * .6, sy = ay + (Math.random() - .5) * a.height * .6;
      const dx = bx - sx, dy = by - sy, len = Math.hypot(dx, dy) || 1;
      const bow = (Math.random() < .5 ? -1 : 1) * (18 + Math.random() * 40);
      const cx = (sx + bx) / 2 - dy / len * bow, cy = (sy + by) / 2 + dx / len * bow - 30;
      const frames = [];
      for (let s = 0; s <= 8; s++) {
        const t = s / 8, u = 1 - t;
        const x = u * u * sx + 2 * u * t * cx + t * t * bx, y = u * u * sy + 2 * u * t * cy + t * t * by;
        frames.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(1.15 - .55 * t).toFixed(2)})`, opacity: t < .1 ? t * 10 : t > .9 ? (1 - t) * 10 : 1, offset: t });
      }
      const an = e.animate(frames, { duration: 520 + Math.random() * 180, delay: k * 34, easing: 'cubic-bezier(.45,0,.75,.9)', fill: 'both' });
      an.onfinish = () => {
        e.remove();
        if (first) { first = false; light(); }
        if (--left === 0) layer.remove();
      };
    }
  }, 380);
}
/* A soft "fwoomp": low noise swelling through an opening low-pass (±5% pitch). */
function igniteSfx() {
  const P = sfx.prims;
  if (!P || !P.ready()) return;
  try {
    const ctx = P.ctx, t = P.now(), p = P.pj();
    const src = ctx.createBufferSource(); src.buffer = P.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(180 * p, t); f.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.16); f.frequency.exponentialRampToValueAtTime(400 * p, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32 * P.jit(0.1), t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(f); f.connect(g); g.connect(P.master);
    src.start(t, Math.random() * 0.4); src.stop(t + 0.5);
    sfx.latch(0.05, 2);
  } catch (e) {}
}

/* =========================================================================
   INIT (main.js, after initCampaign so the toast / Next hooks chain behind it)
   ========================================================================= */
export function initFreeMode() {
  const st = getFreeModeState();
  fbMode = st.feedback;
  ruleHooks.feedback = () => (isFreeKind(S.kind) ? fbMode : 'conflicts');
  build();

  // (the game header's back control lives in progress.js: Free Mode puzzles → this screen)
  /* --- merge: the solved event's ms is our clock while we own the puzzle --- */
  clockHooks.ms = id => (session && session.id === id ? elapsed() : null);
  // step 7's screens (Home, map, world list) cover the board: the clock pauses
  onScreen(name => { if (name) clockPause(); else setTimeout(clockResume, 0); });
  // mastery comes from the profile: re-render the bands, refresh the hint set
  onProfile(() => {
    if (session) hintOpts.unlocked = learnedTechniques();
    if (isOpen()) renderQuick(false);
  });
  /* --- end merge --- */

  // toast: the streak row (only shown after a daily)
  tStreak = div('fm-tstreak', null);
  tStreak.innerHTML = `<span class="fm-flame">${ICON.flame}</span><b>0</b><small>day streak</small>`;
  toastEl.insertBefore(tStreak, $('againKey'));

  gameHooks.start.push(onPuzzleStart);
  // a solved Free Mode board brought back to play (restart / undo): the clock
  // runs again; from the givens it starts over, otherwise it continues
  const prevRefresh = hooks.afterRefresh;
  hooks.afterRefresh = () => {
    if (prevRefresh) prevRefresh();
    if (!session) return;
    if (S.solved) { if (session.since && !session.done) clockPause(false); return; }   // a restored solved board
    if (session.done) {
      let fresh = true;
      for (let i = 0; i < 81; i++) if (S.values[i] && !S.given[i]) { fresh = false; break; }
      session.done = false;
      if (fresh) session.acc = 0;
    }
    if (!session.since) clockResume();
  };
  const prevNext = gameHooks.next;
  gameHooks.next = () => {
    if (prevNext && prevNext()) return true;
    if (!session || !S.solved || !lastSolve || lastSolve.id !== S.id) return false;
    if (session.kind === 'quick') {
      const b = session.band;
      if (bandOpenNow(b)) startNewQuick(b); else openFreeMode();
    } else openFreeMode();
    return true;
  };
  const prevAfter = toastHooks.after;
  toastHooks.after = () => { if (prevAfter) prevAfter(); toastAfter(); };

  document.addEventListener('sudoku:solved', onSolved);
  document.addEventListener('sudoku:nav', e => {
    const to = e.detail && e.detail.to;
    if (to === 'free') openFreeMode();
    else if (to) closeFreeMode();      // home / campaign / settings: step 7 shows its screen
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clockPause(); else clockResume(); });
  window.addEventListener('pagehide', () => clockPause());

  // the puzzle main.js already started (before this module was ready)
  if (S.id) onPuzzleStart(S.id);
  if (/[#&]free\b/.test(location.hash)) openFreeMode();

  if (DEBUG) {
    window.__fm = {
      open: openFreeMode, close: closeFreeMode, isOpen, state: getFreeModeState, setState: setFreeModeState,
      session: () => (session ? { ...session, elapsed: elapsed(), running: clockRunning() } : null),
      lastSolve: () => lastSolve, mastered: masteredWorlds, learned: learnedTechniques, today: () => todayInfo(now()),
      feedback: () => ruleHooks.feedback(), setFeedback, openBand, openDaily, render,
      dailyIndex, dayNumber, dayInfo, pickPuzzle, BAND_INFO
    };
  }
}
