// @ts-check
// The want list (G-22 / Q-13): which references can be wanted, whether a card, a lot or a coin is a wanted type, and how a
// want is said. A want is matched by the catalogue rules the lookup reads references with (lookup.js parseReference) and
// never by comparing text: "RIC I (second edition) Nero 306" is the want "RIC I² Nero 306", "RIC I² Nero 306a" is not. Only
// a reading that names one type can be wanted or match one - a bare RIC number, a dealer's dotted letter or a reference no
// catalogue reads (an Other) never does. OCRE titles some types over a range, so a range matches only the same range.
// Everything here is local: nothing is fetched and nothing leaves the machine.
import { parseReference } from '../lookup.js';
import { ricMintSection } from '../catalogues.js';
import { WANT_GRADES } from './fields.js';
import { formatMoney, parseMoney } from './money.js';
/**
 * @typedef {import('./types.js').Want} Want
 * @typedef {import('./types.js').Lot} Lot
 * @typedef {{ catalogue: string, number: string, volume?: string, section?: string, range?: string, dottedLetter?: string }} Reading
 */

// One table for the four grades a want can ask for (H-18): the abbreviation a card, a badge and a want's terms write ("VF or
// better"), and the name the form's list gives it beside the abbreviation ("VF · Very Fine").
const GRADE_NAMES = Object.freeze({ F: 'Fine', VF: 'Very Fine', EF: 'Extremely Fine', AU: 'About Uncirculated' });
/** The lowest grade a want asks for, as every page writes it: "VF or better". */
export const WANT_GRADE_LABELS = Object.freeze(Object.fromEntries(WANT_GRADES.map((grade) => [grade, grade])));
/** The same grades as the form offers them, the abbreviation first: "VF · Very Fine". */
export const WANT_GRADE_CHOICES = Object.freeze(WANT_GRADES.map((grade) => Object.freeze({ value: grade, label: `${grade} · ${GRADE_NAMES[grade]}` })));

const field = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const blank = (value) => !field(value);

/**
 * A RIC section as two readings of it are compared: Nomisma gives a mint both its modern and its Latin name, and the lookup opens
 * one card under either ("RIC VII Trier 12" is RIC VII Treveri 12), so a mint is read by the Latin name RIC files it under; any
 * other section as it is written, spacing and case aside. The popup reads a card against its research with this same helper.
 * @param {*} section
 * @returns {string}
 */
export const ricSectionKey = (section) => field(ricMintSection(section) || section);

/**
 * A reference as the lookup's rules read it: text is read, a reading already made is taken as it is.
 * @param {*} reference
 * @returns {Reading | null}
 */
function readingOf(reference) {
  if (reference && typeof reference === 'object') return reference;
  if (typeof reference !== 'string' || !reference.trim()) return null;
  // A page matches every want against every coin on each draw (60 wants and 800 coins are 96,000 comparisons), so each
  // text is read once and its reading kept (K-04). The reading depends on the text alone; the table is emptied when full.
  if (readings.has(reference)) return readings.get(reference) ?? null;
  let reading = null;
  try { reading = parseReference(reference); } catch { reading = null; }
  if (readings.size >= READINGS_KEPT) readings.clear();
  readings.set(reference, reading ? Object.freeze(reading) : null);
  return reading;
}
const READINGS_KEPT = 4000;
/** @type {Map<string, Reading | null>} */
const readings = new Map();
/** How many texts have a reading kept: each text is read once, however often it is compared. */
export const readingsKept = () => readings.size;

/**
 * Whether a reading names one catalogue type: a catalogue with type data (never Other), a number, for RIC both the volume
 * and the ruler or mint, since RIC numbers begin again in every section, and for Bopearachchi the king, whose series each
 * begin again. A dealer's dotted letter ("RIC IV 27 b.") names two.
 * @param {Reading | null | undefined} reading
 * @returns {boolean}
 */
export function namesOneType(reading) {
  if (!reading || reading.catalogue === 'Other' || blank(reading.catalogue) || blank(reading.number)) return false;
  if (reading.dottedLetter) return false;
  if (reading.catalogue === 'RIC') return !blank(reading.volume) && !blank(reading.section);
  if (reading.catalogue === 'Bop') return !blank(reading.section);
  return true;
}

/**
 * The reading of a reference that can be wanted, or null.
 * @param {*} reference
 * @returns {Reading | null}
 */
export function wantedReading(reference) {
  const reading = oneTypeReading(reference);
  return reading ? { ...reading } : null;
}
// The same, kept inside this module: the reading read once and never handed out, so nothing can change it.
const oneTypeReading = (reference) => { const reading = readingOf(reference); return namesOneType(reading) ? reading : null; };

/**
 * Whether two references name the same one type: both read by the lookup's rules, each naming one type, and the same in
 * catalogue, volume, section, number and range - spacing and case aside, and a RIC mint in either of its names (ricSectionKey).
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
export function sameWantedType(left, right) {
  const one = oneTypeReading(left);
  const other = oneTypeReading(right);
  if (!one || !other) return false;
  return ['catalogue', 'volume'].every((key) => field(one[key]) === field(other[key])) && sameShelfPlace(one, other);
}

// OCRE splits some RIC numbers by denomination and titles each half with it in a bracket ("RIC II Trajan 253 (aureus)",
// "... (denarius)"): RIC 253 is still one number, so a number written without the bracket is either half, and one
// written with it is that half only (V-02).
const BRACKETED = /^(.*?)\s*\(([^()]*)\)$/;
/**
 * @param {*} number
 * @returns {{ base: string, bracket: string }}
 */
const numberParts = (number) => {
  const text = field(number);
  const match = BRACKETED.exec(text);
  return match ? { base: match[1], bracket: match[2] } : { base: text, bracket: '' };
};
/**
 * The section, number and range of two readings of one catalogue agree: a RIC mint in either of its names, and a RIC
 * number with or without OCRE's bracketed denomination.
 * @param {Reading} one
 * @param {Reading} other
 * @returns {boolean}
 */
function sameShelfPlace(one, other) {
  const ric = field(one.catalogue) === 'ric';
  if (ric ? ricSectionKey(one.section) !== ricSectionKey(other.section) : field(one.section) !== field(other.section)) return false;
  if (field(one.range) !== field(other.range)) return false;
  if (!ric) return field(one.number) === field(other.number);
  const left = numberParts(one.number); const right = numberParts(other.number);
  return left.base === right.base && (!left.bracket || !right.bracket || left.bracket === right.bracket);
}

// OCRE titles a second edition in words ("RIC I (second edition) Nero 306"); a want is written in the short form the popup
// writes a card's reference in ("RIC I² Nero 306"), which parseReference reads back as the same type. Kept in step with
// companion-popup.js displayReference.
const SECOND_EDITION = /^RIC (X|IX|VIII|VII|VI|V|IV|III|II|I)(?:, Part (\d))? \((?:second|2nd) edition\) (\S.*)$/;
/**
 * A card's title as a want is written.
 * @param {*} label
 * @returns {string}
 */
export function cardReference(label) {
  const text = String(label ?? '').trim();
  const match = SECOND_EDITION.exec(text);
  return match ? `RIC ${match[1]}${match[2] ? `.${match[2]}` : ''}² ${match[3]}` : text;
}

/**
 * What the bundled catalogue holds for a want, and so what is saved (V-02): a want is kept only where a card could ever
 * match it. A reference the catalogue opens, or lists, as the same type is saved as written; one it holds only under
 * another volume or edition of the same ruler or mint and number is saved as the card titles it ("RIC I Nero 306" is
 * RIC I² Nero 306, the only RIC I OCRE holds; "RIC V.2 Probus 157" is RIC V Probus 157), and `note` says so; several such
 * cards are offered as `choices`; and one the catalogue does not hold is refused with the reason. A catalogue the bundle
 * does not hold (Bopearachchi), a lookup that fails, or no catalogue at all, keeps the reference as written: it cannot be
 * checked here. Nothing is fetched beyond the bundled files.
 * @param {string} reference the collector's text, one type by `wantReferenceProblem`
 * @param {((reading: Reading) => Promise<*>) | null | undefined} lookupType the bundled catalogue's lookup
 * @returns {Promise<{ ok: true, reference: string, note: string } | { ok: false, message: string, choices: string[] }>}
 */
export async function resolveWantReference(reference, lookupType) {
  const asWritten = { ok: /** @type {true} */ (true), reference, note: '' };
  const reading = wantedReading(reference);
  if (!reading || typeof lookupType !== 'function') return asWritten;
  let found = null;
  try { found = await lookupType(reading); } catch { found = null; }
  if (!found || !['ok', 'candidates', 'none'].includes(found.status)) return asWritten;
  const titles = found.status === 'ok' ? [found.card?.label] : found.status === 'candidates' ? (found.candidates ?? []).map((entry) => entry?.title ?? entry?.label) : [];
  const cards = [...new Set(titles.filter(Boolean).map(cardReference))].filter((card) => wantedReading(card));
  const renamed = (card) => ({ ok: /** @type {true} */ (true), reference: card, note: `you wrote ${reference}; this is how the catalogue titles it` });
  // A card opened for this very reading is the type, whatever its title looks like (SC and Newell are titled in words).
  if (found.status === 'ok') return !cards.length || sameWantedType(cards[0], reference) ? asWritten : renamed(cards[0]);
  if (cards.some((card) => sameWantedType(card, reference))) return asWritten;
  const near = cards.filter((card) => {
    const other = wantedReading(card);
    return Boolean(other) && field(other?.catalogue) === field(reading.catalogue) && sameShelfPlace(reading, /** @type {Reading} */ (other));
  });
  if (near.length === 1) return renamed(near[0]);
  if (near.length > 1) return { ok: false, message: `The catalogue holds ${reference} in ${near.length} volumes or editions. Choose the one you want:`, choices: near };
  return { ok: false, message: `${reference} is not in the catalogue bundled with Giga Pinax, so no card could ever match this want. Check the volume, the ruler or mint and the number.`, choices: [] };
}

/**
 * Why a reference cannot be wanted, in the form's words, or '' when it can.
 * @param {*} reference
 * @returns {string}
 */
export function wantReferenceProblem(reference) {
  const text = String(reference ?? '').trim();
  if (!text) return 'Enter the reference you are looking for.';
  const reading = readingOf(text);
  if (namesOneType(reading)) return '';
  if (reading?.catalogue === 'RIC') return 'A RIC reference names its volume and its ruler or mint, as a card does: RIC II Trajan 253, RIC VII Antioch 1.';
  if (reading?.catalogue === 'Bop') return 'A Bopearachchi reference names its king, as a card does: Bopearachchi Menander I 13A.';
  if (/^newell\b/i.test(text)) return 'A Newell reference names Demetrius, as a card does: Newell Demetrius 45.';
  return `“${text}” is not read as one catalogue type. A want is a RIC, RRC, Price, SC, CPE, Newell Demetrius or Bopearachchi reference, such as RIC I² Nero 306, RRC 44/5 or Newell Demetrius 45.`;
}

/**
 * The wants still open (not found) whose type the reference names, in the order they were added. A reference that names
 * no single type is on no want list.
 * @param {Want[] | null | undefined} wants
 * @param {*} reference
 * @returns {Want[]}
 */
export function openWantsFor(wants, reference) {
  if (!oneTypeReading(reference)) return [];
  return (Array.isArray(wants) ? wants : []).filter((want) => !want?.foundLotId && sameWantedType(want?.reference, reference));
}

/**
 * What a want asks beyond its type: "up to €800.00 · VF or better", each part only where it was given.
 * @param {Want | null | undefined} want
 * @param {string} [locale]
 * @returns {string}
 */
export function wantTermsText(want, locale = 'en-US') {
  const parts = [];
  if (want?.maxPrice) { try { parts.push(`up to ${formatMoney(want.maxPrice, locale, { narrow: true })}`); } catch { /* not a price to say */ } }
  const grade = want?.minGrade ? WANT_GRADE_LABELS[want.minGrade] : '';
  if (grade) parts.push(`${grade} or better`);
  return parts.join(' · ');
}

/**
 * The badge's words for a type on the want list: "On your want list · up to €800.00 · VF or better", from the first want
 * of the type; '' when the type is on no want list.
 * @param {Want[]} matches
 * @param {string} [locale]
 * @returns {string}
 */
export function wantBadgeText(matches, locale = 'en-US') {
  if (!matches?.length) return '';
  return ['On your want list', wantTermsText(matches[0], locale)].filter(Boolean).join(' · ');
}

/**
 * The coins still open on the watchlist that are the want's type (H-08): what the hunt has turned up so far, in the order
 * they were saved.
 * @param {Want | null | undefined} want
 * @param {Lot[] | null | undefined} lots
 * @returns {Lot[]}
 */
export function watchedLotsFor(want, lots) {
  const open = (lot) => !lot?.outcome?.status || lot.outcome.status === 'open';
  return (Array.isArray(lots) ? lots : []).filter((lot) => open(lot) && sameWantedType(lot?.reference, want?.reference));
}

/**
 * A wanted type as its status pill says it (H-05): "Wanted · up to £650 · VF+", from the first want of the type; '' when
 * the type is on no want list. The amount is whole where it is exact and in full where it is not, so a pill never has to cut
 * or round it. wantBadgeText words the same in full, for the pill's tooltip. The one source for the popup's card, its Upcoming
 * rows and the workspace draft.
 * @param {Want[]} matches
 * @param {string} [locale]
 * @returns {string}
 */
export function wantPillText(matches, locale = 'en-US') {
  const want = matches?.[0];
  if (!want) return '';
  const parts = ['Wanted'];
  if (want.maxPrice) { try { parts.push(`up to ${formatMoney(want.maxPrice, locale, { narrow: true, whole: true })}`); } catch { /* not a price to say */ } }
  if (Object.hasOwn(WANT_GRADE_LABELS, want.minGrade ?? '')) parts.push(`${want.minGrade}+`);
  return parts.join(' · ');
}

/**
 * The won coins a want could be marked found by: saved, won, and of its type.
 * @param {Want} want
 * @param {Lot[] | null | undefined} lots
 * @returns {Lot[]}
 */
export function wonCoinsFor(want, lots) {
  return (Array.isArray(lots) ? lots : []).filter((lot) => lot?.outcome?.status === 'won' && sameWantedType(lot.reference, want?.reference));
}

/**
 * The other want of a reference's type, open or found, that stops it being saved (V-08): one want per type, so a badge
 * speaks for one want and a found want can always be edited. A want being edited is never its own twin, and one that keeps
 * the type it already had is not stopped by a twin an older version let in.
 * @param {Want[] | null | undefined} wants
 * @param {*} reference
 * @param {Want | null | undefined} [editing]
 * @returns {Want | null}
 */
export function wantTwin(wants, reference, editing = null) {
  if (editing && sameWantedType(editing.reference, reference)) return null;
  return (Array.isArray(wants) ? wants : []).find((want) => want?.id !== editing?.id && sameWantedType(want?.reference, reference)) ?? null;
}

/**
 * Why a want's twin stops it, in the words the form and the store both say.
 * @param {Want} twin
 * @returns {string}
 */
export const wantTwinMessage = (twin) => (twin.foundLotId
  ? `${twin.reference} is already on your want list, marked found. Choose Want again on it to look for another.`
  : `${twin.reference} is already on your want list.`);

/**
 * The Want list form read into what `want.save` takes, or the field that stops it and why. The reference must name one
 * type and not be on the list already (an edit may keep its own); a maximum price is an amount in the chosen currency;
 * the grade is one of the four.
 * @param {{ id?: string, reference?: string, maxPrice?: string, currency?: string, minGrade?: string, notes?: string }} values
 * @param {{ wants?: Want[] | null, locale?: string }} [context]
 * @returns {{ ok: true, value: Record<string, any> } | { ok: false, field: string, message: string }}
 */
export function wantFromForm(values, { wants = [], locale = 'en-US' } = {}) {
  const reference = String(values.reference ?? '').trim();
  const problem = wantReferenceProblem(reference);
  if (problem) return { ok: false, field: 'reference', message: problem };
  const list = Array.isArray(wants) ? wants : [];
  // A found want names the coin that answered it: what it is for changes only once it is wanted again.
  const editing = values.id ? list.find((want) => want.id === values.id) : null;
  if (editing?.foundLotId && !sameWantedType(editing.reference, reference)) {
    return { ok: false, field: 'reference', message: 'Choose Want again before changing what this want is for.' };
  }
  const twin = wantTwin(list, reference, editing);
  if (twin) return { ok: false, field: 'reference', message: wantTwinMessage(twin) };
  /** @type {Record<string, any>} */
  const want = { reference };
  if (String(values.maxPrice ?? '').trim()) {
    const money = parseMoney(String(values.maxPrice), String(values.currency ?? ''), locale);
    if (!money.ok) return { ok: false, field: 'maxPrice', message: money.error.message };
    if (money.value.minor === 0) return { ok: false, field: 'maxPrice', message: 'A maximum price is more than nothing. Leave it blank for no maximum.' };
    want.maxPrice = money.value;
  }
  if (values.minGrade) {
    if (!(/** @type {ReadonlyArray<string>} */ (WANT_GRADES)).includes(values.minGrade)) return { ok: false, field: 'minGrade', message: 'Choose a grade from the list.' };
    want.minGrade = values.minGrade;
  }
  if (String(values.notes ?? '').trim()) want.notes = String(values.notes);
  if (values.id) want.id = values.id;
  return { ok: true, value: want };
}
