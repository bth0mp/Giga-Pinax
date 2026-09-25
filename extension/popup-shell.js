// @ts-check
// The popup's frame (popup.js): its elements by id, bringing an answer into view, the note under the
// guided fields, and the light or dark theme. None of it holds a lookup's state.
import { THEME_KEY, restoreTheme } from './preferences.js';

// The popup's elements are inputs, selects, buttons, details and plain elements alike, and each caller knows which it
// asked for, so the lookup is typed as any.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);

// The form, a Recent row and the card together are taller than the popup, so the answer usually arrives below the fold and pressing Look up looks like
// nothing happened. reveal() brings the top of the answer into view; his own scrolling wins, since the panel having moved since the lookup began means
// he moved it. Errors never scroll: they belong beside the box he typed in.
// popup.html always has its scrolling panel.
const scroller = /** @type {HTMLElement} */ (document.querySelector('.popup-scroll'));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let restingScroll = 0;
// A scroll of our own still under way, and where it is going: a newer answer may take it over, since he has not moved the panel himself.
let ownScroll = false;
let ownTarget = 0;
/** @type {() => void} */
const markScroll = () => { ownScroll = false; restingScroll = scroller.scrollTop; };
// The card grows after it is shown - Recent renders under it, then the prices panel arrives a second later - and until it does there may be nothing to
// scroll at all, so the answer is revealed again as it settles. Timers, not requestAnimationFrame: a popup whose window is not being painted never runs
// an animation frame, and the answer must still be where he can see it when he looks.
// The latest answer is the one brought into view: prices that came in before the card leave passes waiting, and those must not scroll past the card.
let revealing = 0;
/** @type {(id: string) => void} */
const revealAgain = (id) => {
  const ticket = ++revealing;
  for (const wait of [0, 60, 400]) setTimeout(() => { if (ticket === revealing) reveal(id); }, wait);
};
// His own scrolling wins: the panel having moved since the lookup began means he moved it. Errors never scroll - they belong beside the box he typed in.
function reveal(id) {
  // The top of the panel is taken by the row with the Reference box, which stays there (popup.css), so the answer is brought up to just under it.
  const top = scroller.getBoundingClientRect().top + $('quick-search').getBoundingClientRect().height;
  const box = $(id).getBoundingClientRect();
  const target = scroller.scrollTop + box.top - top;
  if (!ownScroll && scroller.scrollTop !== restingScroll) return;
  // Nothing to do once the answer starts at the top of the panel, which is also what stops the later passes from fighting the first; a scroll of
  // our own already going there is left to finish, and one going elsewhere is turned towards this answer.
  if (ownScroll ? Math.abs(target - ownTarget) <= 8 : box.top <= top + 8) return;
  ownScroll = true;
  ownTarget = target;
  // The panel alone is scrolled. scrollIntoView scrolls every ancestor, and a lot's answer can make the document taller than the popup for a moment:
  // the document then scrolled too, taking the header and tabs off the top where no wheel could bring them back.
  scroller.scrollTo({ top: target, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  // Where the panel now rests is where we put it, or the next pass reads our own scroll as his and never moves.
  scroller.addEventListener('scrollend', markScroll, { once: true });
  setTimeout(markScroll, 700);
}

// An answer drawn at start-up (the last one, kept in the session) is put where a lookup would have brought it, at once: the popup is only now being
// painted, so there is no movement to watch and none is animated.
/** @type {(id: string) => void} */
const placeAtTop = (id) => {
  const top = scroller.getBoundingClientRect().top + $('quick-search').getBoundingClientRect().height;
  const target = scroller.scrollTop + $(id).getBoundingClientRect().top - top;
  if (target > 0) scroller.scrollTo({ top: target, behavior: 'instant' });
  markScroll();
};

// A change the tool made to the guided fields by itself: shown under those fields for everyone, and said once — #ric-note is no live region, so a
// screen reader hears the announcement alone. It lasts until the next edit.
/**
 * @param {string} message
 * @returns {void}
 */
function ricChanged(message) {
  $('ric-note').textContent = message;
  $('announcement').textContent = message;
}
/** @type {() => void} */
const clearRicNote = () => { $('ric-note').textContent = ''; };

// Once the panel has moved, the row that stays at its top draws a line under it, so the answer reads as passing beneath it.
scroller.addEventListener('scroll', () => { scroller.classList.toggle('scrolled', scroller.scrollTop > 0); }, { passive: true });

// Light or dark: the popup follows the system scheme until the header button is used. That choice is stored under its own key as a bare
// 'light' or 'dark' (theme.js applies it before the first paint; restoreTheme validates it here too, so anything else falls back to the system).
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
/** @type {() => string} */
const shownTheme = () => document.documentElement.dataset.theme || (darkScheme.matches ? 'dark' : 'light');

// The button is "pressed" while dark is shown, and its icon shows what a click switches to: a moon in light, a sun in dark.
function syncThemeButton() {
  const dark = shownTheme() === 'dark';
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
  $('theme-toggle').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  $('icon-sun').toggleAttribute('hidden', !dark);
  $('icon-moon').toggleAttribute('hidden', dark);
}

function applyStoredTheme() {
  let theme = '';
  try { theme = restoreTheme(localStorage.getItem(THEME_KEY)); } catch { /* unreadable storage: follow the system */ }
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// A click switches to the opposite of what is shown and remembers it; a failed write shows the storage note like any other preference.
/**
 * @param {'light' | 'dark'} theme
 * @returns {void}
 */
function chooseTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); }
  catch { $('storage-note').hidden = false; }
  syncThemeButton();
}

export {
  $, applyStoredTheme, chooseTheme, clearRicNote, darkScheme, markScroll, placeAtTop, revealAgain, ricChanged, shownTheme, syncThemeButton,
};
