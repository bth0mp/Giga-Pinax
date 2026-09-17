import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheDefaultCurrency, initializeCompanionPreferences, saveCurrency } from '../extension/companion-preferences.js';

const GIGA_KEY = 'giga-pinax-preferences-v1';
const LEGACY_KEY = 'coin-lookup-test-preferences-v1';

function storage(values = {}) {
  const items = new Map(Object.entries(values));
  const removed = [];
  return {
    removed,
    read: (key) => (items.has(key) ? items.get(key) : null),
    getItem(key) { return items.has(key) ? items.get(key) : null; },
    setItem(key, value) { items.set(key, String(value)); },
    removeItem(key) { removed.push(key); items.delete(key); },
  };
}

// The research popup opens, looks up and prices before the background can answer, so it prices in the display cache of
// the default currency. Settings shares that local storage: until it wrote the cache too, the first popup opened after
// a currency change - or after an import - priced once in the currency just replaced and then showed an empty panel.
test('a page that changes the stored default currency writes the popup display cache too', () => {
  const local = storage({ [GIGA_KEY]: JSON.stringify({ currency: 'USD', catalogue: 'Bop', number: '24A' }) });
  assert.equal(cacheDefaultCurrency(local, 'CHF'), true);
  assert.deepEqual(JSON.parse(local.read(GIGA_KEY)), { currency: 'CHF', catalogue: 'Bop', number: '24A' });

  // Nothing else in the cache is the caller's to write, and a cache that is missing or unreadable is simply started.
  const empty = storage();
  assert.equal(cacheDefaultCurrency(empty, 'EUR'), true);
  assert.deepEqual(JSON.parse(empty.read(GIGA_KEY)), { currency: 'EUR' });
  const broken = storage({ [GIGA_KEY]: 'not json' });
  assert.equal(cacheDefaultCurrency(broken, 'GBP'), true);
  assert.deepEqual(JSON.parse(broken.read(GIGA_KEY)), { currency: 'GBP' });

  // A currency the calculator has no ladders for is not one the popup may be told to price in.
  assert.equal(cacheDefaultCurrency(local, 'XYZ'), false);
  assert.equal(JSON.parse(local.read(GIGA_KEY)).currency, 'CHF');
  // Blocked site data costs the cache, not the save that had already happened.
  assert.equal(cacheDefaultCurrency({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, 'EUR'), false);
});

function bridge(initialSnapshot, migratedSnapshot = initialSnapshot) {
  const commands = [];
  let reads = 0;
  return {
    commands,
    getSnapshot: async () => ({ ok: true, value: reads++ === 0 ? initialSnapshot : migratedSnapshot }),
    newRequestId: () => '00000000-0000-4000-8000-000000000001',
    sendCommand: async (command) => {
      commands.push(command);
      return { ok: true, value: migratedSnapshot.preferences };
    },
  };
}

test('existing companion preferences win without reading or changing Giga preferences', async () => {
  const snapshot = { revision: 7, preferences: { currency: 'EUR', revision: 3 } };
  const api = bridge(snapshot);
  const local = storage({ [GIGA_KEY]: JSON.stringify({ currency: 'CHF', catalogue: 'Bop' }) });

  assert.deepEqual(await initializeCompanionPreferences(api, local), { ok: true, value: snapshot });
  assert.deepEqual(api.commands, []);
  assert.deepEqual(local.removed, []);
});

test('a missing companion preference copies only a validated Giga currency', async () => {
  const initial = { revision: 0, preferences: null };
  const final = { revision: 1, preferences: { currency: 'CHF', catalogue: 'Price', revision: 1 } };
  const api = bridge(initial, final);
  const local = storage({ [GIGA_KEY]: JSON.stringify({ currency: 'CHF', catalogue: 'Bop', number: '9C', terms: { x: 'secret' } }) });

  assert.deepEqual(await initializeCompanionPreferences(api, local), { ok: true, value: final });
  assert.deepEqual(api.commands[0].preferences, { currency: 'CHF' });
  assert.deepEqual(local.removed, []);
});

test('unsupported Giga currency falls back and old companion migration takes precedence', async () => {
  const initial = { revision: 0, preferences: null };
  const final = { revision: 1, preferences: { currency: 'GBP', revision: 1 } };
  const api = bridge(initial, final);
  const local = storage({
    [GIGA_KEY]: JSON.stringify({ currency: 'JPY' }),
    [LEGACY_KEY]: JSON.stringify({ currency: 'GBP', catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true }),
  });

  assert.deepEqual(await initializeCompanionPreferences(api, local), { ok: true, value: final });
  assert.deepEqual(api.commands[0].preferences, { currency: 'GBP' });
  assert.deepEqual(local.removed, [LEGACY_KEY]);
});

test('failed migration is returned and never removes the legacy preference', async () => {
  const local = storage({ [LEGACY_KEY]: JSON.stringify({ currency: 'GBP' }) });
  const api = bridge({ revision: 0, preferences: null });
  api.sendCommand = async () => ({ ok: false, code: 'storage', outcome: 'not-committed', message: 'failed' });

  assert.deepEqual(await initializeCompanionPreferences(api, local), {
    ok: false, code: 'storage', outcome: 'not-committed', message: 'failed',
  });
  assert.deepEqual(local.removed, []);
});

function writer(replies, snapshots = []) {
  const commands = [];
  let reads = 0;
  return {
    commands,
    reads: () => reads,
    newRequestId: () => `00000000-0000-4000-8000-00000000000${commands.length + 1}`,
    getSnapshot: async () => { reads += 1; return snapshots.shift() ?? { ok: false, message: 'no snapshot' }; },
    sendCommand: async (command) => { commands.push(command); return replies.shift(); },
  };
}

test('a currency change is written against the revision it was read at', async () => {
  const saved = { revision: 3, currency: 'EUR' };
  const api = writer([{ ok: true, value: saved }]);

  assert.deepEqual(await saveCurrency(api, 'EUR', { revision: 2, currency: 'USD' }), { ok: true, value: saved });
  assert.deepEqual(api.commands, [{
    type: 'preferences.save',
    requestId: '00000000-0000-4000-8000-000000000001',
    expectedRevision: 2,
    preferences: { currency: 'EUR' },
  }]);
  assert.equal(api.reads(), 0);
});

test('a conflicting currency change re-reads and retries exactly once', async () => {
  const saved = { revision: 9, currency: 'GBP' };
  const api = writer(
    [{ ok: false, code: 'conflict', message: 'Preferences changed in another view.' }, { ok: true, value: saved }],
    [{ ok: true, value: { preferences: { revision: 8, currency: 'CHF' } } }],
  );

  assert.deepEqual(await saveCurrency(api, 'GBP', { revision: 2, currency: 'USD' }), { ok: true, value: saved });
  assert.deepEqual(api.commands.map(({ expectedRevision }) => expectedRevision), [2, 8]);
  assert.equal(api.reads(), 1);
});

test('a second conflict is left to the view that is still writing', async () => {
  const conflict = { ok: false, code: 'conflict', message: 'Preferences changed in another view.' };
  const api = writer([conflict, conflict], [{ ok: true, value: { preferences: { revision: 8 } } }]);

  assert.deepEqual(await saveCurrency(api, 'GBP', { revision: 2 }), conflict);
  assert.equal(api.commands.length, 2);
  assert.equal(api.reads(), 1);
});

test('a currency change with nothing to write against, or an unreadable re-read, reports it', async () => {
  const none = writer([]);
  const absent = await saveCurrency(none, 'GBP', null);
  assert.equal(absent.ok, false);
  assert.equal(none.commands.length, 0);

  const unreadable = writer([{ ok: false, code: 'conflict', message: 'gone' }], [{ ok: false, message: 'storage' }]);
  assert.deepEqual(await saveCurrency(unreadable, 'GBP', { revision: 1 }), { ok: false, message: 'storage' });
  assert.equal(unreadable.commands.length, 1);
});

test('a failure the bridge answers nothing for still reads as a failure', async () => {
  const api = writer([undefined]);
  assert.equal((await saveCurrency(api, 'GBP', { revision: 1 })).ok, false);
});
