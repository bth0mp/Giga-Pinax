export const MAX_SELECTION = 120;

// Whitespace squashed, capped at 120 characters; a longer text is cut after its last whole ";" reference, so none is searched cut short
// ("…; Rosen 567" as "Rosen 56").
export function selectionQuery(text) {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim());
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
