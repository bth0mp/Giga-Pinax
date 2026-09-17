import { SCHEMA_VERSION, migrateSnapshot, validateSnapshot } from './records.js';
import { sameEventKey } from './evidence.js';

export const BACKUP_FORMAT = 'ancient-coin-auction-companion';
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const COLLECTIONS = [
  'lots', 'auctionEvents', 'alternativeGroups', 'evidence',
  'collectionEntries', 'alerts',
];
const fail = (code, message, path) => ({ ok: false, error: { code, message, ...(path ? { path } : {}) } });

function clone(value) {
  return structuredClone(value);
}

function bytes(value) {
  return new TextEncoder().encode(value).length;
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function exportableSnapshot(snapshot) {
  const data = clone(snapshot);
  data.recentCommands = [];
  data.drafts = [];
  return data;
}

export function exportBackup(snapshot, now) {
  if (!canonicalInstant(now)) return fail('invalid-timestamp', 'Export time must be a canonical UTC timestamp.', 'exportedAt');
  const data = exportableSnapshot(snapshot);
  const valid = validateSnapshot(data);
  if (!valid.ok) return fail('invalid-snapshot', valid.error.message, `data.${valid.error.path ?? ''}`);
  const document = JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    data,
  }, null, 2);
  if (bytes(document) > MAX_BACKUP_BYTES) return fail('file-too-large', 'Backup exceeds the 5 MiB limit.');
  return { ok: true, value: document };
}

export function validateBackup(document) {
  let value = document;
  if (typeof document === 'string') {
    if (bytes(document) > MAX_BACKUP_BYTES) return fail('file-too-large', 'Backup exceeds the 5 MiB limit.');
    try { value = JSON.parse(document); } catch { return fail('invalid-json', 'Backup is not valid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid-document', 'Backup must be an object.');
  if (value.format !== BACKUP_FORMAT) return fail('invalid-format', 'Backup format is not recognized.', 'format');
  if (value.schemaVersion !== SCHEMA_VERSION) return fail('unsupported-schema', 'Backup schema version is unsupported.', 'schemaVersion');
  if (!canonicalInstant(value.exportedAt)) return fail('invalid-timestamp', 'Export time is invalid.', 'exportedAt');
  const data = migrateSnapshot(clone(value.data));
  if (!data || typeof data !== 'object') return fail('invalid-document', 'Backup data is missing.', 'data');
  if (Array.isArray(data.recentCommands) && data.recentCommands.length) {
    return fail('private-ledger', 'Backup must not contain recent request IDs.', 'data.recentCommands');
  }
  data.recentCommands = [];
  data.drafts = [];
  const valid = validateSnapshot(data);
  if (!valid.ok) return fail(valid.error.code, valid.error.message, `data.${valid.error.path ?? ''}`);
  return { ok: true, value: data };
}

function counts(snapshot) {
  return Object.fromEntries(COLLECTIONS.map((key) => [key, snapshot[key].length]));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evidenceBody(row) {
  const body = clone(row);
  for (const key of ['id', 'revision', 'createdAt', 'updatedAt']) delete body[key];
  return body;
}

export function previewImport(current, incoming, mode) {
  const currentValid = validateSnapshot(current);
  if (!currentValid.ok) return fail('invalid-current', currentValid.error.message, currentValid.error.path);
  const incomingValid = validateSnapshot(incoming);
  if (!incomingValid.ok) return fail('invalid-incoming', incomingValid.error.message, incomingValid.error.path);
  if (mode !== 'merge' && mode !== 'replace') return fail('invalid-mode', 'Import mode must be merge or replace.', 'mode');
  const summary = { outgoing: counts(current), incoming: counts(incoming) };
  if (mode === 'replace') {
    const snapshot = exportableSnapshot(incoming);
    return { ok: true, value: { mode, counts: summary, conflicts: [], snapshot, requiresConfirmation: true } };
  }

  const snapshot = clone(current);
  snapshot.recentCommands = [];
  const conflicts = [];
  for (const key of COLLECTIONS) {
    const byId = new Map(snapshot[key].map((record) => [record.id, record]));
    const evidenceBySale = key === 'evidence'
      ? new Map(snapshot.evidence.flatMap((row) => {
        const sale = row.saleIdentity ? sameEventKey(row.saleIdentity) : null;
        return sale?.ok ? [[sale.value, row]] : [];
      }))
      : null;
    for (const record of incoming[key]) {
      const existing = byId.get(record.id);
      if (!existing) {
        if (evidenceBySale && record.saleIdentity) {
          const sale = sameEventKey(record.saleIdentity);
          const sameSale = sale.ok ? evidenceBySale.get(sale.value) : null;
          if (sameSale) {
            if (!equal(evidenceBody(sameSale), evidenceBody(record))) {
              conflicts.push({ collection: key, id: record.id, reason: 'same-sale-collision' });
            }
            continue;
          }
        }
        const copied = clone(record);
        snapshot[key].push(copied);
        byId.set(record.id, copied);
        if (evidenceBySale && record.saleIdentity) {
          const sale = sameEventKey(record.saleIdentity);
          if (sale.ok) evidenceBySale.set(sale.value, copied);
        }
      } else if (!equal(existing, record)) {
        conflicts.push({ collection: key, id: record.id, reason: 'stable-id-collision' });
      }
    }
  }
  if (current.preferences === null) snapshot.preferences = clone(incoming.preferences);
  else if (incoming.preferences !== null && !equal(current.preferences, incoming.preferences)) {
    conflicts.push({ collection: 'preferences', id: 'preferences', reason: 'settings-collision' });
  }
  if (conflicts.length) {
    return { ok: true, value: { mode, counts: summary, conflicts, snapshot: null, requiresConfirmation: true } };
  }
  const valid = validateSnapshot(snapshot);
  if (!valid.ok) return fail('merge-invalid', valid.error.message, valid.error.path);
  return { ok: true, value: { mode, counts: summary, conflicts, snapshot, requiresConfirmation: true } };
}
