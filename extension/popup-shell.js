// The popup's frame (popup.js): its elements by id, bringing an answer into view, the note under the
// guided fields, and the light or dark theme. None of it holds a lookup's state.
import { THEME_KEY, restoreTheme } from './preferences.js';

const $ = (id) => document.getElementById(id);

// The form, a Recent row and the card together are taller than the popup, so the answer usually arrives below the fold and pressing Look up looks like
// nothing happened. reveal() brings the top of the answer into view; his own scrolling wins, since the panel having moved since the lookup began means
// he moved it. Errors never scroll: they belong beside the box he typed in.
const scroller = document.querySelector('.popup-scroll');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let restingScroll = 0;
const markScroll = () => { restingScroll = scroller.scrollTop; };
// The card grows after it is shown - Recent renders under it, then the prices panel arrives a second later - and until it does there may be nothing to
// scroll at all, so the answer is revealed again as it settles. Timers, not requestAnimationFrame: a popup whose window is not being painted never runs
// an animation frame, and the answer must still be where he can see it when he looks.
const revealAgain = (id) => { for (const wait of [0, 60, 400]) setTimeout(() => reveal(id), wait); };
// His own scrolling wins: the panel having moved since the lookup began means he moved it. Errors never scroll - they belong beside the box he typed in.
function reveal(id) {
  const view = scroller.getBoundingClientRect();
  const box = $(id).getBoundingClientRect();
  // Nothing to do once the answer starts at the top of the panel, which is also what stops the later passes from fighting the first.
  if (scroller.scrollTop !== restingScroll || box.top <= view.top + 8) return;
  $(id).scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  // Where the panel now rests is where we put it, or the next pass reads our own scroll as his and never moves.
  scroller.addEventListener('scrollend', markScroll, { once: true });
  setTimeout(markScroll, 700);
}

// A change the tool made to the guided fields by itself: shown under those fields for everyone, and said once — #ric-note is no live region, so a
// screen reader hears the announcement alone. It lasts until the next edit.
function ricChanged(message) {
  $('ric-note').textContent = message;
  $('announcement').textContent = message;
}
const clearRicNote = () => { $('ric-note').textContent = ''; };

// Light or dark: the popup follows the system scheme until the header button is used. That choice is stored under its own key as a bare
// 'light' or 'dark' (theme.js applies it before the first paint; restoreTheme validates it here too, so anything else falls back to the system).
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
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
function chooseTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); }
  catch { $('storage-note').hidden = false; }
  syncThemeButton();
}

export {
  $, applyStoredTheme, chooseTheme, clearRicNote, darkScheme, markScroll, revealAgain, ricChanged, shownTheme, syncThemeButton,
};
