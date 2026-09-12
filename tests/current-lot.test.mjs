import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResearchDraft, buildResearchQuery, collectCurrentLotCandidates } from '../extension/current-lot.js';

function node(text, options = {}) {
  return {
    textContent: text,
    hidden: options.hidden ?? false,
    getAttribute(name) { return name === 'aria-hidden' ? options.ariaHidden ?? null : null; },
  };
}

test('collects bounded visible current-lot candidates with field provenance', () => {
  const nodes = [
    node('Emperor: Nero'),
    node('Denomination: AR denarius'),
    node('Mint: Rome'),
    node('Reference: RIC I (2nd ed.) 306'),
    node('Mint: hidden', { hidden: true }),
  ];
  const root = {
    title: 'Nero denarius at auction',
    querySelector(selector) { return selector === 'link[rel="canonical"]' ? { href: 'https://auction.test/lot?lot=27#detail' } : null; },
    querySelectorAll() { return nodes; },
    getSelection() { return { toString: () => 'Nero silver denarius RIC 306' }; },
  };
  const result = collectCurrentLotCandidates(root, { href: 'https://auction.test/lot?lot=27' });
  assert.equal(result.pageUrl, 'https://auction.test/lot?lot=27#detail');
  assert.equal(result.candidates.ruler.value, 'Nero');
  assert.equal(result.candidates.denomination.value, 'AR denarius');
  assert.equal(result.candidates.mint.value, 'Rome');
  assert.equal(result.candidates.reference.value, 'RIC I (2nd ed.) 306');
  assert.equal(result.rawText.includes('hidden'), false);
  assert.ok(result.rawText.length <= 3000);
});

test('builds an editable collector launcher draft without turning capture into evidence', () => {
  const draft = buildResearchDraft({
    pageTitle: 'Restricted auction page',
    pageUrl: 'https://auction.test/lot/27',
    rawText: '',
    candidates: {},
  }, { now: '2026-09-12T12:00:00.000Z', newId: () => 'draft-id' });
  assert.deepEqual(draft, {
    id: 'draft-id',
    dataClass: 'collector',
    purpose: 'launcher-input',
    pageTitle: 'Restricted auction page',
    pageUrl: 'https://auction.test/lot/27',
    capturedAt: '2026-09-12T12:00:00.000Z',
  });
  assert.equal(draft.observations, undefined);
  assert.equal(buildResearchQuery({ ruler: { value: 'Nero' }, denomination: { value: 'denarius' }, reference: { value: 'RIC 306' } }), 'Nero denarius RIC 306');
});

test('bounds capture inputs and ignores uncertain or blank candidate values', () => {
  const long = 'x'.repeat(5000);
  const draft = buildResearchDraft({
    pageTitle: long,
    pageUrl: `https://auction.test/${long}`,
    rawText: long,
    candidates: { ruler: { value: '   ', provenance: 'visible-text' }, mint: { value: long, provenance: 'title' } },
  }, { now: '2026-09-12T12:00:00.000Z', newId: () => 'draft-id' });
  assert.ok(draft.pageTitle.length <= 200);
  assert.ok(draft.pageUrl.length <= 2048);
  assert.ok(draft.rawText.length <= 3000);
  assert.equal(draft.ruler, undefined);
  assert.ok(draft.mint.value.length <= 120);
});
