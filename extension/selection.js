import { INVISIBLE } from './lookup.js';
import { MAX_LOT, looksLikeLot, oneLine } from './lot.js';

export const MAX_SELECTION = 120;
export { MAX_LOT };

// The hidden characters dealer pages add go before the cap, and a lone surrogate is made well-formed where the browser can, so encodeURIComponent
// never throws on it. Whitespace squashed, a line break in lot text as ". " (oneLine). A whole lot description (looksLikeLot) keeps up to 3,000
// characters, cut at a word boundary, for the popup to find every reference in; one reference is capped at 120 characters, a longer text cut after
// its last whole ";" reference, so none is searched cut short ("…; Rosen 567" as "Rosen 56").
export function selectionQuery(text) {
  const raw = String(text ?? '');
  const chars = Array.from(oneLine((raw.toWellFormed?.() ?? raw).replace(INVISIBLE, '')).replace(/\s+/g, ' ').trim());
  if (looksLikeLot(chars.join(''))) {
    const lot = chars.slice(0, MAX_LOT).join('');
    return (chars.length > MAX_LOT && chars[MAX_LOT] !== ' ' && lot.includes(' ') ? lot.slice(0, lot.lastIndexOf(' ')) : lot).trim();
  }
  const kept = chars.slice(0, MAX_SELECTION).join('');
  return (chars.length > MAX_SELECTION && kept.includes(';') ? kept.slice(0, kept.lastIndexOf(';')) : kept).trim();
}

// window=1 lays the page out to fill a window you can resize (right-click, the pop-out button); q is the reference a right-click looks up at once.
export function popupUrlFor(text) {
  const query = selectionQuery(text);
  return `popup.html?window=1${query ? `&q=${encodeURIComponent(query)}` : ''}`;
}

export function queryFromSearch(search) {
  return selectionQuery(new URLSearchParams(String(search ?? '')).get('q'));
}

// The pop-out names the card it shows by corpus and id, and the window reopens it as a Recent chip does, never reading its title again: a title the
// Reference box can't read ("Price P1", Other text chosen by hand) or a Bop series several subtypes share would not bring the same card back.
export const cardUrlFor = (card) => (card ? `popup.html?${new URLSearchParams({ window: '1', corpus: card.corpus, id: card.id })}` : popupUrlFor(''));

export function cardFromSearch(search) {
  const params = new URLSearchParams(String(search ?? ''));
  const [corpus, id] = [params.get('corpus'), params.get('id')];
  return corpus && id ? { corpus, id } : null;
}

// One lookup window: the right-click and the pop-out send the address they would open to a window already open (a windowed popup page, which looks it
// up and answers with its window id, brought to the front here). With none to answer (the send rejects, or nothing replies), a new window opens on it.
export const LOOKUP_MESSAGE = 'giga-pinax-lookup';
export async function showInWindow(api, url) {
  let answer = null;
  try { answer = await api.runtime.sendMessage({ type: LOOKUP_MESSAGE, url }); } catch { /* no window open */ }
  if (!answer) await api.windows.create({ url: api.runtime.getURL(url), type: 'popup', width: 440, height: 680 });
  else if (Number.isInteger(answer.windowId)) await api.windows.update(answer.windowId, { focused: true });
}
