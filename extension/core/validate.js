// The checks and shapes the rest of the extension shares: one spelling of a failed result, one calendar, one UUID
// pattern, one hash. It imports nothing, so any module may reach for it without risking a cycle.

// Text as every table and search here compares it: each run of whitespace one space, the ends trimmed.
export const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// A failed result: the code and the message always, the path only where the caller names one, and whatever else that
// caller carries with a failure (store.js reports the lot an identity collided with).
export const failure = (code, message, path, extra) =>
  ({ ok: false, error: { code, message, ...(path === undefined ? {} : { path }), ...extra } });

export const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

// Copying, measuring and walking a record are all recursive, so an object nested thousands of levels
// deep - which nothing here writes, and only a hand-made or damaged file carries - runs the stack out
// wherever it is first touched. The engines spell that differently: V8 throws a RangeError naming the
// call stack, SpiderMonkey an InternalError saying there was too much recursion, so both are read.
export const isRecursionError = (error) =>
  error instanceof RangeError || /call stack|too much recursion/i.test(String(error?.message ?? ''));

// Depth is a shape the data should not have, so it is reported where any other bad shape is.
export const TOO_DEEPLY_NESTED = 'This data is nested too deeply to be read. Records this deep are not written by Giga Pinax.';
export const tooDeeplyNested = (path) => failure('too-deeply-nested', TOO_DEEPLY_NESTED, path);

export const clone = (value) => structuredClone(value);

// Versions 1 through 8: a record this store did not mint is still a record, and the variant nibble is what says the
// identifier is an RFC 4122 UUID at all.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// [year, month, day] for a real calendar date written that way, else null: "2026-02-30" is spelled like a date and is
// not one, and the UTC round trip is what tells the two apart.
export function dateParts(value) {
  const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return probe.getUTCFullYear() === parts[0] && probe.getUTCMonth() === parts[1] - 1 && probe.getUTCDate() === parts[2]
    ? parts : null;
}

export const isIsoDate = (value) => dateParts(value) !== null;

// The date a whole number of days from this one, or null where this one is no date, or where the shift lands outside the
// range a Date holds: a crafted day count is the bound check's to refuse, not this arithmetic's to throw over.
export function shiftDate(value, days) {
  const parts = dateParts(value);
  const shifted = parts ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)) : null;
  return shifted !== null && Number.isFinite(shifted.valueOf()) ? shifted.toISOString().slice(0, 10) : null;
}

// A UTC instant exactly as toISOString writes it. The round trip settles the whole shape; the four leading digits are
// what keeps the expanded years (+275760-09-13) that no record here stores out.
export function isIsoInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

// The click-tracking parameters that name no lot: Google's, Microsoft's and Mailchimp's, plus every utm_ one. Stripped
// in place, so two links to the same lot compare equal whichever advertisement carried them.
const TRACKING = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid']);
export function stripTracking(url) {
  for (const key of [...url.searchParams.keys()]) {
    const name = key.toLowerCase();
    if (name.startsWith('utm_') || TRACKING.has(name)) url.searchParams.delete(key);
  }
  return url;
}

// FNV-1a over the string's code units, for identifiers derived from text rather than minted.
export function fnv32(value, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// A version 4 UUID that is the same every time for the same text: four FNV runs of different seeds, with the version
// and variant nibbles written in. Derived, never random, so the same evidence yields the same identifier on every device.
export function stableUuid(value) {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const chars = seeds.map((seed, index) => fnv32(`${index}:${value}`, seed).toString(16).padStart(8, '0')).join('').split('');
  chars[12] = '4';
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
