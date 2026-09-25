// Lot headings swept over the bundled catalogue: what a heading's ruler costs only shows against OCRE's own numbering, where one man's name stands
// inside another's. A file of its own so node runs its sweeps beside the rest; skipped where the bundle is not checked out.
import test from 'node:test';
import assert from 'node:assert/strict';

import { answer, headingOpens as openedOver, lotReference, peopleOn, skip } from './helpers/bundle.mjs';

const opensOnly = (opened, ids, heading) => {
  for (const hit of opened) assert.ok(peopleOn(hit.card.id).some((id) => ids.includes(id)), `${heading}: ${hit.card.id}`);
};

test('over the bundled catalogue, a heading that is one man\'s own name opens his coins and nobody else\'s', { skip }, async () => {
  // Germanicus is a person Nomisma names, and also a word inside Nero Claudius Drusus Germanicus: widened, the heading answered thirteen numbers
  // with one of Drusus's coins. These ten are the coins the heading opened before any of the alias work, all of them Germanicus's own.
  const germanicus = await openedOver('Germanicus');
  assert.deepEqual(germanicus.map(({ number }) => number), [35, 43, 50, 57, 59, 60, 61, 62, 105, 106]);
  opensOnly(germanicus, ['germanicus'], 'Germanicus');
  // Licinius is Gallienus's own nomen, so widening cost the heading every one of its answers. It opens what it always opened, and each coin is his.
  const licinius = await openedOver('Licinius');
  assert.equal(licinius.length, 88);
  opensOnly(licinius, ['licinius'], 'Licinius');
  // A dealer usually writes the father with his numeral; it must reach the same coins, not fall back into the widened set.
  assert.deepEqual((await openedOver('Licinius I')).map(({ card }) => card.id), licinius.map(({ card }) => card.id));
});

test('over the bundled catalogue, a spelling nobody is named outright still opens nothing it should not', { skip }, async () => {
  // A name no person carries alone names nobody: none of these headings may pick one man out of the several it could mean.
  for (const heading of ['Sept. Severus', 'Maximinus', 'Drusus']) assert.deepEqual(await openedOver(heading), [], heading);
  // A shared spelling keeps every owner, and a coin only opens where one of them is on it.
  // "Domitianus" is Domitian's own Latin name too, so his 290 numbers open and the six that were a stranger's become a choice.
  const opens = new Map();
  for (const [heading, count, owners] of [['Valerianus', 83, ['valerian', 'valerian_ii']],
    ['Domitianus', 290, ['domitian_ii', 'domitian', 'domitius_domitianus']],
    ['Valens', 12, ['valens']], ['Romulus', 12, ['romulus']], ['Maximus', 18, ['gaius_julius_verus_maximus']]]) {
    const opened = await openedOver(heading);
    assert.equal(opened.length, count, heading);
    opensOnly(opened, owners, heading);
    opens.set(heading, opened);
  }
  // The six a stranger's coin used to answer are the ones the emperor himself has no type for, so they are offered and never opened.
  const domitianus = opens.get('Domitianus');
  assert.ok(domitianus.every(({ card }) => card.id.startsWith('ric.2_1(2).dom.')), 'Domitianus opens only Domitian\'s own volume');
  for (const number of [1, 5, 6, 19, 20, 45]) assert.ok(!domitianus.some((hit) => hit.number === number), `RIC ${number}`);
  // A heading RIC heads a section with is that section, and its number opens the one coin.
  const philip = await openedOver('Philip I');
  assert.equal(philip.find(({ number }) => number === 16)?.card.id, 'ric.4.ph_i.16');
  opensOnly(philip, ['philip_the_arab'], 'Philip I');
});

// Loop V-07: a Spanish house's heading opens exactly the coins the English name opens, over RIC numbers 1 to 400, and no other.
test('over the bundled catalogue, a Spanish heading opens what the English name opens', { skip }, async () => {
  for (const [spanish, english] of [['AUGUSTO', 'Augustus'], ['TIBERIO', 'Tiberius'], ['CLAUDIO', 'Claudius'], ['TITO', 'Titus'], ['DOMICIANO', 'Domitian'],
    ['ANTONINO PÍO', 'Antoninus Pius'], ['MARCO AURELIO', 'Marcus Aurelius'], ['CÓMODO', 'Commodus'], ['SEPTIMIO SEVERO', 'Septimius Severus'],
    ['JULIANO II', 'Julian II'],
    // Loop S1 review, Important 2 and Minor 4: the epithets and full names, each against the English heading of the same man.
    ['CLAUDIO GÓTICO', 'Claudius Gothicus'], ['Claudio il Gotico', 'Claudius Gothicus'], ['CLAUDIO II', 'Claudius Gothicus'],
    ['JULIANO EL APÓSTATA', 'Julian II'], ['FILIPO EL ÁRABE', 'Philip the Arab'], ['MAXIMINO EL TRACIO', 'Maximinus Thrax'],
    ['CONSTANTINO EL GRANDE', 'Constantine I'], ['TEODOSIO EL GRANDE', 'Theodosius I'], ['MARCO AURELIO PROBO', 'Probus'],
    ['Marco Aurelio Caro', 'Carus'], ['Marco Aurelio Numeriano', 'Numerian'], ['MARCO AURELIO CARINO', 'Carinus']]) {
    const opened = (await openedOver(spanish)).map(({ card }) => card.id);
    assert.deepEqual(opened, (await openedOver(english)).map(({ card }) => card.id), spanish);
    assert.ok(opened.length > 0 || /^(?:JULIANO|CONSTANTINO|TEODOSIO)/.test(spanish), spanish);
  }
  // Soler y Llach's own lot: Augustus's denarius, not the Lugdunum 207 of RIC VI–VIII.
  const soler = await answer(lotReference('AUGUSTO. Denario. (Ar. 3,73g/19mm). 2 a.C.-4 d.C. Lugdunum. (RIC 207; RSC 43). Anv: Cabeza laureada de Augusto a derecha.'));
  assert.equal(soler.card?.id, 'ric.1(2).aug.207');
});

// Loop 6 (K-03): over the bundle, a ruler written after the number answers exactly as the same ruler before it, typed or in a lot, for every
// RIC I² title; and I2 / I^2 open what I² opens.
test('over the bundled catalogue, a ruler after the number answers as the ruler before it', { skip }, async () => {
  const { parseReference } = await import('../extension/lookup.js');
  const { bundleJson } = await import('./helpers/bundle.mjs');
  const titles = bundleJson('ocre/index.json').entries.filter(([, title]) => title.startsWith('RIC I (second edition) ')).map(([id, title]) => [id, parseReference(title, false)])
    .filter(([, hit]) => hit && !/ /.test(hit.number) && !/[:\d]/.test(hit.section));
  assert.ok(titles.length > 500);
  const key = (result) => (result.status === 'ok' ? result.card.id : `${result.status}:${(result.candidates ?? []).map(({ id }) => id).sort().join(',')}`);
  let opened = 0;
  for (const [id, hit] of titles.filter((_, index) => index % 3 === 0)) {
    const before = key(await answer(parseReference(`RIC ${hit.section} ${hit.number}`)));
    assert.equal(key(await answer(parseReference(`RIC ${hit.number} ${hit.section}`))), before, `RIC ${hit.number} ${hit.section}`);
    assert.equal(key(await answer(parseReference(`RIC I2 ${hit.section} ${hit.number}`))), key(await answer(parseReference(`RIC I² ${hit.section} ${hit.number}`))), id);
    assert.equal(key(await answer(lotReference(`Denarius. RIC ${hit.number} ${hit.section}. 3.21 g.`))), key(await answer(lotReference(`${hit.section}. Denarius. RIC ${hit.number}. 3.21 g.`))), id);
    if (before === id) opened += 1;
  }
  assert.ok(opened > 100);
});
