// Loop N6 review (Important 3): RIC VI–IX file a coin by the mint that struck it, and a heading that names a ruler and a mint ("Constantius I. Follis.
// Trier. RIC VI 12.") is looked up by the ruler, so the mint was dropped and his one coin with the number at another mint opened as the answer. The
// heading's mint now travels with the reference as where the coin was struck, and a single coin from another RIC VI–IX mint is offered, never opened.
// Swept over the bundled catalogue; skipped where it is not checked out.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RIC_SECTIONS } from '../extension/catalogues.js';
import { findReferences, lotLookup } from '../extension/lot.js';
import { parseReference } from '../extension/lookup.js';
import { answer, skip } from './helpers/bundle.mjs';

const lookup = (text) => {
  const lot = findReferences(text);
  return answer(lotLookup(lot.references[0], lot.rulers));
};
const sectionOf = (result) => parseReference(result.card?.label ?? '', false)?.section ?? '';

test('a ruler beside a mint keeps the mint as where the coin was struck', () => {
  const lot = findReferences('Constantius I. Follis. Trier. RIC VI 12.');
  assert.deepEqual(lotLookup(lot.references[0], lot.rulers),
    { catalogue: 'RIC', number: '12', volume: 'VI', section: '', rulers: ['Constantius Chlorus'], struckAt: ['Treveri'] });
  // A heading with no mint carries none, and a heading with a mint and no ruler is that mint's section, as before.
  const plain = findReferences('Constantius I. Follis. RIC VI 12.');
  assert.equal(lotLookup(plain.references[0], plain.rulers).struckAt, undefined);
  const mint = findReferences('Follis. Trier. RIC VI 12.');
  assert.deepEqual(lotLookup(mint.references[0], mint.rulers), { catalogue: 'RIC', number: '12', volume: 'VI', section: 'Treveri', headingMint: true });
});

// Loop N6 re-review: a heading names other places than its mint — a category ("Rome Roman Empire"), the city a commemorative honours ("Urbs Roma",
// "Constantinopolis commemorative") — and the earliest of them was taken for the mint, so the coin of the mint the heading really names was only
// offered. Every mint the heading names travels with the row, and the commemorative names are not read as mints at all.
test('a heading carries every mint it names, and a commemorative city is no mint', () => {
  const struck = (text) => { const lot = findReferences(text); return lotLookup(lot.references[0], lot.rulers).struckAt; };
  assert.deepEqual(struck('Rome Roman Empire 323 - 324 PLON AE Nummus - Constantinus II (BEATA TRANQVILLITAS) Bronze Londinium Mint 3.22g XF RIC VII 287; Condition XF.'),
    ['Rome', 'Londinium']);
  assert.deepEqual(struck('Constantius II. Commemorative Series. Urbs Roma. Follis. Siscia. RIC VIII 323.'), ['Siscia']);
  assert.deepEqual(struck('Constantius II, for Urbs Roma. Follis. Siscia. RIC VIII 323.'), ['Siscia']);
  assert.deepEqual(struck('Constantius II. Follis. VRBS ROMA commemorative. Siscia mint. RIC VIII 323.'), ['Siscia']);
  assert.deepEqual(struck('Constantius II. Constantinopolis commemorative. Follis. Siscia. RIC VIII 323.'), ['Siscia']);
  assert.deepEqual(struck('Crispus. Commemorative for Constantinopolis. Follis. Aquileia. RIC VII 9.'), ['Aquileia']);
  // Constantinopolis as the mint's own Latin name is still that mint.
  assert.deepEqual(struck('Constantius II. Solidus. Constantinopolis. RIC VIII 100.'), ['Constantinople']);
  // The same blanking serves a heading that names no ruler: its mint is the one it strikes at, not the city it honours.
  const urbs = findReferences('Urbs Roma commemorative. Follis. Siscia. RIC VII 222.');
  assert.equal(lotLookup(urbs.references[0], urbs.rulers).section, 'Siscia');
});

test('over the bundled catalogue, a heading naming a place before its mint still opens the coin of that mint', { skip }, async () => {
  for (const text of ['Constantius II. Commemorative Series. Urbs Roma. Follis. Siscia. RIC VIII 323.',
    'Constantius II. Constantinopolis commemorative. Follis. Siscia. RIC VIII 323.', 'Rome Roman Empire. Constantius II. Follis. Siscia mint. RIC VIII 323.',
    'Roman Empire, Rome. Constantius II. Follis. Siscia. RIC VIII 323.', 'Constantius II (Rome). Follis. Siscia. RIC VIII 323.']) {
    const result = await lookup(text);
    assert.equal(result.card?.id, 'ric.8.sis.323', text);
  }
  // The repository's own mint-volume lot, without its OCRE id hint, opens its Londinium coin.
  const fixture = await lookup('Rome Roman Empire 323 - 324 PLON AE Nummus - Constantinus II (BEATA TRANQVILLITAS) Bronze Londinium Mint 3.22g XF RIC VII 287; Condition XF.');
  assert.equal(fixture.card?.id, 'ric.7.lon.287');
});

test('over the bundled catalogue, a ruler beside a mint never opens his coin from another mint', { skip }, async () => {
  for (const text of ['Constantius I. Follis. Trier. RIC VI 12.', 'Constantius Chlorus. Follis. Trier. RIC VI 12.',
    'Constantius I. Follis. Londinium. RIC VI 14.', 'Constantius Chlorus. Follis. London. RIC VI 14.']) {
    const result = await lookup(text);
    assert.notEqual(result.status, 'ok', `${text}: ${result.card?.id}`);
    assert.ok(result.candidates?.length > 0, text);
  }
});

test('over the bundled catalogue, across RIC VI–IX, a heading\'s mint opens only a coin of that mint', { skip }, async () => {
  let opened = 0;
  let offered = 0;
  for (const ruler of ['Constantius I', 'Constantius Chlorus', 'Konstantin I', 'Constantine I', 'Maximinus II', 'Licinius', 'Julian II', 'Jovian']) {
    for (const volume of ['VI', 'VII', 'VIII', 'IX']) {
      const mints = RIC_SECTIONS[volume];
      for (let number = 1; number <= 120; number += 1) {
        const plain = await lookup(`${ruler}. Follis. RIC ${volume} ${number}.`);
        if (plain.status !== 'ok') continue;
        const struck = sectionOf(plain);
        if (!mints.includes(struck)) continue;
        // Named at its own mint, the coin still opens.
        const own = await lookup(`${ruler}. Follis. ${struck}. RIC ${volume} ${number}.`);
        assert.equal(own.card?.id, plain.card.id, `${ruler} ${struck} ${volume} ${number}`);
        opened += 1;
        // Named at another mint, it never does.
        const other = mints.find((mint) => mint !== struck);
        const elsewhere = await lookup(`${ruler}. Follis. ${other}. RIC ${volume} ${number}.`);
        assert.ok(elsewhere.status !== 'ok' || sectionOf(elsewhere) === other, `${ruler} at ${other}, ${volume} ${number}: ${elsewhere.card?.id}`);
        offered += 1;
      }
    }
  }
  assert.ok(opened > 50 && offered > 50, `${opened} opened, ${offered} offered`);
});

// Loop Q-08: "Octavian as Augustus" opens Augustus's coin, and never a coin the heading "Augustus" would not open.
test('over the bundled catalogue, an Octavian heading opens only the Augustus coin an Augustus heading opens', { skip }, async () => {
  const opened = await lookup('Octavian as Augustus, 27 BC – 14 AD. Denarius. RIC 207.');
  assert.equal(opened.status, 'ok');
  assert.equal(opened.card.label, 'RIC I (second edition) Augustus 207');
  let singles = 0;
  for (let number = 1; number <= 560; number += 1) {
    const octavian = await lookup(`Octavian as Augustus, 27 BC – 14 AD. Denarius. RIC ${number}.`);
    if (octavian.status !== 'ok') continue;
    singles += 1;
    const augustus = await lookup(`Augustus, 27 BC – 14 AD. Denarius. RIC ${number}.`);
    // Augustus's own coin, or one filed under another ruler with his portrait (Divus Augustus under Tiberius), exactly as "Augustus" opens it.
    assert.equal(octavian.card.id, augustus.card?.id, `RIC ${number}: ${octavian.card.id}`);
  }
  assert.ok(singles > 200, `${singles} single answers`);
});

// Loop P2 review, Important 1: the German "335 f." (and following) never opens the lettered type 335f.
test('over the bundled catalogue, "RIC n f." never opens the f-type', { skip }, async () => {
  const gallienus = await lookup('Gallienus. Antoninian. RIC 335 f.');
  assert.ok(gallienus.status !== 'ok' || !/335f$/i.test(gallienus.card.id), gallienus.card?.id);
  const niger = await lookup('Pescennius Niger. Denar. RIC 3 f.');
  assert.ok(niger.status !== 'ok' || !/\.3f$/i.test(niger.card.id), niger.card?.id);
  // What main found for the plain number is still found.
  assert.equal((await lookup('Nero. Denar. RIC 306 s.')).card?.id, (await lookup('Nero. Denar. RIC 306.')).card?.id);
});
