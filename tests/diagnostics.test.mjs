import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIAGNOSTICS_KEY, MAX_DIAGNOSTICS, clearDiagnostics, diagnosticEntry, diagnosticsText, fetchFailureFields,
  pageFromPath, readDiagnostics, recordDiagnostic, recordFetchFailure,
} from '../extension/core/diagnostics.js';
import { STORAGE_KEY, createCommandWriter } from '../extension/store.js';
import { createEmptySnapshot } from '../extension/core/records.js';
import { exportBackup } from '../extension/core/backup.js';

const NOW = '2026-09-24T10:00:00.000Z';

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  const calls = { get: 0, set: 0 };
  return {
    data,
    calls,
    async get(key) {
      calls.get += 1;
      return Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items) {
      calls.set += 1;
      Object.assign(data, structuredClone(items));
    },
  };
}

const options = (storage, extra = {}) => ({ storage, now: () => NOW, version: '0.34.0', page: 'popup', ...extra });

test('an entry keeps only the allowed fields, each checked against its own shape', () => {
  assert.deepEqual(
    diagnosticEntry({ area: 'acsearch', code: 'http', status: 503 }, { at: NOW, page: 'popup', version: '0.34.0' }),
    { at: NOW, page: 'popup', area: 'acsearch', code: 'http', status: 503, version: '0.34.0' },
  );
  assert.deepEqual(
    diagnosticEntry({ area: 'acsearch', code: 'too-large', bytes: 4194304 }, { at: NOW, page: 'workspace', version: '0.34.0' }),
    { at: NOW, page: 'workspace', area: 'acsearch', code: 'too-large', bytes: 4194304, version: '0.34.0' },
  );
  // A status outside the HTTP range is left out, however it is written.
  for (const status of [99, 600, 7e20, -503, 503.5, '503']) {
    assert.equal(diagnosticEntry({ area: 'lookup', code: 'http', status }, { at: NOW, page: 'popup', version: '0.34.0' }).status, undefined, String(status));
  }
  // An area outside the list is no entry at all; an unknown code, page or version is named as unknown.
  assert.equal(diagnosticEntry({ area: 'somewhere', code: 'http' }, { at: NOW }), null);
  assert.equal(diagnosticEntry(null, { at: NOW }), null);
  assert.deepEqual(
    diagnosticEntry({ area: 'store', code: 'Stored data is invalid: lots[3].title' }, { at: NOW, page: 'nowhere', version: 'v1 beta' }),
    { at: NOW, page: 'other', area: 'store', code: 'other', version: 'unknown' },
  );
});

// The one thing this buffer must never hold is what the collector was looking at.
test('hostile values never reach storage: no search term, reference, URL, record content or page text', async () => {
  const storage = fakeStorage();
  const secrets = [
    'RIC II 207', 'Hadrian denarius', 'https://www.acsearch.info/search.html?term=RIC+II+207', 'term=', 'q=',
    'Roma Numismatics', 'lot 312', 'page text of the auction', '<script>', '=HYPERLINK', 'secret-note',
  ];
  await recordDiagnostic({
    area: 'acsearch',
    page: 'popup<script>alert(1)</script>',
    code: '=HYPERLINK("https://evil.example/?q=RIC II 207")',
    status: '503 term=RIC II 207',
    bytes: 'Hadrian denarius',
    version: 'secret-note',
    at: '2020-01-01T00:00:00.000Z',
    term: 'RIC II 207',
    reference: 'RIC II 207',
    url: 'https://www.acsearch.info/search.html?term=RIC+II+207',
    query: 'q=RIC II 207',
    message: 'HTTP 503 for https://www.acsearch.info/search.html?term=RIC+II+207',
    title: 'Hadrian denarius',
    notes: 'secret-note',
    text: 'page text of the auction',
    record: { title: 'Roma Numismatics', lotNumber: 'lot 312' },
  }, options(storage, { version: 'secret-note', page: 'term=RIC' }));
  await recordFetchFailure('lookup', Object.assign(new Error('HTTP 404 https://numismatics.org/ocre/id/ric.2.hdn.207.jsonld?q=RIC II 207'), {
    status: 404, url: 'https://numismatics.org/ocre/id/ric.2.hdn.207.jsonld', term: 'RIC II 207',
  }), { reference: 'RIC II 207', bytes: 12 }, options(storage));

  const stored = storage.data[DIAGNOSTICS_KEY];
  assert.equal(stored.length, 2);
  const written = JSON.stringify(storage.data);
  for (const secret of secrets) assert.ok(!written.includes(secret), `stored diagnostics carry ${JSON.stringify(secret)}`);
  for (const entry of stored) {
    assert.deepEqual(Object.keys(entry).filter((key) => !['at', 'page', 'area', 'code', 'status', 'bytes', 'version'].includes(key)), []);
  }
  assert.deepEqual(stored[0], { at: NOW, page: 'other', area: 'acsearch', code: 'other', version: 'unknown' });
  assert.deepEqual(stored[1], { at: NOW, page: 'popup', area: 'lookup', code: 'http', status: 404, bytes: 12, version: '0.34.0' });
  const text = diagnosticsText(await readDiagnostics(options(storage)), { version: '0.34.0', now: NOW });
  for (const secret of secrets) assert.ok(!text.includes(secret), `the copied text carries ${JSON.stringify(secret)}`);
});

test('the buffer keeps the newest 50 entries in the order they happened', async () => {
  const storage = fakeStorage();
  for (let index = 0; index < MAX_DIAGNOSTICS + 7; index += 1) {
    await recordDiagnostic({ area: 'lookup', code: 'http', status: 400 + index }, options(storage));
  }
  const entries = await readDiagnostics(options(storage));
  assert.equal(entries.length, MAX_DIAGNOSTICS);
  assert.equal(entries[0].status, 407);
  assert.equal(entries.at(-1).status, 400 + MAX_DIAGNOSTICS + 6);
});

test('records made at once in one page are all kept, one after another', async () => {
  const storage = fakeStorage();
  await Promise.all(Array.from({ length: 5 }, (_, index) =>
    recordDiagnostic({ area: 'coinarchives', code: 'http', status: 500 + index }, options(storage))));
  assert.deepEqual((await readDiagnostics(options(storage))).map(({ status }) => status), [500, 501, 502, 503, 504]);
});

test('a write never throws into the caller, whatever storage does', async () => {
  const broken = {
    get: async () => { throw new Error('storage is gone'); },
    set: async () => { throw new Error('storage is full'); },
  };
  assert.equal(await recordDiagnostic({ area: 'lookup', code: 'network' }, options(broken)), false);
  const readOnly = { get: async () => ({}), set: () => { throw new Error('quota'); } };
  assert.equal(await recordDiagnostic({ area: 'lookup', code: 'network' }, options(readOnly)), false);
  const throwingGetter = { get storage() { throw new Error('no'); } };
  assert.equal(await recordDiagnostic({ area: 'lookup', code: 'network' }, throwingGetter), false);
  assert.equal(await recordDiagnostic(undefined, options(fakeStorage())), false);
  assert.equal(await recordFetchFailure('lookup', undefined, undefined, { now: () => { throw new Error('clock'); } }), false);
  // No extension storage at all (a test, or a page outside the extension) is a quiet no-op.
  assert.equal(await recordDiagnostic({ area: 'lookup', code: 'network' }), false);
  // A stored value that is not a list is replaced rather than trusted.
  const garbled = fakeStorage({ [DIAGNOSTICS_KEY]: { not: 'a list' } });
  assert.equal(await recordDiagnostic({ area: 'lookup', code: 'network' }, options(garbled)), true);
  assert.equal(garbled.data[DIAGNOSTICS_KEY].length, 1);
});

test('a fetch failure is described by its status or its kind, never by its message', () => {
  assert.deepEqual(fetchFailureFields({ status: 503 }), { code: 'http', status: 503 });
  assert.deepEqual(fetchFailureFields(new Error('too-large')), { code: 'too-large' });
  assert.deepEqual(fetchFailureFields(Object.assign(new Error('x'), { name: 'TimeoutError' })), { code: 'timeout' });
  assert.deepEqual(fetchFailureFields(Object.assign(new Error('x'), { name: 'AbortError' })), { code: 'aborted' });
  assert.deepEqual(fetchFailureFields(new SyntaxError('Unexpected token < in JSON')), { code: 'parse' });
  assert.deepEqual(fetchFailureFields(new TypeError('Failed to fetch')), { code: 'network' });
  assert.deepEqual(fetchFailureFields(undefined), { code: 'network' });
});

test('the page is read from the extension page that recorded it', () => {
  assert.equal(pageFromPath('/popup.html'), 'popup');
  assert.equal(pageFromPath('/workspace.html'), 'workspace');
  assert.equal(pageFromPath('/settings.html'), 'settings');
  assert.equal(pageFromPath('/background.js'), 'background');
  assert.equal(pageFromPath('/_generated_background_page.html'), 'background');
  assert.equal(pageFromPath('/elsewhere.html'), 'other');
  assert.equal(pageFromPath(undefined), 'other');
});

test('the copied summary is plain text, newest last, and says when nothing is recorded', async () => {
  assert.equal(
    diagnosticsText([], { version: '0.34.0', now: NOW }),
    'Giga Pinax diagnostics\nVersion: 0.34.0\nCopied: 2026-09-24T10:00:00.000Z\nNo failures recorded.\n',
  );
  const storage = fakeStorage();
  await recordDiagnostic({ area: 'acsearch', code: 'http', status: 503 }, options(storage));
  await recordDiagnostic({ area: 'acsearch', code: 'too-large', bytes: 4194304 }, options(storage, { page: 'workspace' }));
  await recordDiagnostic({ area: 'store', code: 'storage' }, options(storage, { page: 'background' }));
  assert.equal(diagnosticsText(await readDiagnostics(options(storage)), { version: '0.34.0', now: NOW }), [
    'Giga Pinax diagnostics',
    'Version: 0.34.0',
    'Copied: 2026-09-24T10:00:00.000Z',
    'Failures recorded: 3 (oldest first, at most 50 kept)',
    '2026-09-24T10:00:00.000Z popup acsearch http 503 (0.34.0)',
    '2026-09-24T10:00:00.000Z workspace acsearch too-large over 4194304 bytes (0.34.0)',
    '2026-09-24T10:00:00.000Z background store storage (0.34.0)',
    '',
  ].join('\n'));
});

test('a stored entry is checked again when read, so a hand-edited key cannot smuggle text out', async () => {
  const storage = fakeStorage({ [DIAGNOSTICS_KEY]: [
    { at: NOW, page: 'popup', area: 'lookup', code: 'http', status: 500, version: '0.34.0', term: 'RIC II 207' },
    { at: 'yesterday', page: 'popup', area: 'lookup', code: 'http' },
    'RIC II 207',
    { at: NOW, page: 'popup', area: 'elsewhere', code: 'http' },
  ] });
  assert.deepEqual(await readDiagnostics(options(storage)), [
    { at: NOW, page: 'popup', area: 'lookup', code: 'http', status: 500, version: '0.34.0' },
  ]);
});

test('Clear empties the buffer', async () => {
  const storage = fakeStorage();
  await recordDiagnostic({ area: 'lookup', code: 'network' }, options(storage));
  await clearDiagnostics(options(storage));
  assert.deepEqual(await readDiagnostics(options(storage)), []);
});

// The buffer is outside the validated root: it is never part of the records, a backup or the raw rescue file.
test('diagnostics live under their own key, outside the records, backups and the raw export', async () => {
  assert.notEqual(DIAGNOSTICS_KEY, STORAGE_KEY);
  const storage = fakeStorage({ [STORAGE_KEY]: createEmptySnapshot(NOW) });
  await recordDiagnostic({ area: 'store', code: 'storage' }, options(storage));
  const writer = createCommandWriter(storage, { now: () => NOW, newId: () => crypto.randomUUID() });
  const snapshot = await writer.commitCommand({ type: 'snapshot.get', requestId: 'one' });
  const raw = await writer.commitCommand({ type: 'snapshot.raw', requestId: 'two' });
  assert.equal(snapshot.ok, true);
  for (const text of [JSON.stringify(snapshot.value), JSON.stringify(raw.value), exportBackup(snapshot.value, NOW).value]) {
    assert.ok(!text.includes('diagnostics') && !text.includes('"area"'), text.slice(0, 200));
  }
  assert.equal(storage.data[DIAGNOSTICS_KEY].length, 1);
});

// --- the failure paths that record ----------------------------------------------------------------

test('each provider fetch that fails records its area and kind, and answers exactly as before', async (t) => {
  const { lookupById, lookupType, parseReference } = await import('../extension/lookup.js');
  const { fetchPrices, ACSEARCH_MAX_BYTES } = await import('../extension/prices.js');
  const { fetchCoinArchivesPrices } = await import('../extension/coinarchives-prices.js');
  const storage = fakeStorage();
  globalThis.browser = {
    storage: { local: storage },
    runtime: { getManifest: () => ({ version: '0.34.0' }) },
  };
  globalThis.location = { pathname: '/popup.html' };
  t.after(() => { delete globalThis.browser; delete globalThis.location; });
  const drained = () => recordDiagnostic(null);
  const last = async () => {
    await drained();
    const { at, ...entry } = storage.data[DIAGNOSTICS_KEY].at(-1);
    assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    return entry;
  };
  const status = (code) => async () => ({ ok: false, status: code, body: null });
  const refused = (name) => async () => { throw Object.assign(new Error('https://www.acsearch.info/search.html?term=secret'), { name }); };
  const oversized = async () => ({ ok: true, status: 200, headers: { get: (name) => (name === 'content-length' ? String(ACSEARCH_MAX_BYTES + 1) : null) }, body: { cancel: async () => {} } });

  assert.deepEqual(await lookupById('ocre', 'ric.2.hdn.207', { fetchImpl: status(503) }), { status: 'unavailable', httpStatus: 503 });
  assert.deepEqual(await last(), { page: 'popup', area: 'lookup', code: 'http', status: 503, version: '0.34.0' });
  assert.deepEqual(await lookupType(parseReference('RRC 44/5'), { fetchImpl: refused('TypeError') }), { status: 'network' });
  assert.deepEqual(await last(), { page: 'popup', area: 'lookup', code: 'network', version: '0.34.0' });

  assert.deepEqual(await fetchPrices({ term: 'secret', currency: 'USD' }, { fetchImpl: status(403) }), { status: 'network' });
  assert.deepEqual(await last(), { page: 'popup', area: 'acsearch', code: 'http', status: 403, version: '0.34.0' });
  assert.deepEqual(await fetchPrices({ term: 'secret', currency: 'USD' }, { fetchImpl: oversized }), { status: 'network', reason: 'too-large' });
  assert.deepEqual(await last(), { page: 'popup', area: 'acsearch', code: 'too-large', bytes: ACSEARCH_MAX_BYTES, version: '0.34.0' });
  assert.deepEqual(await fetchPrices({ term: 'secret', currency: 'USD' }, { fetchImpl: refused('TimeoutError') }), { status: 'network' });
  assert.deepEqual(await last(), { page: 'popup', area: 'acsearch', code: 'timeout', version: '0.34.0' });

  const archived = await fetchCoinArchivesPrices({ term: 'secret', currency: 'USD' }, { fetchImpl: status(500) });
  assert.equal(archived.reason, 'http');
  assert.deepEqual(await last(), { page: 'popup', area: 'coinarchives', code: 'http', status: 500, version: '0.34.0' });
  const redirected = await fetchCoinArchivesPrices({ term: 'secret', currency: 'USD' }, {
    fetchImpl: async () => ({ ok: true, status: 200, url: 'https://www.coinarchives.com/login.php', body: null }),
  });
  assert.equal(redirected.reason, 'redirect');
  assert.deepEqual(await last(), { page: 'popup', area: 'coinarchives', code: 'redirect', version: '0.34.0' });
  const timedOut = await fetchCoinArchivesPrices({ term: 'secret', currency: 'USD' }, { fetchImpl: refused('TimeoutError') });
  assert.equal(timedOut.reason, 'timeout');
  assert.deepEqual(await last(), { page: 'popup', area: 'coinarchives', code: 'timeout', version: '0.34.0' });

  assert.ok(!JSON.stringify(storage.data).includes('secret'));
  assert.ok(!JSON.stringify(storage.data).includes('ric.2'));
});
