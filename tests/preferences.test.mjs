import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePreferences, rememberTerm, STORAGE_KEY, CURRENCIES } from '../extension/preferences.js';

const defaults = { currency: 'USD', catalogue: 'Price', number: '23', volume: 'I (2nd edition)', section: 'Nero', terms: {} };

test('corrupt or missing preferences fall back to Price 23 in USD', () => {
  for (const raw of [null, undefined, '', 'broken', 'null', '7', '[]']) {
    assert.deepEqual(restorePreferences(raw), defaults);
  }
});

test('saved preferences are constrained, trimmed to 120 characters and stripped of unknown keys', () => {
  const saved = restorePreferences(JSON.stringify({ currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true }));
  assert.deepEqual(saved, { currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero', terms: {} });
  const invalid = restorePreferences(JSON.stringify({ currency: 'BTC', catalogue: 'RPC', number: {}, volume: 'x'.repeat(200) }));
  assert.equal(invalid.currency, 'USD');
  assert.equal(invalid.catalogue, 'Price');
  assert.equal(invalid.number, '23');
  assert.equal(invalid.volume.length, 120);
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RIC' })).number, '306');
  assert.equal(STORAGE_KEY, 'giga-pinax-preferences-v1');
  assert.deepEqual([...CURRENCIES], ['USD', 'EUR', 'GBP', 'CHF']);
});

test('terms are restored per type id, sanitised and capped at 50', () => {
  const saved = restorePreferences(JSON.stringify({ terms: { 'price.23': 'Price 23 tetradrachm', bad: 7, ['x'.repeat(200)]: 'y'.repeat(200) } }));
  assert.equal(saved.terms['price.23'], 'Price 23 tetradrachm');
  assert.equal(saved.terms.bad, undefined);
  assert.equal(Object.keys(saved.terms).length, 2);
  assert.equal(saved.terms['x'.repeat(120)].length, 120);
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`t${index}`, `term ${index}`]));
  assert.equal(Object.keys(restorePreferences(JSON.stringify({ terms: many })).terms).length, 50);
  assert.deepEqual(restorePreferences(JSON.stringify({ terms: ['nope'] })).terms, {});
  assert.equal(restorePreferences(JSON.stringify({ currency: 'CHF' })).currency, 'CHF');
});

test('rememberTerm stores the newest term last and drops the oldest beyond 50', () => {
  let preferences = restorePreferences(null);
  for (let index = 0; index < 55; index += 1) preferences = rememberTerm(preferences, `t${index}`, `term ${index}`);
  assert.equal(Object.keys(preferences.terms).length, 50);
  assert.equal(preferences.terms.t0, undefined);
  assert.equal(preferences.terms.t54, 'term 54');
  preferences = rememberTerm(preferences, 't10', 'updated');
  assert.equal(Object.keys(preferences.terms).at(-1), 't10');
  assert.equal(preferences.terms.t10, 'updated');
  assert.equal(rememberTerm(preferences, 'k', 'v'.repeat(200)).terms.k.length, 120);
  const blank = rememberTerm(preferences, 'k', '   ');
  assert.deepEqual(blank.terms, preferences.terms);
  assert.equal(Object.hasOwn(blank.terms, 'k'), false);
});

test('RRC is a remembered catalogue with its own default number', () => {
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RRC' })).catalogue, 'RRC');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RRC' })).number, '44/5');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RPC' })).catalogue, 'Price');
});
