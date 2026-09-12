import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeCompanionPreferences } from '../extension/companion-preferences.js';

const GIGA_KEY = 'giga-pinax-preferences-v1';
const LEGACY_KEY = 'coin-lookup-test-preferences-v1';

function storage(values = {}) {
  const items = new Map(Object.entries(values));
  const removed = [];
  return {
    removed,
    getItem(key) { return items.has(key) ? items.get(key) : null; },
    removeItem(key) { removed.push(key); items.delete(key); },
  };
}

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
  assert.deepEqual(api.commands[0].preferences, {
    currency: 'CHF', catalogue: 'Price', number: '23', volume: 'I (2nd edition)', section: 'Nero', sampleMode: false,
  });
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
  assert.equal(api.commands[0].preferences.currency, 'GBP');
  assert.equal(api.commands[0].preferences.catalogue, 'RIC');
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
