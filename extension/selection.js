export const MAX_SELECTION = 120;

export function selectionQuery(text) {
  return Array.from(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, MAX_SELECTION).join('').trim();
}

export function popupUrlFor(text) {
  return `popup.html?q=${encodeURIComponent(selectionQuery(text))}`;
}

export function queryFromSearch(search) {
  return selectionQuery(new URLSearchParams(String(search ?? '')).get('q'));
}
