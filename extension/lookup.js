export const HOST_ORIGINS = Object.freeze(['https://numismatics.org/*', 'https://nomisma.org/*']);
export const TIMEOUT_MS = 10000;

const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => squash(value).toLowerCase();

export function buildQuery({ catalogue, number, volume, section }) {
  if (catalogue === 'RIC') {
    const edition = squash(volume).replace(/\b(1st|2nd|3rd|4th)\b/gi, (match) => ORDINALS[match.toLowerCase()]);
    return { corpus: 'ocre', query: squash(`RIC ${edition} ${squash(section)} ${squash(number)}`) };
  }
  return { corpus: 'pella', query: squash(`Price ${squash(number)}`) };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);

// ponytail: regex over a fixed-shape Atom feed; switch to DOMParser if entries ever nest.
export function parseFeed(xml) {
  const entries = [];
  for (const [, body] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = body.match(/<title>([^<]*)<\/title>/)?.[1];
    const id = body.match(/<id>([^<]*)<\/id>/)?.[1];
    if (title && id) entries.push({ id: unescape(id), title: unescape(title) });
  }
  return entries;
}

export function pickMatch(entries, query) {
  const wanted = norm(query);
  const exact = entries.find((entry) => norm(entry.title) === wanted);
  if (exact) return { status: 'ok', entry: exact };
  if (entries.length >= 1 && entries.length <= 5) return { status: 'candidates', candidates: entries };
  return { status: 'none' };
}
