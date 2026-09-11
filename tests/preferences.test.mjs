import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restorePreferences, rememberTerm, rememberRecent, recallStep, RECENT_LIMIT, STORAGE_KEY, CURRENCIES, DEFAULT_NUMBER, DEFAULT_SECTION, THEME_KEY, THEMES, restoreTheme } from '../extension/preferences.js';

const defaults = { currency: 'USD', catalogue: 'Price', number: '23', volume: 'I (2nd edition)', section: 'Nero', terms: {}, recent: [] };

test('corrupt or missing preferences fall back to Price 23 in USD', () => {
  for (const raw of [null, undefined, '', 'broken', 'null', '7', '[]']) {
    assert.deepEqual(restorePreferences(raw), defaults);
  }
});

test('saved preferences are constrained, trimmed to 120 characters and stripped of unknown keys', () => {
  const saved = restorePreferences(JSON.stringify({ currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true }));
  assert.deepEqual(saved, { currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero', terms: {}, recent: [] });
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

test('DEFAULT_NUMBER is the single source of default reference numbers', () => {
  assert.deepEqual({ ...DEFAULT_NUMBER }, { Price: '23', RIC: '306', RRC: '44/5', SC: '1266.2', Bop: '24A', Other: 'BCD Boiotia 174b' });
  assert.ok(Object.isFrozen(DEFAULT_NUMBER));
});

test('recent lookups are restored, sanitised, deduplicated and capped', () => {
  const entry = (id, corpus = 'pella', label = id) => ({ id, corpus, label });
  const saved = restorePreferences(JSON.stringify({ recent: [
    entry('price.23', 'pella', 'Price 23'), { id: 'x', corpus: 'evil', label: 'X' }, { id: 7, corpus: 'ocre', label: 'Y' },
    entry('price.23', 'pella', 'dupe'), 'junk', null, entry('rrc-44.5', 'crro', 'RRC 44/5'), entry('', 'ocre', 'empty id'),
  ] }));
  assert.deepEqual(saved.recent, [entry('price.23', 'pella', 'Price 23'), entry('rrc-44.5', 'crro', 'RRC 44/5')]);
  assert.equal(restorePreferences(JSON.stringify({ recent: Array.from({ length: 10 }, (_, i) => entry(`price.${i}`)) })).recent.length, RECENT_LIMIT);
  assert.deepEqual(restorePreferences(JSON.stringify({ recent: 'nope' })).recent, []);
  assert.equal(restorePreferences(JSON.stringify({ recent: [entry('p', 'pella', 'L'.repeat(200))] })).recent[0].label.length, 120);
  assert.equal(RECENT_LIMIT, 6);
});

test('rememberRecent puts the newest type first, drops its older copy, keeps six and stores only id, corpus and label', () => {
  let preferences = restorePreferences(null);
  const before = preferences;
  for (let i = 0; i < 8; i += 1) preferences = rememberRecent(preferences, { id: `price.${i}`, corpus: 'pella', label: `Price ${i}`, uri: 'u', obverse: {} });
  assert.deepEqual(before.recent, []);
  assert.deepEqual(preferences.recent.map((e) => e.id), ['price.7', 'price.6', 'price.5', 'price.4', 'price.3', 'price.2']);
  preferences = rememberRecent(preferences, { id: 'price.4', corpus: 'pella', label: 'Price 4' });
  assert.deepEqual(preferences.recent.map((e) => e.id), ['price.4', 'price.7', 'price.6', 'price.5', 'price.3', 'price.2']);
  assert.deepEqual(Object.keys(preferences.recent[0]), ['id', 'corpus', 'label']);
  preferences = rememberRecent(preferences, { id: 'price.4', corpus: 'ocre', label: 'Other corpus, same id' });
  assert.equal(preferences.recent.filter((e) => e.id === 'price.4').length, 2);
});

test('rememberRecent caps ids like restore does, so a round trip is identical', () => {
  const long = 'x'.repeat(200);
  const remembered = rememberRecent(restorePreferences(null), { id: long, corpus: 'pella', label: 'L' });
  assert.equal(remembered.recent[0].id.length, 120);
  assert.deepEqual(restorePreferences(JSON.stringify(remembered)).recent, remembered.recent);
});

test('ArrowUp walks the Recent labels from an empty box to older ones, stopping at the oldest; ArrowDown goes back to newer ones and then empty', () => {
  const recent = ['Price 23', 'RRC 44/5', 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1'].map((label, i) => ({ id: `t${i}`, corpus: 'pella', label }));
  assert.deepEqual(recallStep(recent, -1, '', 'ArrowUp'), { position: 0, text: 'Price 23' });
  assert.deepEqual(recallStep(recent, 0, 'Price 23', 'ArrowUp'), { position: 1, text: 'RRC 44/5' });
  assert.equal(recallStep(recent, 2, recent[2].label, 'ArrowUp'), null);
  assert.deepEqual(recallStep(recent, 1, 'RRC 44/5', 'ArrowDown'), { position: 0, text: 'Price 23' });
  assert.deepEqual(recallStep(recent, 0, 'Price 23', 'ArrowDown'), { position: -1, text: '' });
  assert.equal(recallStep(recent, -1, '', 'ArrowDown'), null);
  assert.equal(recallStep([], -1, '', 'ArrowUp'), null);
  // Typed text keeps its caret keys; an empty box starts again from the newest.
  assert.equal(recallStep(recent, -1, 'Price 2', 'ArrowUp'), null);
  assert.equal(recallStep(recent, 1, 'RRC 44/', 'ArrowDown'), null);
  assert.deepEqual(recallStep(recent, 2, '', 'ArrowUp'), { position: 0, text: 'Price 23' });
});

test('Recent entries with a blank id or label are dropped on restore', () => {
  const recent = [{ id: '  ', corpus: 'pella', label: 'Blank id' }, { id: 'price.1', corpus: 'pella', label: '   ' }, { id: 'price.23', corpus: 'pella', label: 'Price 23' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, [{ id: 'price.23', corpus: 'pella', label: 'Price 23' }]);
});

test('SC is a remembered catalogue and sco a valid Recent corpus', () => {
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'SC' })).catalogue, 'SC');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'SC' })).number, '1266.2');
  const recent = [{ id: 'sc.1.1266.2', corpus: 'sco', label: 'Seleucid Coins (part 1) 1266.2' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, recent);
});

test('Other is a remembered catalogue with its own default reference, and other a valid Recent corpus', () => {
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Other' })).catalogue, 'Other');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Other' })).number, 'BCD Boiotia 174b');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Other', number: 'BCD Boiotia 174b; HGC 4, 1218' })).number, 'BCD Boiotia 174b; HGC 4, 1218');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'other' })).catalogue, 'Price');
  const recent = [{ id: 'HGC 4, 1218', corpus: 'other', label: 'HGC 4, 1218' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, recent);
});

test('Bop is a remembered catalogue with its own default number and king, and bigr a valid Recent corpus', () => {
  assert.deepEqual({ ...DEFAULT_NUMBER }, { Price: '23', RIC: '306', RRC: '44/5', SC: '1266.2', Bop: '24A', Other: 'BCD Boiotia 174b' });
  assert.deepEqual({ ...DEFAULT_SECTION }, { RIC: 'Nero', Bop: 'Euthydemus I' });
  assert.ok(Object.isFrozen(DEFAULT_SECTION));
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).catalogue, 'Bop');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).number, '24A');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).section, 'Euthydemus I');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop', section: 'Hermaeus' })).section, 'Hermaeus');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Price' })).section, 'Nero');
  const recent = [{ id: 'bigr.euthydemus_i.13.1', corpus: 'bigr', label: 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, recent);
});

test('restoreTheme keeps only an exact light or dark choice; anything else follows the system', () => {
  assert.equal(THEME_KEY, 'giga-pinax-theme-v1');
  assert.deepEqual([...THEMES], ['light', 'dark']);
  assert.ok(Object.isFrozen(THEMES));
  assert.equal(restoreTheme('light'), 'light');
  assert.equal(restoreTheme('dark'), 'dark');
  for (const raw of [null, undefined, '', 'Dark', 'system', 'auto', ' dark', '"dark"', 0, {}, []]) assert.equal(restoreTheme(raw), '', String(raw));
});

test('theme.js is a classic pre-paint script that reads the same key and accepts the same two values', () => {
  const source = readFileSync(new URL('../extension/theme.js', import.meta.url), 'utf8');
  assert.ok(source.includes(`'${THEME_KEY}'`));
  assert.ok(!/^\s*(?:import|export)\b/m.test(source));
  for (const theme of THEMES) assert.ok(source.includes(`=== '${theme}'`), theme);
  assert.ok(source.includes('dataset.theme = theme'));
});
