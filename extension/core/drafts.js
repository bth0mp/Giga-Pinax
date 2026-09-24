// A draft's payload: what a page, a highlight or a captured lot hands the workspace to confirm, held
// to the shape its kind allows before it is kept.
import {
  LIMITS, OWN, arrayResult, auctionContextResult, dateResult, enumResult, firstFailure, integerResult, objectResult,
  optionalString, optionalUrl, stringResult,
} from './fields.js';
import { failure } from './validate.js';

const DRAFT_KINDS = new Set(['research-highlight', 'current-lot', 'auction-capture']);

// What a lot page states about its own sale, kept on a current-lot draft until the collector confirms or clears it in the workspace. An estimate is
// the page's own figure in the page's own currency - any three-letter code, since nothing is converted and nothing is pooled - in that currency's
// minor units. A closing is a day, or a time only with the offset the page wrote beside it: a time with no offset names no zone, and none is
// invented for it.
const CLOSES_AT = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)))?$/;

function pageEstimateResult(value, path) {
  const object = objectResult(value, path); if (!object.ok) return object;
  const unexpected = Object.keys(value).find((key) => key !== 'minor' && key !== 'currency');
  if (unexpected) return failure('unexpected-field', 'Estimate contains an unsupported field.', `${path}.${unexpected}`);
  return firstFailure(
    integerResult(value.minor, `${path}.minor`, { minimum: 1 }),
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
      ? { ok: true, value: value.currency }
      : failure('invalid-currency', 'Expected a three-letter ISO currency code.', `${path}.currency`),
  );
}

function closesAtResult(value, path) {
  const match = typeof value === 'string' ? CLOSES_AT.exec(value) : null;
  return match && dateResult(match[1], path).ok
    ? { ok: true, value }
    : failure('invalid-date', 'Expected a YYYY-MM-DD date, or a date and time with its UTC offset.', path);
}

// The provenance a lot page lists, read into entries (lot.js readProvenance) for the collector to tick in the workspace: each keeps the words it
// was written in, with the source, year and lot the reader found in them.
function draftProvenanceResult(value, path) {
  const array = arrayResult(value, path, 10); if (!array.ok) return array;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index], entryPath = `${path}[${index}]`;
    const object = objectResult(entry, entryPath); if (!object.ok) return object;
    const unexpected = Object.keys(entry).find((key) => !['text', 'source', 'year', 'lot'].includes(key));
    if (unexpected) return failure('unexpected-field', 'Provenance entry contains an unsupported field.', `${entryPath}.${unexpected}`);
    const result = firstFailure(
      stringResult(entry.text, `${entryPath}.text`, 300),
      optionalString(entry, 'source', entryPath, LIMITS.shortText),
      OWN(entry, 'year') ? integerResult(entry.year, `${entryPath}.year`, { minimum: 1000, maximum: 2999 }) : { ok: true },
      optionalString(entry, 'lot', entryPath, 20),
    );
    if (!result.ok) return result;
  }
  return { ok: true, value };
}

export function validateDraftPayload(kind, payload, path = '') {
  const kindPath = path ? `${path}.kind` : 'kind';
  const payloadPath = path ? `${path}.payload` : 'payload';
  const kindResult = enumResult(kind, DRAFT_KINDS, kindPath);
  if (!kindResult.ok) return kindResult;
  const object = objectResult(payload, payloadPath);
  if (!object.ok) return object;

  const allowed = kind === 'current-lot'
    ? new Set(['target', 'title', 'reference', 'pageUrl', 'auctionContext', 'estimate', 'closesAt', 'startsAt', 'photoUrl', 'provenance'])
    : new Set(['rawText', 'pageUrl', 'auctionContext']);
  const unexpected = Object.keys(payload).find((key) => !allowed.has(key));
  if (unexpected) {
    return failure('unexpected-field', 'Draft payload contains an unsupported field.', `${payloadPath}.${unexpected}`);
  }

  if (kind === 'current-lot') {
    if (payload.target !== 'watchlist') {
      return failure('invalid-target', 'Current-lot drafts must target the watchlist.', `${payloadPath}.target`);
    }
    const fields = firstFailure(
      optionalString(payload, 'title', payloadPath, 200),
      optionalString(payload, 'reference', payloadPath, LIMITS.shortText),
      optionalString(payload, 'pageUrl', payloadPath, LIMITS.url),
      OWN(payload, 'auctionContext') ? auctionContextResult(payload.auctionContext, `${payloadPath}.auctionContext`) : { ok: true },
      OWN(payload, 'estimate') ? pageEstimateResult(payload.estimate, `${payloadPath}.estimate`) : { ok: true },
      OWN(payload, 'closesAt') ? closesAtResult(payload.closesAt, `${payloadPath}.closesAt`) : { ok: true },
      OWN(payload, 'startsAt') ? closesAtResult(payload.startsAt, `${payloadPath}.startsAt`) : { ok: true },
      optionalUrl(payload, 'photoUrl', payloadPath),
      OWN(payload, 'provenance') ? draftProvenanceResult(payload.provenance, `${payloadPath}.provenance`) : { ok: true },
    );
    return fields.ok ? { ok: true, value: payload } : fields;
  }

  const fields = firstFailure(
    optionalString(payload, 'rawText', payloadPath, 3000, { nonEmpty: false }),
    optionalString(payload, 'pageUrl', payloadPath, LIMITS.url, { nonEmpty: false }),
    OWN(payload, 'auctionContext') ? auctionContextResult(payload.auctionContext, `${payloadPath}.auctionContext`) : { ok: true },
  );
  return fields.ok ? { ok: true, value: payload } : fields;
}
