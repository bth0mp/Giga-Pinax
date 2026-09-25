// @ts-check
// The bounds every record is held to, and the field validators every record shape and draft is built
// from. Each validator answers { ok: true, value } or the failure that names the path it failed at.
import { validateIncrementLadder, validateMoney } from './money.js';
import { ISO_DATE, UUID, dateParts, failure, isIsoInstant } from './validate.js';
/**
 * @typedef {import('./types.js').Money} Money
 * @typedef {import('./types.js').AuctionContext} AuctionContext
 */
/**
 * @template T
 * @typedef {import('./types.js').Result<T>} Result
 */

export const LIMITS = Object.freeze({
  lots: 5000,
  auctionEvents: 500,
  alternativeGroups: 1000,
  evidenceObservations: 10000,
  collectionEntries: 1000,
  // The want list (G-22): references the collector is looking for.
  wants: 1000,
  drafts: 20,
  alerts: 10000,
  recentCommands: 200,
  clearedReferences: 10000,
  // Entries in the set-aside list of a backup being imported: every record the collections above can hold at once
  // (27,500), with room for the notes of the links a repair cleared. A stored root's own list is not held to it - a
  // store that set more aside must still open - so it is the import that refuses, before anything is folded.
  quarantine: 30000,
  sourceLinks: 20,
  reminders: 20,
  bidHistory: 500,
  outcomeHistory: 100,
  title: 300,
  shortText: 120,
  notes: 5000,
  url: 2048,
  draftPayloadBytes: 10000,
  commandReplyBytes: 100000,
  // A revision is only ever compared and counted up, so the ceiling is the highest number the next count is still an
  // exact integer from: at 2^53-1 the increment is no longer one, and a root carrying it made every later save and every
  // reconcile fail validation for good. 2^52 writes is a number no collector reaches.
  revision: 2 ** 52,
  // Validation accepts the ceiling itself, because a root that already carries one has to open; but a record stopped
  // exactly there is refused by its very next write, which would land one above. So a revision a document brings in, or
  // a load hands back, stays this far below it. The gap is headroom for the writes that record still has coming: 2^32
  // of them, more than any store will ever see, and still nowhere near the ceiling.
  usableRevision: 2 ** 52 - 2 ** 32,
});

// The lowest grade a want may ask for (G-22), on the trade's English scale, lowest first: Fine, Very Fine, Extremely Fine
// and About Uncirculated. A want asking for one takes that grade or better; nothing is read from a lot's text against it.
export const WANT_GRADES = Object.freeze(['F', 'VF', 'EF', 'AU']);

/** @type {(value: any, key: PropertyKey) => boolean} */
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * The first failed result, or success when none failed. A check that passes may carry no value.
 * @param {...({ ok: true, value?: any } | import('./types.js').Failure)} results
 * @returns {Result<any>}
 */
function firstFailure(...results) {
  return results.find((result) => !result.ok) ?? { ok: true, value: undefined };
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} value
 * @param {string} path
 * @returns {Result<Record<string, any>>}
 */
function objectResult(value, path) {
  return isObject(value)
    ? { ok: true, value }
    : failure('invalid-record', 'Expected an object.', path);
}

/**
 * @param {*} value
 * @param {string} path
 * @param {number} maximum
 * @param {{ nonEmpty?: boolean }} [options]
 * @returns {Result<string>}
 */
function stringResult(value, path, maximum, { nonEmpty = true } = {}) {
  if (typeof value !== 'string' || value.length > maximum || (nonEmpty && value.trim() === '')) {
    return failure('invalid-string', `Expected a string of at most ${maximum} characters.`, path);
  }
  return { ok: true, value };
}

/**
 * @param {Record<string, any>} record
 * @param {string} key
 * @param {string} path
 * @param {number} maximum
 * @param {{ nonEmpty?: boolean }} [options]
 * @returns {Result<string | undefined>}
 */
function optionalString(record, key, path, maximum, options) {
  return OWN(record, key)
    ? stringResult(record[key], `${path}.${key}`, maximum, options)
    : { ok: true, value: undefined };
}

/**
 * @param {*} value
 * @param {string} path
 * @param {{ minimum?: number, maximum?: number }} [bounds]
 * @returns {Result<number>}
 */
function integerResult(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return failure('invalid-integer', `Expected an integer from ${minimum} through ${maximum}.`, path);
  }
  return { ok: true, value };
}

/**
 * @param {*} value
 * @param {string} path
 * @returns {Result<string>}
 */
function uuidResult(value, path) {
  return typeof value === 'string' && UUID.test(value)
    ? { ok: true, value }
    : failure('invalid-id', 'Expected a canonical UUID string.', path);
}

/**
 * @param {*} value
 * @param {string} path
 * @param {{ nullable?: boolean }} [options]
 * @returns {Result<string | null>}
 */
function instantResult(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return { ok: true, value };
  return isIsoInstant(value) ? { ok: true, value } : failure('invalid-timestamp', 'Expected a UTC ISO timestamp.', path);
}

// The two answers are told apart: text that is no date at all, and a date spelling naming no day of any month.
/**
 * @param {*} value
 * @param {string} path
 * @returns {Result<string>}
 */
function dateResult(value, path) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return failure('invalid-date', 'Expected an explicit YYYY-MM-DD date.', path);
  return dateParts(value) ? { ok: true, value } : failure('invalid-date', 'Expected a real calendar date.', path);
}

/**
 * @param {*} value
 * @param {string} path
 * @returns {Result<string>}
 */
function urlResult(value, path) {
  const bounded = stringResult(value, path, LIMITS.url);
  if (!bounded.ok) return bounded;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    return { ok: true, value };
  } catch {
    return failure('invalid-url', 'Expected an HTTP or HTTPS URL.', path);
  }
}

/**
 * @param {Record<string, any>} record
 * @param {string} key
 * @param {string} path
 * @returns {Result<string | undefined>}
 */
function optionalUrl(record, key, path) {
  return OWN(record, key) ? urlResult(record[key], `${path}.${key}`) : { ok: true, value: undefined };
}

/**
 * @param {*} value
 * @param {Set<*>} allowed
 * @param {string} path
 * @returns {Result<any>}
 */
function enumResult(value, allowed, path) {
  return allowed.has(value)
    ? { ok: true, value }
    : failure('invalid-enum', 'Value is outside the allowed set.', path);
}

/**
 * @param {*} value
 * @param {string} path
 * @param {number} maximum
 * @returns {Result<any[]>}
 */
function arrayResult(value, path, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    return failure('collection-limit', `Expected an array with at most ${maximum} entries.`, path);
  }
  return { ok: true, value };
}

/**
 * @param {*} value
 * @param {string} path
 * @returns {Result<Money>}
 */
function moneyResult(value, path) {
  const result = validateMoney(value);
  if (result.ok) return result;
  return { ok: false, error: { ...result.error, path } };
}

/**
 * @param {Record<string, any>} record
 * @param {string} key
 * @param {string} path
 * @returns {Result<number | undefined>}
 */
function bpsResult(record, key, path) {
  if (!OWN(record, key)) return { ok: true, value: undefined };
  return integerResult(record[key], `${path}.${key}`, { minimum: 0, maximum: 10000 });
}

/**
 * @param {*} value
 * @param {string} path
 * @returns {Result<AuctionContext>}
 */
function auctionContextResult(value, path) {
  const object = objectResult(value, path); if (!object.ok) return object;
  return firstFailure(
    urlResult(value.pageUrl, `${path}.pageUrl`), optionalUrl(value, 'canonicalUrl', path),
    optionalString(value, 'house', path, LIMITS.shortText), optionalString(value, 'saleId', path, LIMITS.shortText),
    optionalString(value, 'lotNumber', path, LIMITS.shortText),
  );
}

// One saved house preset: its name, its premium, and what it may carry beside it - the VAT it adds to
// that premium, a platform's fee on the hammer and the increment ladder copied from its terms. Each of
// those is optional, so a preset saved before it existed needs no migration step of its own. Settings
// reads house presets pasted from another browser with the same rule.
/**
 * @param {*} preset
 * @param {string} path
 * @returns {Result<any>}
 */
function housePresetResult(preset, path) {
  const object = objectResult(preset, path); if (!object.ok) return object;
  return firstFailure(
    stringResult(preset.name, `${path}.name`, LIMITS.shortText),
    integerResult(preset.buyerPremiumBps, `${path}.buyerPremiumBps`, { maximum: 10000 }),
    bpsResult(preset, 'premiumVatBps', path), bpsResult(preset, 'platformFeeBps', path),
    OWN(preset, 'incrementLadder')
      ? validateIncrementLadder(preset.incrementLadder, `${path}.incrementLadder`)
      : { ok: true, value: undefined },
  );
}

export {
  OWN, arrayResult, auctionContextResult, bpsResult, housePresetResult, dateResult, enumResult, firstFailure, instantResult, integerResult,
  isObject, moneyResult, objectResult, optionalString, optionalUrl, stringResult, urlResult, uuidResult,
};
