// @ts-check
import { CURRENCIES, UNSUPPORTED_CURRENCY_MESSAGE, validateMoney } from './money.js';
import { UUID, failure, isIsoDate, isIsoInstant, stableUuid, stripTracking } from './validate.js';
/**
 * @typedef {import('./types.js').Money} Money
 * @typedef {import('./types.js').SaleObservation} SaleObservation
 * @typedef {import('./types.js').SaleEvidence} SaleEvidence
 */
/**
 * @template T
 * @typedef {import('./types.js').Result<T>} Result
 */
/**
 * What a median is asked for: one currency, a date window, and the sources to count.
 * @typedef {object} StatisticsFilters
 * @property {string} currency
 * @property {string} fromDate
 * @property {string} toDate
 * @property {string[]} sources
 */
/**
 * A median and its quartiles over the included rows (three or more), with every row left out and why.
 * @typedef {object} Statistics
 * @property {{ code: string, message: string, path: string } | null} validationError
 * @property {string | null} currency
 * @property {'hammer'} priceBasis
 * @property {{ fromDate: string | null, toDate: string | null }} dateWindow
 * @property {string[]} sources
 * @property {number} count
 * @property {Money | null} median
 * @property {Money | null} lowerQuartile
 * @property {Money | null} upperQuartile
 * @property {string[]} includedIds
 * @property {Array<{ id: string, reason: string }>} excluded
 * @property {{ availableSources: string[], unavailableSources: string[], conflicts: number,
 *   exclusionCounts: Record<string, number>, incomplete: boolean }} coverage
 * @property {{ queryIds: string[], retrievedAt: string[] }} provenance
 * @property {{ eligible: boolean, label: string }} presentation
 */

const SOURCES = Object.freeze(['coinarchives', 'acsearch', 'manual', 'authorized-import']);
const SOURCE_SET = new Set(SOURCES);
const DATA_CLASSES = new Set(['collector', 'authorized']);
const PRICE_BASES = new Set(['hammer', 'hammer-plus-bp', 'estimate', 'unsold', 'missing']);
const CONFLICT_FIELD_ORDER = [
  'houseSaleId', 'auctionHouse', 'auctionName', 'auctionDate', 'lotNumber',
  'amount', 'currency', 'priceBasis',
];
const EXCLUSION_REASONS = new Set([
  'duplicate', 'currency', 'date', 'source-filter', 'not-comparable', 'conflict',
  'estimate', 'unsold', 'missing-price', 'collector-excluded',
]);

const normalizedIdentity = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

function requiredText(value, path) {
  return typeof value === 'string' && value.trim() ? null : failure('invalid-observation', 'A required evidence field is missing.', path);
}

/**
 * @param {*} observation
 * @param {number} index
 * @param {{ requireUuid?: boolean }} [options]
 * @returns {Result<SaleObservation>}
 */
function validateObservation(observation, index, options = {}) {
  const base = `observations[${index}]`;
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return failure('invalid-observation', 'Sale observation must be an object.', base);
  }
  for (const field of ['id', 'queryId', 'auctionHouse', 'lotNumber']) {
    const invalid = requiredText(observation[field], `${base}.${field}`);
    if (invalid) return invalid;
  }
  if (options.requireUuid && (!UUID.test(observation.id) || !UUID.test(observation.queryId))) {
    return failure('invalid-id', 'Durable observation and query IDs must be UUID strings.', `${base}.id`);
  }
  for (const field of ['id', 'queryId', 'sourceRecordId', 'houseSaleId', 'auctionHouse', 'auctionName', 'lotNumber']) {
    if (observation[field] !== undefined && (typeof observation[field] !== 'string' || observation[field].length > 500)) {
      return failure('invalid-observation', 'Evidence text fields are limited to 500 characters.', `${base}.${field}`);
    }
  }
  if (observation.queryLabel !== undefined && (typeof observation.queryLabel !== 'string'
      || !observation.queryLabel || observation.queryLabel !== observation.queryLabel.trim()
      || observation.queryLabel.length > 400 || /[\u0000-\u001f\u007f]/.test(observation.queryLabel))) {
    return failure('invalid-observation', 'Query label must be 1–400 trimmed characters without controls.', `${base}.queryLabel`);
  }
  if (!SOURCE_SET.has(observation.source)) {
    return failure('invalid-source', 'Evidence source is not supported.', `${base}.source`);
  }
  if (!DATA_CLASSES.has(observation.dataClass)) {
    return failure('invalid-data-class', 'Evidence data must be collector or authorized.', `${base}.dataClass`);
  }
  if (!isIsoInstant(observation.retrievedAt)) {
    return failure('invalid-instant', 'Retrieval time must be an ISO timestamp.', `${base}.retrievedAt`);
  }
  if (!isIsoDate(observation.auctionDate)) {
    return failure('invalid-date', 'Auction date must use YYYY-MM-DD.', `${base}.auctionDate`);
  }
  if (!PRICE_BASES.has(observation.priceBasis)) {
    return failure('invalid-price-basis', 'Evidence price basis is not supported.', `${base}.priceBasis`);
  }
  if (observation.sourceUrl !== undefined) {
    if (typeof observation.sourceUrl !== 'string' || observation.sourceUrl.length > 4096) {
      return failure('invalid-url', 'Source URL must be a bounded HTTPS URL.', `${base}.sourceUrl`);
    }
    const normalized = normalizeSourceUrl(observation.sourceUrl);
    if (!normalized.ok) return { ...normalized, error: { ...normalized.error, path: `${base}.sourceUrl` } };
  }
  if (observation.houseSaleIdMapping !== undefined) {
    const mapping = observation.houseSaleIdMapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)
        || typeof mapping.providerRecordId !== 'string' || !mapping.providerRecordId.trim()
        || typeof mapping.houseSaleId !== 'string' || !mapping.houseSaleId.trim()
        || typeof mapping.basis !== 'string' || !mapping.basis.trim()
        || normalizedIdentity(mapping.houseSaleId) !== normalizedIdentity(observation.houseSaleId ?? '')) {
      return failure('invalid-house-sale-mapping', 'Provider mapping must retain the provider record, matching house sale ID, and basis.', `${base}.houseSaleIdMapping`);
    }
  }
  if (observation.amount !== undefined) {
    const money = validateMoney(observation.amount);
    if (!money.ok) return { ...money, error: { ...money.error, path: `${base}.amount${money.error.path ? `.${money.error.path}` : ''}` } };
  } else if (['hammer', 'hammer-plus-bp', 'estimate'].includes(observation.priceBasis)) {
    return failure('missing-price', 'This price basis requires an amount.', `${base}.amount`);
  }
  return { ok: true, value: observation };
}

/**
 * @param {*} value
 * @returns {Result<string>}
 */
export function normalizeSourceUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return failure('invalid-url', 'Source URL must be a non-empty HTTPS URL.', 'url');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return failure('invalid-url', 'Source URL must be a valid HTTPS URL.', 'url');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return failure('invalid-url', 'Source URL must use HTTPS without embedded credentials.', 'url');
  }
  stripTracking(url);
  return { ok: true, value: url.href };
}

/**
 * The key two observations of the same sale share, or a failure when the house, its sale ID or the lot
 * number is missing.
 * @param {*} observation
 * @returns {Result<string>}
 */
export function sameEventKey(observation) {
  if (!observation || typeof observation !== 'object') {
    return failure('invalid-observation', 'Sale observation must be an object.', 'observation');
  }
  const fields = ['auctionHouse', 'houseSaleId', 'lotNumber'];
  if (fields.some((field) => typeof observation[field] !== 'string' || !observation[field].trim())) {
    return failure(
      'weak-sale-identity',
      'Deduplication requires auction house, house-issued sale ID, and lot number.',
      'houseSaleId',
    );
  }
  return {
    ok: true,
    value: JSON.stringify(fields.map((field) => normalizedIdentity(observation[field]))),
  };
}

function uniqueNormalized(observations, field) {
  return new Set(observations.flatMap((item) => {
    const value = item[field];
    return typeof value === 'string' && value.trim() ? [normalizedIdentity(value)] : [];
  }));
}

function conflictFields(observations) {
  const conflicts = new Set();
  for (const field of ['houseSaleId', 'auctionHouse', 'auctionName', 'auctionDate', 'lotNumber']) {
    if (uniqueNormalized(observations, field).size > 1) conflicts.add(field);
  }
  const amounts = new Set(observations.map((item) => item.amount ? `${item.amount.currency}:${item.amount.minor}` : 'missing'));
  const currencies = new Set(observations.map((item) => item.amount?.currency ?? 'missing'));
  const bases = new Set(observations.map((item) => item.priceBasis));
  if (amounts.size > 1) conflicts.add('amount');
  if (currencies.size > 1) conflicts.add('currency');
  if (bases.size > 1) conflicts.add('priceBasis');
  return CONFLICT_FIELD_ORDER.filter((field) => conflicts.has(field));
}

function exclusionForBasis(observations) {
  const bases = new Set(observations.map((item) => item.priceBasis));
  if (bases.has('estimate')) return 'estimate';
  if (bases.has('unsold')) return 'unsold';
  if (bases.has('missing')) return 'missing-price';
  return 'not-comparable';
}

/**
 * @param {SaleObservation[]} group
 * @param {string | null} key
 * @returns {SaleEvidence}
 */
function makeEvidence(group, key) {
  const first = group[0];
  const conflicts = conflictFields(group);
  const collectorExcluded = group.find((item) => item.collectorExcluded === true);
  const dataClass = group.some((item) => item.dataClass === 'collector') ? 'collector' : 'authorized';
  /** @type {SaleEvidence} */
  const row = {
    // The `live:` prefix is what every stored row's ID was derived through, so it stays.
    id: stableUuid(`live:${key ?? first.id}`),
    dataClass,
    ...(key ? {
      saleIdentity: {
        auctionHouse: first.auctionHouse.trim().replace(/\s+/g, ' '),
        // A key is only ever made from a house sale ID (sameEventKey), so there is one here.
        houseSaleId: /** @type {string} */ (first.houseSaleId).trim().replace(/\s+/g, ' '),
        lotNumber: first.lotNumber.trim().replace(/\s+/g, ' '),
      },
    } : {}),
    observations: [...group],
    inclusion: 'included',
  };
  if (collectorExcluded) {
    row.inclusion = 'excluded';
    row.exclusionReason = collectorExcluded.collectorExclusionReason || 'collector-excluded';
    return row;
  }
  if (conflicts.length) {
    row.inclusion = 'excluded';
    row.exclusionReason = 'conflict';
    row.conflictFields = conflicts;
    return row;
  }
  if (group.every((item) => item.priceBasis === 'hammer')) {
    row.resolved = {
      priceBasis: 'hammer',
      // A hammer observation always carries its amount (validateObservation).
      hammer: { .../** @type {Money} */ (first.amount) },
      resolution: 'source-agreement',
    };
    return row;
  }
  row.inclusion = 'excluded';
  row.exclusionReason = exclusionForBasis(group);
  return row;
}

/**
 * @param {*} value
 * @returns {Result<SaleEvidence>}
 */
export function validateSaleEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid-evidence', 'Sale evidence must be an object.', 'evidence');
  if (typeof value.id !== 'string' || !value.id || !UUID.test(value.id)) {
    return failure('invalid-id', 'Durable sale evidence ID must be a UUID string.', 'evidence.id');
  }
  if (!DATA_CLASSES.has(value.dataClass)) {
    return failure('invalid-data-class', 'Evidence data class is not supported.', 'evidence.dataClass');
  }
  if (!Array.isArray(value.observations) || value.observations.length === 0 || value.observations.length > 50) {
    return failure('invalid-observations', 'Sale evidence must retain 1 through 50 observations.', 'evidence.observations');
  }
  const seen = new Set();
  for (let index = 0; index < value.observations.length; index += 1) {
    const checked = validateObservation(value.observations[index], index, { requireUuid: true });
    if (!checked.ok) return checked;
    if (seen.has(value.observations[index].id)) return failure('duplicate-observation-id', 'Observation IDs must be unique.', `observations[${index}].id`);
    seen.add(value.observations[index].id);
  }
  const derivedDataClass = value.observations.some((item) => item.dataClass === 'collector') ? 'collector' : 'authorized';
  if (value.dataClass !== derivedDataClass) return failure('invalid-data-class', 'Evidence data class must reflect its retained observations.', 'evidence.dataClass');

  if (value.saleIdentity !== undefined) {
    if (!value.saleIdentity || typeof value.saleIdentity !== 'object' || Array.isArray(value.saleIdentity)) {
      return failure('invalid-sale-identity', 'Sale identity must be an object.', 'evidence.saleIdentity');
    }
    const identityKey = sameEventKey(value.saleIdentity);
    if (!identityKey.ok) return { ...identityKey, error: { ...identityKey.error, path: 'evidence.saleIdentity' } };
    for (let index = 0; index < value.observations.length; index += 1) {
      const observationKey = sameEventKey(value.observations[index]);
      if (!observationKey.ok || observationKey.value !== identityKey.value) {
        return failure('invalid-sale-identity', 'Every grouped observation must match the retained sale identity.', `evidence.observations[${index}]`);
      }
    }
  } else if (value.observations.length > 1) {
    return failure('weak-sale-identity', 'Evidence without a strong sale identity cannot merge observations.', 'evidence.saleIdentity');
  }

  if (!['included', 'excluded'].includes(value.inclusion)) return failure('invalid-inclusion', 'Evidence inclusion must be included or excluded.', 'evidence.inclusion');
  if (value.conflictFields !== undefined) {
    if (!Array.isArray(value.conflictFields) || value.conflictFields.length === 0
        || new Set(value.conflictFields).size !== value.conflictFields.length
        || value.conflictFields.some((field) => !CONFLICT_FIELD_ORDER.includes(field))) {
      return failure('invalid-conflicts', 'Conflict fields must be a non-empty unique list of supported fields.', 'evidence.conflictFields');
    }
  }
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 2000)) {
    return failure('invalid-notes', 'Evidence notes are limited to 2,000 characters.', 'evidence.notes');
  }

  if (value.resolved !== undefined) {
    const resolved = value.resolved;
    if (!resolved || typeof resolved !== 'object' || resolved.priceBasis !== 'hammer'
        || !['source-agreement', 'collector-selected-observation', 'collector-entered'].includes(resolved.resolution)) {
      return failure('invalid-resolution', 'Resolved evidence must identify a supported hammer resolution.', 'evidence.resolved');
    }
    const money = validateMoney(resolved.hammer);
    if (!money.ok) return { ...money, error: { ...money.error, path: `evidence.resolved.hammer${money.error.path ? `.${money.error.path}` : ''}` } };
    if (resolved.resolvedAt !== undefined && !isIsoInstant(resolved.resolvedAt)) {
      return failure('invalid-instant', 'Resolution time must be a canonical ISO timestamp.', 'evidence.resolved.resolvedAt');
    }
    if (resolved.resolution === 'source-agreement') {
      const agrees = value.observations.every((item) => item.priceBasis === 'hammer'
        && item.amount?.currency === resolved.hammer.currency
        && item.amount?.minor === resolved.hammer.minor);
      if (!agrees || conflictFields(value.observations).length || value.conflictFields?.length) {
        return failure('invalid-resolution', 'Source-agreement hammer must match every observation without conflicts.', 'evidence.resolved');
      }
    }
    if (resolved.resolution === 'collector-selected-observation') {
      if (typeof resolved.observationId !== 'string') return failure('invalid-resolution', 'Selected-observation resolution must retain observationId.', 'evidence.resolved.observationId');
      const selected = value.observations.find((item) => item.id === resolved.observationId);
      if (!selected || selected.priceBasis !== 'hammer'
          || selected.amount?.currency !== resolved.hammer.currency
          || selected.amount?.minor !== resolved.hammer.minor) {
        return failure('invalid-resolution', 'Selected-observation hammer must match the retained observation.', 'evidence.resolved.observationId');
      }
    }
  }

  if (value.inclusion === 'included') {
    if (!value.resolved) return failure('missing-resolution', 'Included evidence requires a resolved hammer.', 'evidence.resolved');
    if (value.exclusionReason !== undefined) return failure('invalid-inclusion', 'Included evidence cannot retain an exclusion reason.', 'evidence.exclusionReason');
  } else if (!EXCLUSION_REASONS.has(value.exclusionReason)) {
    return failure('invalid-exclusion', 'Excluded evidence requires a supported reason.', 'evidence.exclusionReason');
  }
  if (value.exclusionReason === 'conflict' && !value.conflictFields?.length) {
    return failure('invalid-conflicts', 'Conflict exclusion requires conflict fields.', 'evidence.conflictFields');
  }
  return { ok: true, value };
}

/**
 * @param {*} observations
 * @returns {Result<{ evidence: SaleEvidence[], mergedObservationIds: string[], conflicts: string[] }>}
 */
export function deduplicateEvidence(observations) {
  if (!Array.isArray(observations)) return failure('invalid-observations', 'Evidence observations must be an array.', 'observations');
  const seenIds = new Set();
  for (let index = 0; index < observations.length; index += 1) {
    const checked = validateObservation(observations[index], index);
    if (!checked.ok) return checked;
    if (seenIds.has(observations[index].id)) return failure('duplicate-observation-id', 'Observation IDs must be unique.', `observations[${index}].id`);
    seenIds.add(observations[index].id);
  }

  const groups = new Map();
  for (const observation of observations) {
    const keyResult = sameEventKey(observation);
    const groupKey = keyResult.ok ? `live:${keyResult.value}` : `weak:${observation.id}`;
    const group = groups.get(groupKey) ?? { key: keyResult.ok ? keyResult.value : null, observations: [] };
    group.observations.push(observation);
    groups.set(groupKey, group);
  }

  const evidence = [];
  const mergedObservationIds = [];
  const conflicts = [];
  for (const group of groups.values()) {
    const row = makeEvidence(group.observations, group.key);
    evidence.push(row);
    mergedObservationIds.push(...group.observations.slice(1).map((item) => item.id));
    if (row.exclusionReason === 'conflict') conflicts.push(row.id);
  }
  return { ok: true, value: { evidence, mergedObservationIds, conflicts } };
}

/**
 * @param {*} filters
 * @param {{ code: string, message: string, path: string } | null} [validationError]
 * @returns {Statistics}
 */
function emptyStatistics(filters, validationError = null) {
  const sources = Array.isArray(filters?.sources) ? [...filters.sources] : [];
  return {
    validationError,
    currency: CURRENCIES.includes(filters?.currency) ? filters.currency : null,
    priceBasis: 'hammer',
    dateWindow: { fromDate: filters?.fromDate ?? null, toDate: filters?.toDate ?? null },
    sources,
    count: 0,
    median: null,
    lowerQuartile: null,
    upperQuartile: null,
    includedIds: [],
    excluded: [],
    coverage: { availableSources: [], unavailableSources: sources, conflicts: 0, exclusionCounts: {}, incomplete: sources.length > 0 },
    provenance: { queryIds: [], retrievedAt: [] },
    presentation: { eligible: false, label: 'Insufficient evidence' },
  };
}

function validateFilters(filters) {
  if (!filters || typeof filters !== 'object') return { code: 'invalid-filters', message: 'Statistics filters are required.', path: 'filters' };
  if (!CURRENCIES.includes(filters.currency)) return { code: 'invalid-currency', message: UNSUPPORTED_CURRENCY_MESSAGE, path: 'filters.currency' };
  if (!isIsoDate(filters.fromDate)) return { code: 'invalid-date', message: 'Start date must use YYYY-MM-DD.', path: 'filters.fromDate' };
  if (!isIsoDate(filters.toDate)) return { code: 'invalid-date', message: 'End date must use YYYY-MM-DD.', path: 'filters.toDate' };
  if (filters.fromDate > filters.toDate) return { code: 'invalid-date-range', message: 'Start date must not follow end date.', path: 'filters.dateRange' };
  if (!Array.isArray(filters.sources) || filters.sources.length === 0 || filters.sources.some((source) => !SOURCE_SET.has(source))) {
    return { code: 'invalid-sources', message: 'Choose at least one supported source.', path: 'filters.sources' };
  }
  return null;
}

function roundedMedian(sorted) {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Number((BigInt(sorted[middle - 1]) + BigInt(sorted[middle]) + 1n) / 2n);
}

function basisReason(row) {
  if (row.exclusionReason) return row.exclusionReason;
  const bases = new Set((row.observations ?? []).map((item) => item.priceBasis));
  if (bases.size > 1) return 'conflict';
  if (bases.has('estimate')) return 'estimate';
  if (bases.has('unsold')) return 'unsold';
  if (bases.has('missing')) return 'missing-price';
  return 'not-comparable';
}

/**
 * @param {*} evidence
 * @param {*} filters
 * @returns {Statistics}
 */
export function computeStatistics(evidence, filters) {
  const invalidFilters = validateFilters(filters);
  if (invalidFilters) return emptyStatistics(filters, invalidFilters);
  if (!Array.isArray(evidence)) return emptyStatistics(filters, { code: 'invalid-evidence', message: 'Evidence must be an array.', path: 'evidence' });

  const result = emptyStatistics(filters);
  const selectedSources = new Set(filters.sources);
  const observedSelectedSources = new Set();
  const included = [];
  const queryIds = new Set();
  const retrievedAt = new Set();

  for (const row of evidence) {
    const observations = Array.isArray(row?.observations) ? row.observations : [];
    for (const item of observations) {
      if (typeof item.queryId === 'string' && item.queryId) queryIds.add(item.queryId);
      if (isIsoInstant(item.retrievedAt)) retrievedAt.add(item.retrievedAt);
      if (selectedSources.has(item.source)) observedSelectedSources.add(item.source);
    }

    let reason = null;
    const selectedResolutionObservation = row?.resolved?.resolution === 'collector-selected-observation'
      ? observations.find((item) => item.id === row.resolved.observationId)
      : null;
    const filterObservations = selectedResolutionObservation ? [selectedResolutionObservation] : observations;
    if (!row || typeof row.id !== 'string' || !row.id) reason = 'invalid-evidence';
    else if (row.inclusion === 'excluded') reason = basisReason(row);
    else if (row.resolved?.resolution === 'collector-selected-observation' && !selectedResolutionObservation) reason = 'conflict';
    else if (!filterObservations.some((item) => selectedSources.has(item.source))) reason = 'source-filter';
    else if (!filterObservations.length || filterObservations.some((item) => item.auctionDate < filters.fromDate || item.auctionDate > filters.toDate)) reason = 'date';
    else if (!row.resolved || row.resolved.priceBasis !== 'hammer') reason = basisReason(row);
    else {
      const money = validateMoney(row.resolved.hammer);
      if (!money.ok) reason = 'missing-price';
      else if (selectedResolutionObservation
          && (selectedResolutionObservation.priceBasis !== 'hammer'
            || selectedResolutionObservation.amount?.currency !== row.resolved.hammer.currency
            || selectedResolutionObservation.amount?.minor !== row.resolved.hammer.minor)) reason = 'conflict';
      else if (row.resolved.hammer.currency !== filters.currency) reason = 'currency';
    }

    if (reason) result.excluded.push({ id: row?.id ?? '', reason });
    else {
      included.push(row);
      result.includedIds.push(row.id);
    }
  }

  result.count = included.length;
  result.provenance.queryIds = [...queryIds].sort();
  result.provenance.retrievedAt = [...retrievedAt].sort();
  result.coverage.availableSources = filters.sources.filter((source) => observedSelectedSources.has(source));
  result.coverage.unavailableSources = filters.sources.filter((source) => !observedSelectedSources.has(source));
  result.coverage.conflicts = evidence.filter((row) => row?.exclusionReason === 'conflict' || row?.conflictFields?.length).length;
  for (const item of result.excluded) result.coverage.exclusionCounts[item.reason] = (result.coverage.exclusionCounts[item.reason] ?? 0) + 1;
  result.coverage.incomplete = result.excluded.length > 0 || result.coverage.unavailableSources.length > 0;

  if (included.length >= 3) {
    const sorted = included.map((row) => row.resolved.hammer.minor).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const lower = sorted.slice(0, middle);
    const upper = sorted.slice(sorted.length % 2 ? middle + 1 : middle);
    result.median = { currency: filters.currency, minor: roundedMedian(sorted) };
    result.lowerQuartile = { currency: filters.currency, minor: roundedMedian(lower) };
    result.upperQuartile = { currency: filters.currency, minor: roundedMedian(upper) };
    result.presentation = {
      eligible: true,
      label: included.length < 5 ? 'Limited evidence' : 'Evidence-backed',
    };
  }
  return result;
}
