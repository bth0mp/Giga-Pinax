import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSample, restorePreferences, sampleAmounts, sampleSummary } from '../extension/sample-data.js';

test('only exact catalogue identities yield a labelled fictional sample', () => {
  const price = resolveSample({ catalogue: 'Price', number: '23' });
  assert.equal(price.label, 'PRICE 23');
  assert.equal(price.fictional, true);
  assert.equal(resolveSample({ catalogue: 'Price', number: '23A' }), null);
  assert.equal(resolveSample({ catalogue: 'Price', number: '230' }), null);
  assert.equal(resolveSample({ catalogue: 'RIC', number: '23' }), null);
  assert.equal(resolveSample({ catalogue: 'Unknown', number: '23' }), null);
});

test('RIC requires the correct volume, edition and section, retaining number suffixes', () => {
  const ref = { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' };
  assert.ok(resolveSample(ref));
  assert.ok(resolveSample({ ...ref, section: ' nero ', number: ' 306 ' }));
  for (const mismatch of [{volume:'II'}, {volume:'I'}, {section:'Claudius'}, {number:'306A'}, {number:'3060'}]) {
    assert.equal(resolveSample({ ...ref, ...mismatch }), null);
  }
});

test('unavailable or corrupt preferences yield USD and first-use screen', () => {
  for (const raw of [null, undefined, '', 'broken json', 'null', '7', '[]']) {
    const preferences = restorePreferences(raw);
    assert.equal(preferences.currency, 'USD');
    assert.equal(preferences.sampleMode, false);
    assert.equal(preferences.catalogue, 'Price');
  }
});

test('restore preferences constrains choices and never restores an authenticated state', () => {
  const saved = restorePreferences(JSON.stringify({currency:'EUR',catalogue:'RIC',sampleMode:true,number:'306A',volume:'I (2nd edition)',section:'Nero',authenticated:true}));
  assert.equal(saved.currency, 'EUR');
  assert.equal(saved.catalogue, 'RIC');
  assert.equal(saved.number, '306A');
  assert.equal(saved.sampleMode, true);
  assert.equal(saved.authenticated, undefined);
  const invalid = restorePreferences(JSON.stringify({currency:'BTC',catalogue:'RPC',sampleMode:'yes',number:{},volume:[],section:99}));
  assert.equal(invalid.currency, 'USD');
  assert.equal(invalid.catalogue, 'Price');
  assert.equal(invalid.sampleMode, false);
  assert.equal(typeof invalid.number, 'string');
});

test('summary agrees with the full fictional sale sample', () => {
  const sorted = [...sampleAmounts].sort((a,b) => a-b);
  assert.equal(sampleSummary.count, sorted.length);
  assert.equal(sampleSummary.median, sorted[4]);
  assert.equal(sampleSummary.lowerQuartile, sorted[2]);
  assert.equal(sampleSummary.upperQuartile, sorted[6]);
});
