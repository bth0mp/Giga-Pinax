import { INVISIBLE, parseReference } from './lookup.js';
import { RIC_SECTIONS, volumesOf } from './catalogues.js';

// A whole lot description, pasted or right-clicked: every catalogue reference in it, and the RIC rulers its heading names.
export const MAX_LOT = 3000;
const TYPED = Object.freeze(['RIC', 'RRC', 'SC', 'Price', 'Bop']);

// A run of references starts only at one of these keys. The single letters C (Cohen) and S (Sear) are matched upper case only and kept only in a run
// that also has a longer key, so "c. 386-338 BC" and the legend "S - C" stay text while "C.309 - RIC.112" is two references. Keys inside a bracket are
// skipped ("(= BMC 7)", a sale's "(2005, 1132)"), unless the bracket opens on a key: then each key after a separator in it counts ("(Cohen 17; RIC 972)").
const KEYS = ['BMC/RE', 'BMCRE', 'BMC', 'Bopearachchi', 'Bop\\.?', 'Calicó', 'Calico', 'Cohen', 'Coh\\.?', 'Crawford', 'Craw\\.?', 'Cr\\.?', 'RIC', 'RRC',
  'RSC', 'RPC', 'RCV', 'SNG', 'HGC', 'BCD', 'Sear', 'SBCV', 'SB', 'SC', 'Price', 'Pr', 'Mitchiner', 'MIG', 'DOC', 'MIBE', 'MIB', 'MIR', 'Sydenham',
  'Syd\\.?', 'Müller', 'Muller', 'Kroll', 'Svoronos', 'McClean', 'Benner', 'CBN', 'BN', 'GRPC', 'ESMS', 'ESM', 'C', 'S'];
const KEY = new RegExp(String.raw`(?<![\p{L}\d])(?:Ref(?:erences?|s)?\.?\s*:\s*)?(cf\.?\s*)?(${KEYS.join('|')})(?![\p{L}\d])`, 'giu');
// Dealers capitalise a catalogue key, so a lower-case word ("hammer price 500", "see doc 12") is never one.
const keyAt = (match) => /^\p{Lu}/u.test(match[2]);
// Where references are separated: ";", ", ", ". ", " - ", "=" or a line break (a comma or dot inside a number, "HGC 12, 72" aside, never splits).
const SEP = /\s*(?:;|,(?=\s)|\.(?=\s)|=|\n)\s*|\s+-\s+/y;
// What follows a key: up to four words ("ANS", "IV.1", "(Antoninus Pius)"), the last token holding a digit, then brackets, "var." or "passim".
const BODY = /^(?:\s*(?:[^\s()]+|\([^()]*\))){0,4}\s*[^\s()]*\d[^\s()]*(?:\s*\([^()]*\)|\s+(?:var\.?|passim)(?![\p{L}\d]))*/u;
const WORDS = /^(?:\s*[^\s\d()]+){0,3}\s*$/u;
// A weight, size, die axis or date after the references ("3.21g", "8 h", "AD 69-79") is not a number that carries one on.
const MEASURE = /^\d[\d.,]*\s*(?:g|gr|mm|h)$|\b(?:AD|BC|BCE|CE)\b|^(?:circa|ca?\.)\s/i;
const PROVENANCE = /(?:^|[.!?]\s+|\n\s*)(?:Ex|From|Provenance)\b/;
// Remarks a dealer adds that no search wants, rarity ("(R2)", "(RRR)", "(Very scarce)") and equivalence ("(= BMC 319)") too: no OCRE number ends in
// R to RRR, R2 or C, while a capital type letter ("509 (BB)") is one and stays.
const REMARKS = /\s*\((?:this coin|misdescribed)[^()]*\)|\s+passim(?![\p{L}])|\s*\([^()]*(?:[$€£]|\b(?:EUR|USD|CHF|GBP)\b)[^()]*\)|\s*\((?:R{1,3}|R\d|C\d?|(?:very |extremely )?(?:rare|scarce))\)|\s*\(\s*=[^()]*\)/giu;
const VARIANT = /\s*\bvar\.?(?:\s*\([^()]*\))?$/i;
const unpunctuate = (value) => value.trim().replace(/\s*[.,;:]+$/, '');
// The bracket depth before each UTF-16 index, as matchAll counts them, and where the outermost bracket around it opened (-1 outside one).
const depths = (text) => {
  let level = 0, open = -1;
  return text.split('').map((ch, at) => {
    if (ch === ')') level = Math.max(0, level - 1);
    const before = { level, open: level > 0 ? open : -1 };
    if (ch === '(' && level++ === 0) open = at;
    return before;
  });
};

// Invisible characters out, en and em dashes as "-", spaces squashed with the line breaks kept, at most 3,000 characters.
const clean = (text) => Array.from(String(text ?? '').replace(INVISIBLE, '').replace(/[\u2013\u2014]/g, '-').replace(/[^\S\n]+/g, ' ')
  .replace(/ ?\n\s*/g, '\n').trim()).slice(0, MAX_LOT).join('');

// RIC persons, as their sections name them (volumes I–V and X; VI–IX are mints), without the groups and joint sections a heading never names alone.
const PERSON = /^(?:Anonymous|Civil Wars|Burgundians or Franks|Non-Imperial African|Suevi|Visigoths)$|\band\b|,| issuing /;
// How dealers write a section's person otherwise.
const SPELLINGS = Object.freeze({ 'Claudius Gothicus': String.raw`Claudius\s+II(?:\s+Gothicus)?` });
const RULERS = Object.freeze([...new Set(Object.entries(RIC_SECTIONS).filter(([volume]) => !['VI', 'VII', 'VIII', 'IX'].includes(volume))
  .flatMap(([, sections]) => sections.map((section) => section.split(' (')[0])).filter((name) => !PERSON.test(name)))]
  .sort((a, b) => b.length - a.length)
  .map((name) => [name, new RegExp(`(?<!\\p{L})(?:${[...name.split('/').map((part) => part.replace(/[.]/g, '\\.').replace(/ /g, '\\s+')), SPELLINGS[name]]
    .filter(Boolean).join('|')})(?!\\p{L})(?!\\s+[IVX]+\\b)`, 'giu')]));

// The longest names first, each blanked once found, so "Claudius Gothicus" is not also Claudius; several are kept in text order ("Claudius with Nero").
// A regnal numeral the name doesn't carry makes it someone else ("Claudius II" is not Claudius), and titles name no one: "as Caesar", "as Augustus",
// a lower-case "augustus", "Divus", and the Maximus in "Magnus Maximus" (a RIC IX person with no section here).
function rulersIn(text) {
  let rest = text.replace(/\bDiv(?:us|a)\b|\bas\s+(?:Caesar|Augustus)\b|\bMagnus\s+Maximus\b/gi, '').replace(/\baugust(?:us|a)\b/g, '');
  const found = [];
  for (const [name, pattern] of RULERS) rest = rest.replace(pattern, (match, offset) => { found.push([offset, name]); return ' '.repeat(match.length); });
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, name]) => name))];
}

// Split what follows a key at its top-level separators; a ")" it never opened ends it.
function chunks(span) {
  const parts = [];
  let depth = 0, start = 0, sep = '';
  for (let at = 0; at < span.length; at += 1) {
    const ch = span[at];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    else if (ch === ')') return { parts: [...parts, { sep, text: span.slice(start, at) }], stopped: true };
    else if (depth === 0) {
      SEP.lastIndex = at;
      const found = SEP.exec(span);
      if (found) { parts.push({ sep, text: span.slice(start, at) }); sep = found[0]; start = at + found[0].length; at = start - 1; }
    }
  }
  return { parts: [...parts, { sep, text: span.slice(start) }], stopped: false };
}

// The reference after one key: its first chunk (read up to its last number), then every chunk that starts with a number ("HGC 12, 72",
// "Svoronos pl. 20"). A chunk starting with a word is never part of it: a reference without a key ("Thirion 123", "Woytek 290b", "Lot 23312", "Rome 79")
// ends it but not the run, so a later C or S still counts; other text ("NGC Choice VF 5/5", "Good VF", "AD 69-79") ends the run too, which broken says.
function pieceAfter(span) {
  const { parts, stopped } = chunks(span);
  const [first, ...more] = parts;
  const read = first.text.match(BODY)?.[0] ?? (WORDS.test(first.text) ? first.text : '');
  let body = read, ended = false, broken = stopped || first.text.slice(read.length).trim() !== '';
  for (const { sep, text } of broken ? [] : more) {
    const piece = unpunctuate(text);
    if (!piece) continue;
    if (!/^(?:\d|\p{Lu}\p{L}*\s+\d)/u.test(piece) || piece.match(BODY)?.[0] !== piece || MEASURE.test(piece)) { broken = true; break; }
    if (/^\d/.test(piece) && !ended) body += `${sep}${piece}`;
    else ended = true;
  }
  return { body, broken };
}

// A reference as a search reads it: glued keys spaced ("RIC.112", "Sear-734"), "RIC²" as RIC, "V-1" as V.1, a range's first number, Pr as Price.
const readable = (text) => text.replace(/^RIC²/, 'RIC').replace(/^(\p{L}[\p{L}/]*)[.-](?=\d)/u, '$1 ').replace(/(?<=\s)([IVX]+)-(\d)(?!\d)/, '$1.$2')
  .replace(/(\d+[a-z]?)-(?:\d+[a-z]?|[a-z])(?=$|\s)/i, '$1').replace(/^Pr\s+(?=\d)/, 'Price ');

function normalise(written, key, cf) {
  const variant = VARIANT.test(written);
  let text = unpunctuate(written.replace(VARIANT, '').replace(REMARKS, ''));
  // A bracket naming a RIC section is that section ("RIC 268 (Elagabalus)"), put before the number; on another catalogue it is a remark.
  const section = [...text.matchAll(/\s*\(([^()]+)\)/g)].find((match) => volumesOf(match[1]).length > 0);
  const ric = /^RIC/i.test(key);
  if (section && !ric) text = unpunctuate(text.replace(section[0], ''));
  const plain = section && ric ? text.replace(section[0], ' ').replace(/\s+/g, ' ').trim().replace(/\s+(\d\S*)$/, ` ${section[1].trim()} $1`) : text;
  const parsed = parseReference(readable(plain));
  // Only a RIC key reads as RIC: "Kroll Titus 5" is never a RIC ruler and number.
  const type = parsed && parsed.catalogue !== 'Other' && (parsed.catalogue !== 'RIC' || ric);
  const reference = type ? parsed : { catalogue: 'Other', number: text, volume: '', section: '' };
  return { text, reference, cf, variant, typed: TYPED.includes(reference.catalogue) };
}

// Every catalogue reference in a lot description, in text order without duplicates, and the RIC rulers named before the first of them.
export function findReferences(input) {
  const cleaned = clean(input);
  const cut = cleaned.match(PROVENANCE);
  const text = cut ? cleaned.slice(0, cut.index) : cleaned;
  const depth = depths(text);
  const all = [...text.matchAll(KEY)].filter(keyAt);
  const listed = ({ index }) => {
    const { level, open } = depth[index];
    return level === 0 || (level === 1 && (text[index - 1] === '(' || (all.some((key) => key.index === open + 1) && /(?:[;,.=]\s*|\s-\s+)$/.test(text.slice(open, index)))));
  };
  const keys = all.filter(listed);
  let run = 0;
  const pieces = keys.map((match, index) => {
    const keyStart = match.index + match[0].length - match[2].length;
    const { body, broken } = pieceAfter(text.slice(match.index + match[0].length, keys[index + 1]?.index ?? text.length));
    const piece = { start: match.index, key: match[2], cf: Boolean(match[1]), written: `${text.slice(keyStart, match.index + match[0].length)}${body}`, run };
    if (broken) run += 1;
    return piece;
  });
  const longer = new Set(pieces.filter((piece) => piece.key.length > 1).map((piece) => piece.run));
  const kept = pieces.filter((piece) => /\d/.test(piece.written) && (piece.key.length > 1 || longer.has(piece.run)));
  const seen = new Set();
  const references = kept.map((piece) => normalise(piece.written, piece.key, piece.cf)).filter(({ reference: { catalogue, volume, section, number } }) => {
    const id = `${catalogue}|${volume}|${section}|${number}`.toLowerCase();
    return !seen.has(id) && seen.add(id);
  });
  return { references, rulers: rulersIn(text.slice(0, kept[0]?.start ?? text.length)) };
}

// Lot text rather than one reference: longer than a reference box holds, or naming two catalogues ("RIC 972; Cohen 17").
export function looksLikeLot(input) {
  const text = clean(input).replace(/\s+/g, ' ');
  return Array.from(text).length > 120 || [...text.matchAll(KEY)].filter((match) => match[2].length > 1 && keyAt(match)).length >= 2;
}

// Lot text is long or names two catalogues; a short heading with one reference in it ("Diva Faustina I … RIC III (Antoninus Pius) 394a", "SELEUCID
// KINGDOM. … SC 2069") is one too, since parseReference can't read it whole. Text that starts with a type catalogue's key and still can't be read is a
// typo ("RIC XI Nero 1", "RIC 2 Titus", "Price P1") and stays an error; a corpus title ("Seleucid", BIGR's) is no key.
const TYPED_KEY = /^(?:(?:RIC|RRC|SC|SCO|Cr)(?![a-z])|Craw|Price|Bop)/i;
export const isLot = (text) => looksLikeLot(text)
  || (!parseReference(text) && !TYPED_KEY.test(String(text ?? '').replace(INVISIBLE, '').trim()) && findReferences(text).references.length > 0);

// A lot row looks up its parsed reference, never the row itself. Only a RIC reference without a ruler of its own borrows the text's rulers (the facet
// search); "(Elagabalus)" in the reference keeps today's path.
const borrowsRulers = ({ reference }, rulers) => reference.catalogue === 'RIC' && !reference.section && rulers.length > 0;
export const lotLookup = (found, rulers) => (borrowsRulers(found, rulers) ? { ...found.reference, rulers } : found.reference);
export const lotLabel = (found, rulers) => [found.text, borrowsRulers(found, rulers) && rulers[0], !found.typed && 'prices only', found.cf && 'cf.',
  found.variant && 'var.'].filter(Boolean).join(' · ');

// Lot text copied in lines (a paste, a right-click) for a one-line box: a break separates as ". " does, so a weight or an "Ex …" line never joins the
// reference above it ("…RIC 1073⏎18 mm"), and a line ending in its own mark keeps it ("HGC 4,⏎1598"). One reference split over lines ("RIC I²⏎Nero
// 306") reads with a space, and breaks at the ends go.
export function oneLine(text) {
  const lines = String(text ?? '').replace(/^\s*[\r\n]\s*|\s*[\r\n]\s*$/g, '');
  const flat = lines.replace(/\s*(?:\r\n|[\r\n])\s*/g, ' ');
  return isLot(flat) ? lines.replace(/([.;,:])?[^\S\r\n]*(?:\r\n|[\r\n])\s*/g, (_, mark) => `${mark ?? '.'} `) : flat;
}
