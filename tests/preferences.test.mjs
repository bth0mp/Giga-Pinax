import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePreferences, STORAGE_KEY, CURRENCIES } from '../extension/preferences.js';

const defaults = { currency: 'USD', catalogue: 'Price', number: '23', volume: 'I (2nd edition)', section: 'Nero' };

test('corrupt or missing preferences fall back to Price 23 in USD', () => {
  for (const raw of [null, undefined, '', 'broken', 'null', '7', '[]']) {
    assert.deepEqual(restorePreferences(raw), defaults);
  }
});

test('saved preferences are constrained, trimmed to 120 characters and stripped of unknown keys', () => {
  const saved = restorePreferences(JSON.stringify({ currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true }));
  assert.deepEqual(saved, { currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero' });
  const invalid = restorePreferences(JSON.stringify({ currency: 'BTC', catalogue: 'RPC', number: {}, volume: 'x'.repeat(200) }));
  assert.equal(invalid.currency, 'USD');
  assert.equal(invalid.catalogue, 'Price');
  assert.equal(invalid.number, '23');
  assert.equal(invalid.volume.length, 120);
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RIC' })).number, '306');
  assert.equal(STORAGE_KEY, 'giga-pinax-preferences-v1');
  assert.deepEqual([...CURRENCIES], ['USD', 'EUR', 'GBP']);
});
