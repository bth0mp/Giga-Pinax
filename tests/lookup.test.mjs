import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseFeed, pickMatch, formatDates, toCard, nomismaSlugs, nomismaLabel } from '../extension/lookup.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));

test('buildQuery targets the right corpus and normalises ordinal editions', () => {
  assert.deepEqual(buildQuery({ catalogue: 'Price', number: ' 23 ' }), { corpus: 'pella', query: 'Price 23' });
  assert.deepEqual(
    buildQuery({ catalogue: 'RIC', volume: 'I (2nd edition)', section: ' Nero', number: '306' }),
    { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' },
  );
  assert.equal(buildQuery({ catalogue: 'RIC', volume: 'II', section: 'Hadrian', number: '  12a ' }).query, 'RIC II Hadrian 12a');
  assert.equal(buildQuery({ catalogue: 'RIC', volume: 'I (1st edition)', section: 'Nero', number: '1' }).query, 'RIC I (first edition) Nero 1');
});

test('parseFeed lists entry ids and titles from real Atom feeds', () => {
  assert.deepEqual(parseFeed(fixture('ocre-search-nero-306.xml')), [
    { id: 'ric.1(2).ner.306', title: 'RIC I (second edition) Nero 306' },
  ]);
  assert.deepEqual(parseFeed(fixture('pella-search-price-23.xml')).map((entry) => entry.id), ['price.1655', 'price.23']);
  assert.deepEqual(parseFeed('<feed><entry><title>A &amp; B</title><id>x</id></entry></feed>'), [{ id: 'x', title: 'A & B' }]);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<feed><entry><title>no id</title></entry></feed>'), []);
});

test('pickMatch prefers the exact title regardless of rank, else offers up to five candidates', () => {
  const pella = parseFeed(fixture('pella-search-price-23.xml'));
  assert.equal(pickMatch(pella, 'price 23').entry.id, 'price.23');
  assert.equal(pickMatch(pella, '  Price   23 ').status, 'ok');
  const near = [{ id: 'a', title: 'RIC II Hadrian 12a' }, { id: 'b', title: 'RIC II Hadrian 12b' }];
  assert.deepEqual(pickMatch(near, 'RIC II Hadrian 12'), { status: 'candidates', candidates: near });
  assert.deepEqual(pickMatch([], 'RIC II Hadrian 12'), { status: 'none' });
  const many = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `T ${index}` }));
  assert.deepEqual(pickMatch(many, 'nothing'), { status: 'none' });
});

test('formatDates renders BC, AD, mixed and single years', () => {
  assert.equal(formatDates('0062', '0068'), 'AD 62–68');
  assert.equal(formatDates('-0336', '-0323'), '336–323 BC');
  assert.equal(formatDates('-0027', '0014'), '27 BC–AD 14');
  assert.equal(formatDates('0068', '0068'), 'AD 68');
  assert.equal(formatDates('-0323', undefined), '323 BC');
  assert.equal(formatDates(undefined, undefined), null);
});

test('toCard reads an OCRE record and substitutes nomisma labels', () => {
  const card = toCard(json('ocre-nero-306.jsonld'), 'ocre', { nero: 'Nero', as: 'As', rome: 'Rome', ae: 'Bronze' });
  assert.equal(card.id, 'ric.1(2).ner.306');
  assert.equal(card.uri, 'http://numismatics.org/ocre/id/ric.1(2).ner.306');
  assert.equal(card.corpus, 'ocre');
  assert.equal(card.label, 'RIC I (second edition) Nero 306');
  assert.deepEqual(
    [card.authority, card.denomination, card.mint, card.material, card.dates],
    ['Nero', 'As', 'Rome', 'Bronze', 'AD 62–68'],
  );
  assert.deepEqual(card.obverse, { legend: 'NERO CAESAR AVG GERM IMP', description: 'Head of Nero, laureate, right' });
  assert.equal(card.reverse.legend, 'PACE P R VBIQ PARTA IANVM CLVSIT S C');
});

test('toCard tolerates missing mint, legend and labels, preferring English text', () => {
  const card = toCard(json('pella-price-23.jsonld'), 'pella', {});
  assert.equal(card.mint, null);
  assert.equal(card.authority, 'alexander_iii');
  assert.equal(card.obverse.legend, null);
  assert.equal(card.obverse.description, 'Head of beardless Heracles right wearing lion skin headdress');
  assert.equal(card.reverse.legend, 'ΑΛΕΞΑΝΔΡΟΥ');
  assert.equal(card.dates, '336–323 BC');
  assert.equal(toCard({}, 'pella'), null);
  assert.equal(toCard(null, 'pella'), null);
});

test('nomismaSlugs lists referenced concepts in display order; nomismaLabel reads the English label', () => {
  assert.deepEqual(nomismaSlugs(json('ocre-nero-306.jsonld')), ['nero', 'as', 'rome', 'ae']);
  assert.deepEqual(nomismaSlugs(json('pella-price-23.jsonld')), ['alexander_iii', 'tetradrachm', 'ar']);
  assert.deepEqual(nomismaSlugs({}), []);
  assert.equal(nomismaLabel(json('nomisma-nero.jsonld'), 'nero'), 'Nero');
  assert.equal(nomismaLabel(json('nomisma-as.jsonld'), 'as'), 'As');
  assert.equal(nomismaLabel({}, 'nero'), null);
});
