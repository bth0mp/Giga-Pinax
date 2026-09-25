// @ts-check
// The want list (G-22 / Q-13): which references can be wanted, whether a card, a lot or a coin is a wanted type, and how a
// want is said. A want is matched by the catalogue rules the lookup reads references with (lookup.js parseReference) and
// never by comparing text: "RIC I (second edition) Nero 306" is the want "RIC I² Nero 306", "RIC I² Nero 306a" is not. Only
// a reading that names one type can be wanted or match one - a bare RIC number, a dealer's dotted letter or a reference no
// catalogue reads (an Other) never does. OCRE titles some types over a range, so a range matches only the same range.
// Everything here is local: nothing is fetched and nothing leaves the machine.
import { parseReference } from '../lookup.js';
import { WANT_GRADES } from './fields.js';
import { formatMoney, parseMoney } from './money.js';
/**
 * @typedef {import('./types.js').Want} Want
 * @typedef {import('./types.js').Lot} Lot
 * @typedef {{ catalogue: string, number: string, volume?: string, section?: string, range?: string, dottedLetter?: string }} Reading
 */

/** The lowest grade a want asks for, as the Want list writes it: "VF or better". */
export const WANT_GRADE_LABELS = Object.freeze({ F: 'Fine', VF: 'VF', EF: 'EF', AU: 'AU' });
/** The same grades as the form offers them, named in full. */
export const WANT_GRADE_CHOICES = Object.freeze(WANT_GRADES.map((grade) => Object.freeze({
  value: grade, label: ({ F: 'Fine (F) or better', VF: 'Very Fine (VF) or better', EF: 'Extremely Fine (EF) or better', AU: 'About Uncirculated (AU) or better' })[grade],
})));

const field = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const blank = (value) => !field(value);

/**
 * A reference as the lookup's rules read it: text is read, a reading already made is taken as it is.
 * @param {*} reference
 * @returns {Reading | null}
 */
function readingOf(reference) {
  if (reference && typeof reference === 'object') return reference;
  if (typeof reference !== 'string' || !reference.trim()) return null;
  try { return parseReference(reference); } catch { return null; }
}

/**
 * Whether a reading names one catalogue type: a catalogue with type data (never Other), a number, and for RIC both the
 * volume and the ruler or mint, since RIC numbers begin again in every section. A dealer's dotted letter ("RIC IV 27 b.")
 * names two.
 * @param {Reading | null | undefined} reading
 * @returns {boolean}
 */
export function namesOneType(reading) {
  if (!reading || reading.catalogue === 'Other' || blank(reading.catalogue) || blank(reading.number)) return false;
  if (reading.dottedLetter) return false;
  if (reading.catalogue === 'RIC') return !blank(reading.volume) && !blank(reading.section);
  return true;
}

/**
 * The reading of a reference that can be wanted, or null.
 * @param {*} reference
 * @returns {Reading | null}
 */
export function wantedReading(reference) {
  const reading = readingOf(reference);
  return namesOneType(reading) ? reading : null;
}

/**
 * Whether two references name the same one type: both read by the lookup's rules, each naming one type, and the same in
 * catalogue, volume, section, number and range - spacing and case aside.
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
export function sameWantedType(left, right) {
  const one = wantedReading(left);
  const other = wantedReading(right);
  if (!one || !other) return false;
  return ['catalogue', 'volume', 'section', 'number', 'range'].every((key) => field(one[key]) === field(other[key]));
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
  return `“${text}” is not read as one catalogue type. A want is a RIC, RRC, Price, SC, CPE or Bopearachchi reference, such as RIC I² Nero 306 or RRC 44/5.`;
}

/**
 * The wants still open (not found) whose type the reference names, in the order they were added. A reference that names
 * no single type is on no want list.
 * @param {Want[] | null | undefined} wants
 * @param {*} reference
 * @returns {Want[]}
 */
export function openWantsFor(wants, reference) {
  if (!wantedReading(reference)) return [];
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
 * The won coins a want could be marked found by: saved, won, and of its type.
 * @param {Want} want
 * @param {Lot[] | null | undefined} lots
 * @returns {Lot[]}
 */
export function wonCoinsFor(want, lots) {
  return (Array.isArray(lots) ? lots : []).filter((lot) => lot?.outcome?.status === 'won' && sameWantedType(lot.reference, want?.reference));
}

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
  const twin = (Array.isArray(wants) ? wants : []).find((want) => want.id !== values.id && !want.foundLotId && sameWantedType(want.reference, reference));
  if (twin) return { ok: false, field: 'reference', message: `${twin.reference} is already on your want list.` };
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
