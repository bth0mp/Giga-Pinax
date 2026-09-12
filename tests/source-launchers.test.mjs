import test from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_CAPABILITIES, buildUserInitiatedSearch } from '../extension/source-launchers.js';

test('publishes access-gated capabilities separately from verified launcher transfer', () => {
  assert.deepEqual(Object.keys(SOURCE_CAPABILITIES), ['coinarchives', 'acsearch']);
  for (const capability of Object.values(SOURCE_CAPABILITIES)) {
    assert.equal(capability.launch.transfer, 'verified');
    assert.equal(capability.automaticEvidence.status, 'unavailable');
    assert.equal(capability.automaticEvidence.label, 'Unavailable — access not approved');
    assert.equal(new URL(capability.launch.searchPageUrl).protocol, 'https:');
  }
});

test('builds the observed CoinArchives Ancient Coins GET search-form route', () => {
  assert.deepEqual(buildUserInitiatedSearch('coinarchives', '  Nero RIC 306  '), {
    ok: true,
    value: {
      source: 'coinarchives',
      query: 'Nero RIC 306',
      url: 'https://www.coinarchives.com/a/results.php?search=Nero+RIC+306&s=0',
      transfer: 'verified',
    },
  });
});

test('routes KM and Y references to CoinArchives World Coins while ordinary queries stay in Ancient Coins', () => {
  assert.equal(buildUserInitiatedSearch('coinarchives', 'KM 123').value.url, 'https://www.coinarchives.com/w/results.php?search=KM+123&s=0');
  assert.equal(buildUserInitiatedSearch('coinarchives', 'Y# 31').value.url, 'https://www.coinarchives.com/w/results.php?search=Y%23+31&s=0');
  assert.equal(buildUserInitiatedSearch('coinarchives', 'Nero aureus').value.url, 'https://www.coinarchives.com/a/results.php?search=Nero+aureus&s=0');
});

test('builds the observed acsearch coin-category GET search-form route', () => {
  assert.deepEqual(buildUserInitiatedSearch('acsearch', 'Alexander III Price 23 + drachm'), {
    ok: true,
    value: {
      source: 'acsearch',
      query: 'Alexander III Price 23 + drachm',
      url: 'https://www.acsearch.info/search.html?term=Alexander+III+Price+23+%2B+drachm&category=1-2',
      transfer: 'verified',
    },
  });
});

test('limits and safely encodes a user query', () => {
  const maximum = 'x'.repeat(400);
  assert.equal(buildUserInitiatedSearch('coinarchives', maximum).ok, true);
  for (const query of ['', '   ', 'x'.repeat(401), 'Nero\nRIC 306', 'Nero\u0000RIC', 'javascript:alert(1)\r']) {
    const result = buildUserInitiatedSearch('coinarchives', query);
    assert.equal(result.ok, false, JSON.stringify(query));
    assert.equal(result.error.code, 'invalid-query');
  }
});

test('never invents a route for an unsupported source', () => {
  for (const source of ['other', 'toString', 'constructor', '__proto__']) {
    const result = buildUserInitiatedSearch(source, 'Nero');
    assert.deepEqual(result, {
      ok: false,
      error: { code: 'unsupported-source', message: 'Unknown research source.', path: 'source' },
    });
  }
});

test('all constructed launch URLs stay on the reviewed HTTPS origins', () => {
  const allowed = new Set(['https://www.coinarchives.com', 'https://www.acsearch.info']);
  for (const source of Object.keys(SOURCE_CAPABILITIES)) {
    const result = buildUserInitiatedSearch(source, '"Nero" & aureus? #1');
    assert.equal(result.ok, true);
    const url = new URL(result.value.url);
    assert.equal(allowed.has(url.origin), true);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
  }
});
