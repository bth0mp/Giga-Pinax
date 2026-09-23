import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResearchDraft, buildResearchQuery, collectCurrentLotCandidates } from '../extension/current-lot.js';

// checkVisibility answers the question it was asked: a node a "content-visibility: auto" container has skipped counts as hidden only for a caller that
// asked about that, as the browser's own method does.
function node(text, options = {}) {
  const asked = Object.hasOwn(options, 'shown') || Object.hasOwn(options, 'skipped');
  return {
    textContent: text,
    hidden: options.hidden ?? false,
    getAttribute(name) { return name === 'aria-hidden' ? options.ariaHidden ?? null : null; },
    ...(asked ? { checkVisibility: (check = {}) => (options.shown ?? true) && !(check.contentVisibilityAuto && options.skipped) } : {}),
  };
}

// A page as the injected function reads it: querySelectorAll answers per selector, so structured data and the text scan are told apart.
function page({ title = '', canonical = null, nodes = [], jsonLd = [], meta = {}, selection = '' } = {}) {
  return {
    title,
    querySelector(selector) {
      if (selector === 'link[rel="canonical"]') return canonical ? { href: canonical } : null;
      const property = /^meta\[property="(.+)"\]$/.exec(selector)?.[1];
      return property && meta[property] ? { content: meta[property] } : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return jsonLd.map((text) => ({ textContent: text }));
      return nodes;
    },
    getSelection: () => ({ toString: () => selection }),
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
  assert.equal(result.pageUrl, 'https://auction.test/lot?lot=27');
  assert.equal(result.canonicalUrl, 'https://auction.test/lot?lot=27#detail');
  assert.equal(result.candidates.ruler.value, 'Nero');
  assert.equal(result.candidates.denomination.value, 'AR denarius');
  assert.equal(result.candidates.mint.value, 'Rome');
  assert.equal(result.candidates.reference.value, 'RIC I (2nd ed.) 306');
  assert.equal(result.rawText.includes('hidden'), false);
  assert.ok(result.rawText.length <= 3000);
});

test('capture freezes the actual auction URL and carries canonical identity separately', () => {
  const draft = buildResearchDraft({
    pageTitle: 'Lot 27', pageUrl: 'https://auction.test/lot/27?utm_source=x',
    canonicalUrl: 'https://auction.test/archive/27', candidates: {},
  }, { now: '2026-09-12T12:00:00.000Z', newId: () => 'draft-id' });
  assert.deepEqual(draft.auctionContext, {
    pageUrl: 'https://auction.test/lot/27?utm_source=x', canonicalUrl: 'https://auction.test/archive/27',
  });
  assert.equal(draft.pageUrl, 'https://auction.test/lot/27?utm_source=x');
});

test('builds an editable collector launcher draft without turning capture into evidence', () => {
  const draft = buildResearchDraft({
    pageTitle: 'Restricted auction page',
    pageUrl: 'https://auction.test/lot/27',
    auctionContext: { pageUrl: 'https://auction.test/lot/27' },
    rawText: '',
    candidates: {},
  }, { now: '2026-09-12T12:00:00.000Z', newId: () => 'draft-id' });
  assert.deepEqual(draft, {
    id: 'draft-id',
    dataClass: 'collector',
    purpose: 'launcher-input',
    pageTitle: 'Restricted auction page',
    pageUrl: 'https://auction.test/lot/27',
    auctionContext: { pageUrl: 'https://auction.test/lot/27' },
    capturedAt: '2026-09-12T12:00:00.000Z',
  });
  assert.equal(draft.observations, undefined);
});

test('the research query is a reference the Reference box can read, or nothing at all', () => {
  assert.equal(buildResearchQuery({ ruler: { value: 'Nero' }, denomination: { value: 'denarius' }, mint: { value: 'Rome' }, reference: { value: 'RIC 306' } }), 'RIC 306');
  assert.equal(buildResearchQuery({ ruler: { value: 'Nero' }, denomination: { value: 'denarius' }, reference: { value: '306' } }), 'Nero 306');
  assert.equal(buildResearchQuery({ reference: { value: 'BCD Boiotia 174b' } }), 'BCD Boiotia 174b');
  for (const draft of [null, {}, { ruler: { value: 'Nero' } }, { reference: { value: '306' } },
    { ruler: { value: 'Rome' }, denomination: { value: 'denarius' } }]) {
    assert.equal(buildResearchQuery(draft), '', JSON.stringify(draft));
  }
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

test('a hostile page cannot dress a script URL as the lot it was captured from', () => {
  const result = collectCurrentLotCandidates(page({ canonical: 'javascript:alert(1)', nodes: [node('Mint: Rome')] }), { href: 'data:text/html,<p>lot' });
  assert.equal(result.pageUrl, '');
  assert.equal(Object.hasOwn(result, 'canonicalUrl'), false);
  const draft = buildResearchDraft({ pageTitle: 'Lot 27', pageUrl: 'javascript:alert(1)', canonicalUrl: 'https://auction.test/27', candidates: {} },
    { now: '2026-09-12T12:00:00.000Z', newId: () => 'draft-id' });
  assert.equal(draft.pageUrl, undefined);
  assert.equal(draft.auctionContext, undefined);
  const canonical = buildResearchDraft({ pageTitle: 'Lot 27', pageUrl: 'https://auction.test/27', canonicalUrl: 'javascript:alert(1)', candidates: {} },
    { now: '2026-09-12T12:00:00.000Z', newId: () => 'draft-id' });
  assert.deepEqual(canonical.auctionContext, { pageUrl: 'https://auction.test/27' });
});

test('a lot hidden by an ancestor is not read, and the node cap counts only what is visible', () => {
  const buried = [node('Reference: RIC 1', { shown: false }), node('Reference: RIC 2', { shown: true })];
  const result = collectCurrentLotCandidates(page({ nodes: buried }), { href: 'https://auction.test/2' });
  assert.equal(result.candidates.reference.value, 'RIC 2');
  assert.equal(result.rawText.includes('RIC 1'), false);

  const many = [...Array.from({ length: 150 }, () => node('Weight: 3.42 g', { shown: false })), node('Reference: RIC 306', { shown: true })];
  const capped = collectCurrentLotCandidates(page({ nodes: many }), { href: 'https://auction.test/306' });
  assert.equal(capped.candidates.reference.value, 'RIC 306');
});

test('JSON-LD product data is read before the page text, and unreadable data never throws', () => {
  const product = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Nero. AR Denarius. Rome, AD 65. RIC I 306.',
    description: 'Mint: Rome', url: 'https://auction.test/lots/27', image: ['https://auction.test/27.jpg'],
    offers: { '@type': 'Offer', price: '1200', priceCurrency: 'EUR' },
  });
  const nodes = [node('Mint: Alexandria'), node('Similar lots: RIC II 147')];
  const result = collectCurrentLotCandidates(page({ jsonLd: ['{ broken', product], nodes }), { href: 'https://auction.test/27' });
  assert.equal(result.candidates.reference.value, 'RIC I 306');
  assert.equal(result.candidates.reference.provenance, 'structured-data');
  assert.equal(result.candidates.denomination.provenance, 'structured-data');
  assert.equal(result.candidates.mint.value, 'Rome');
  assert.equal(result.canonicalUrl, 'https://auction.test/lots/27');

  const hostile = JSON.stringify({ '@type': 'Product', name: { toString: 'no' }, description: 'x'.repeat(4000), url: 'javascript:alert(1)' });
  const guarded = collectCurrentLotCandidates(page({ jsonLd: [hostile] }), { href: 'https://auction.test/27' });
  assert.equal(Object.hasOwn(guarded, 'canonicalUrl'), false);

  // The cap belongs to the structured field itself: what the page wrote past 500 characters is not read, so a reference buried there never reaches the
  // fields and the page's own visible text still answers for them.
  const padded = JSON.stringify({ '@type': 'Product', name: `${'x '.repeat(260)}RIC 306` });
  const capped = collectCurrentLotCandidates(page({ jsonLd: [padded], nodes: [node('Reference: RIC 99')] }), { href: 'https://auction.test/99' });
  assert.equal(capped.candidates.reference.value, 'RIC 99');
  assert.equal(capped.candidates.reference.provenance, 'visible-text');
});

// A lot below the fold is still the lot on show: a container the browser has not laid out yet says nothing about whether its coin is being displayed.
test('content the page has not laid out yet still counts as the lot on show', () => {
  const result = collectCurrentLotCandidates(page({ nodes: [node('Reference: RIC 306', { skipped: true })] }), { href: 'https://auction.test/306' });
  assert.equal(result.candidates.reference.value, 'RIC 306');
});

test('schema.org types are read in every spelling, and the lot this page shows wins', () => {
  const listed = { '@context': 'https://schema.org', '@type': ['Thing', 'http://schema.org/Product'], name: 'Reference: RIC 1', url: 'https://auction.test/lots/1' };
  const shown = { '@type': ['https://schema.org/Product'], name: 'Reference: RIC 306', url: 'https://auction.test/lots/27' };
  const result = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify([listed, shown])], canonical: 'https://auction.test/lots/27' }),
    { href: 'https://auction.test/27' });
  assert.equal(result.candidates.reference.value, 'RIC 306');
  assert.equal(result.candidates.reference.provenance, 'structured-data');

  // With no product naming this page, the first one answers, as it did before.
  const first = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify([listed, shown])] }), { href: 'https://auction.test/9' });
  assert.equal(first.candidates.reference.value, 'RIC 1');
});

// A catalogue that routes in the fragment gives every lot on it the same path: "#/lot/42" and "#/lot/43" are two lots,
// and core/lot-context.js reads such a fragment as part of a lot's address. Dropping it here made every product on the
// page name this one, so the capture took whichever lot was written first - a stranger's coin, and a stranger's
// auction context saved with it. A cosmetic anchor is still no address.
test('a hash route tells two lots of one catalogue page apart, as the lot address does', () => {
  const lots = [
    { '@type': 'Product', name: 'Reference: RRC 44/5', url: 'https://house.test/catalogue#/lot/42' },
    { '@type': 'Product', name: 'Reference: Price 23', url: 'https://house.test/catalogue#/lot/43' },
  ];
  const shown = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify(lots)] }), { href: 'https://house.test/catalogue#/lot/43' });
  assert.equal(shown.candidates.reference.value, 'Price 23');
  assert.equal(shown.canonicalUrl, 'https://house.test/catalogue#/lot/43');
  // The "#!" spelling of the same routing, and a page whose fragment names no lot at all.
  const bang = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify([
    { '@type': 'Product', name: 'Reference: RRC 44/5', url: 'https://house.test/catalogue#!/lot/42' },
    { '@type': 'Product', name: 'Reference: Price 23', url: 'https://house.test/catalogue#!/lot/43' },
  ])] }), { href: 'https://house.test/catalogue#!/lot/43' });
  assert.equal(bang.candidates.reference.value, 'Price 23');
  // #photo is a place on the page, not a lot: the product still names it.
  const anchored = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify([
    { '@type': 'Product', name: 'Reference: RIC 306', url: 'https://house.test/lot/27#photo' },
  ])] }), { href: 'https://house.test/lot/27' });
  assert.equal(anchored.candidates.reference.value, 'RIC 306');
});

// Google's canonical Product markup puts the lot's address on the offer and none on the product. An offer describes a sale, not a coin, so it names the
// page on its product's behalf instead of standing in for it - taking it for the lot on show left the product's own name and description unread.
test('an offer names the page for its product without standing in for the lot', () => {
  const product = { '@context': 'https://schema.org', '@type': 'Product', name: 'Reference: RIC 306', description: 'Emperor: Nero',
    offers: { '@type': 'Offer', url: 'https://auction.test/lot/27' } };
  const result = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify(product)] }), { href: 'https://auction.test/lot/27' });
  assert.equal(result.candidates.reference.value, 'RIC 306');
  assert.equal(result.candidates.reference.provenance, 'structured-data');
  assert.equal(result.candidates.ruler.value, 'Nero');
  assert.equal(result.canonicalUrl, 'https://auction.test/lot/27');

  // Two lots on one page: the one being shown is named by its offer, at an address the page wrote with a fragment and a trailing slash.
  const similar = { '@type': 'Product', name: 'Reference: RIC 1', offers: { '@type': 'Offer', url: 'https://auction.test/lot/1' } };
  const shown = { '@type': 'Product', name: 'Reference: RIC 306', offers: [{ '@type': 'Offer', url: 'https://auction.test/lot/27/#bidding' }] };
  const pair = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify([similar, shown])] }), { href: 'https://auction.test/lot/27' });
  assert.equal(pair.candidates.reference.value, 'RIC 306');

  // Nothing names this page, so the first product answers for it, with its offer's address as the lot's own.
  const unnamed = collectCurrentLotCandidates(page({ jsonLd: [JSON.stringify([similar, shown])] }), { href: 'https://auction.test/lot/9' });
  assert.equal(unnamed.candidates.reference.value, 'RIC 1');
  assert.equal(unnamed.canonicalUrl, 'https://auction.test/lot/1');
});

test('structured data the page made too large to read is left unread, and its arrays cannot outgrow the node budget', () => {
  const oversized = `${JSON.stringify({ '@type': 'Product', name: 'Reference: RIC 306' })}${' '.repeat(200001)}`;
  const skipped = collectCurrentLotCandidates(page({ jsonLd: [oversized], nodes: [node('Reference: RIC 99')] }), { href: 'https://auction.test/99' });
  assert.equal(skipped.candidates.reference.value, 'RIC 99');

  // A graph the page can make as long as it likes is read only as far as the budget reaches, and never copied past it.
  const graph = JSON.stringify({ '@graph': [...Array.from({ length: 60000 }, () => 0), { '@type': 'Product', name: 'Reference: RIC 306' }] });
  const bounded = collectCurrentLotCandidates(page({ jsonLd: [graph], nodes: [node('Reference: RIC 99')] }), { href: 'https://auction.test/99' });
  assert.equal(bounded.candidates.reference.value, 'RIC 99');
});

test('OpenGraph metadata stands in for a page whose text has no fields', () => {
  const result = collectCurrentLotCandidates(page({
    meta: { 'og:title': 'Reference: Crawford 511/2b', 'og:description': 'Emperor: Augustus', 'og:url': 'https://auction.test/lots/42' },
  }), { href: 'https://auction.test/42?utm_source=x' });
  assert.equal(result.candidates.reference.value, 'Crawford 511/2b');
  assert.equal(result.candidates.reference.provenance, 'open-graph');
  assert.equal(result.candidates.ruler.value, 'Augustus');
  assert.equal(result.pageUrl, 'https://auction.test/42?utm_source=x');
  assert.equal(result.canonicalUrl, 'https://auction.test/lots/42');
});

test('fallback reference extraction preserves Crawford slash suffix and stops before following metadata', () => {
  const nodes = [node('Republican denarius, Crawford 511/2b'), node('Mint: Rome')];
  const root = { title: '', querySelector: () => null, querySelectorAll: () => nodes, getSelection: () => ({ toString: () => '' }) };
  const result = collectCurrentLotCandidates(root, { href: 'https://auction.test/42' });
  assert.equal(result.candidates.reference.value, 'Crawford 511/2b');
  assert.equal(result.candidates.reference.value.includes('Mint'), false);
});

test('fallback reference extraction preserves a Roman volume and number without trailing prose', () => {
  const nodes = [node('Hadrian denarius. RIC II 147. Rome mint.')];
  const root = { title: '', querySelector: () => null, querySelectorAll: () => nodes, getSelection: () => ({ toString: () => '' }) };
  const result = collectCurrentLotCandidates(root, { href: 'https://auction.test/147' });
  assert.equal(result.candidates.reference.value, 'RIC II 147');
});

// The page text is the last place a reference is found, and dealers write the second edition of RIC
// with a superscript (RIC I² 306) and Seleucid Coins as SC. The function is injected into the auction
// tab on its own, so it is run here from its own source, without this module around it.
test('an unlabelled reference is read with its edition mark, and SC is read as Seleucid Coins', () => {
  const injected = new Function(`return (${collectCurrentLotCandidates.toString()})`)();
  for (const [line, reference] of [
    ['Nero. AR Denarius. Rome. RIC I² 306.', 'RIC I² 306'],
    ['Titus. Denarius. RIC II.1² 12', 'RIC II.1² 12'],
    ['Antiochos III. Tetradrachm. SC 1266.2', 'SC 1266.2'],
    ['Nero AR Denarius, RIC I 306 var.', 'RIC I 306'],
    ['Septimius Severus. RIC IV.1 123a', 'RIC IV.1 123a'],
  ]) {
    const result = injected(page({ nodes: [node(line)] }), { href: 'https://auction.test/lot/1' });
    assert.equal(result.candidates.reference?.value, reference, line);
    assert.equal(buildResearchQuery(buildResearchDraft(result)), reference, line);
  }
  // "SC" in a Roman coin's field is the senate's mark, not a catalogue: only a number makes it one.
  for (const line of ['Nero. Sestertius. SC in exergue.', 'Trajan. As. S C across field.']) {
    const result = injected(page({ nodes: [node(line)] }), { href: 'https://auction.test/lot/1' });
    assert.equal(result.candidates.reference, undefined, line);
  }
});
