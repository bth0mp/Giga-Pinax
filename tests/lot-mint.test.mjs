// Loop N6 review (Important 3): RIC VI–IX file a coin by the mint that struck it, and a heading that names a ruler and a mint ("Constantius I. Follis.
// Trier. RIC VI 12.") is looked up by the ruler, so the mint was dropped and his one coin with the number at another mint opened as the answer. The
// heading's mint now travels with the reference as where the coin was struck, and a single coin from another RIC VI–IX mint is offered, never opened.
// Swept over the bundled catalogue; skipped where it is not checked out.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RIC_SECTIONS } from '../extension/catalogues.js';
import { findReferences, lotLookup } from '../extension/lot.js';
import { parseReference } from '../extension/lookup.js';
import { answer, bundleJson, skip } from './helpers/bundle.mjs';

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

// Loop P2 fix round 2: over the bundle, a dotted letter ("RIC IV 27 b.") never opens a coin where the lettered type is there to be meant: both
// readings are offered. Where no lettered type answers ("RIC 306 f.", German "and following"), the answer is exactly the plain number's, as on main.
test('over the bundled catalogue, a dotted RIC letter offers both readings and opens neither', { skip }, async () => {
  const philip = await lookup('Philip I. Antoninian. RIC IV 27 b.');
  assert.equal(philip.status, 'candidates');
  assert.ok(philip.candidates.some(({ id }) => /\.27B$/i.test(id)) && philip.candidates.some(({ id }) => /\.27$/.test(id)), JSON.stringify(philip.candidates));
  assert.equal((await lookup('Nero. Denar. RIC 306 f.')).card?.id, (await lookup('Nero. Denar. RIC 306.')).card?.id);
  const numeral = (volume) => (/^[IVX]+/.exec(volume) ?? [''])[0];
  let offered = 0;
  let kept = 0;
  let n = 0;
  const entries = bundleJson('ocre/index.json').entries;
  // Every RIC number that carries a k-type in the bundle, whoever's it is: there "k." is ambiguous, and the plain check below leaves it alone.
  const kTypes = new Set(entries.map(([, title]) => /^(\d+)k(?![a-z\d])/i.exec(parseReference(title, false)?.number ?? '')?.[1]).filter(Boolean));
  for (const [id, title] of entries) {
    const hit = parseReference(title, false);
    if (!hit || hit.section.includes('(') || hit.section.includes(' and ')) continue;
    // Every lettered title: the "never opens" rule holds whole, not on a sample. The other checks take every sixth.
    // OCRE titles a type letter in either case ("223C", "27b"); a dealer spaces it off in lower case.
    const lettered = /^(\d+)([a-l])$/i.exec(hit.number);
    const sampled = n++ % 6 === 0;
    if (lettered) {
      const [digits, letter] = [lettered[1], lettered[2].toLowerCase()];
      const result = await lookup(`${hit.section}. Denarius. RIC ${numeral(hit.volume)} ${digits} ${letter}.`);
      assert.notEqual(result.status, 'ok', `${title}: opened ${result.card?.id}`);
      if (result.status === 'candidates' && result.candidates.some((entry) => entry.id === id)) offered += 1;
      // The same letter closed by a ";" is no ambiguity: it opens the lettered coin or offers, as before, never another coin.
      if (!sampled) continue;
      const closed = await lookup(`${hit.section}. Denarius. RIC ${numeral(hit.volume)} ${digits} ${letter};`);
      assert.ok(closed.status !== 'ok' || closed.card.id === id, `${title}: ${closed.card?.id}`);
    } else if (sampled && /^\d+$/.test(hit.number) && !kTypes.has(hit.number)) {
      // A letter no lettered type answers is read as the plain number, exactly as main read it.
      const plain = await lookup(`${hit.section}. Denar. RIC ${numeral(hit.volume)} ${hit.number}.`);
      const following = await lookup(`${hit.section}. Denar. RIC ${numeral(hit.volume)} ${hit.number} k.`);
      assert.deepEqual([following.status, following.card?.id, following.candidates?.map((entry) => entry.id)],
        [plain.status, plain.card?.id, plain.candidates?.map((entry) => entry.id)], title);
      kept += 1;
    }
  }
  assert.ok(offered > 1200 && kept > 100, `${offered} offered, ${kept} kept`);
});

// Loop P2 fix round 3 (re-review Important 2): a lettered type filed in the heading's own section under another portrait is still a reading.
test('over the bundled catalogue, a dotted letter offers the lettered type of the heading\'s own section', { skip }, async () => {
  const decius = await lookup('Trajan Decius. Denarius. RIC IV 223 c.');
  assert.equal(decius.status, 'candidates');
  assert.deepEqual(['ric.4.tr_d.223', 'ric.4.tr_d.223C'].filter((id) => decius.candidates.some((entry) => entry.id === id)), ['ric.4.tr_d.223', 'ric.4.tr_d.223C']);
  const macrinus = await lookup('Macrinus. Denarius. RIC IV 102 b.');
  assert.notEqual(macrinus.status, 'ok');
  assert.ok(macrinus.candidates.some((entry) => entry.id === 'ric.4.mcs.102b'), JSON.stringify(macrinus.candidates));
});

// Loop V-01: a late-Roman lot names the ruler and the mint ("Constantine I. Follis, Treveri. RIC VII 42."), and every mint of the volume holds his
// coin with the number, so the ruler alone left fourteen to choose from. The mint the heading names narrows them: the one coin there, with the ruler
// and the mint both agreeing, is the answer.
test('over the bundled catalogue, a ruler and the one mint a heading names open his coin of that mint', { skip }, async () => {
  for (const [text, id] of [
    ['Constantine I BI Nummus. Treveri, AD 310-313. IMP CONSTANTINVS AVG, laureate and cuirassed bust to right / SOLI INVICTO COMITI, Sol standing to left; T-F across fields, PTR in exergue. RIC VII 42. 4.02g, 22mm, 6h. Near Mint State.', 'ric.7.tri.42'],
    ['Constantine I (AD 307-337), Solidus, Treveri, AD 313-315, 4.42g (RIC VII 22; Depeyrot 17/3), extremely fine, very rare', 'ric.7.tri.22'],
    ['Constantius II. Siliqua, Arelate. RIC VIII 207.', 'ric.8.ar.207'],
    ['Licinius I. Follis, Siscia. RIC VII 8.', 'ric.7.sis.8'],
    ['Constantine I. Follis, Trier. RIC VII 12.', 'ric.7.tri.12'],
  ]) {
    const result = await lookup(text);
    assert.equal(result.card?.id, id, `${text.slice(0, 50)}: ${result.status} ${result.candidates?.map((entry) => entry.id).join(' ') ?? ''}`);
  }
  // A coin filed under the ruler's own name may have been struck at that mint too ("Diocletian. RIC 15", his RIC V 15 or RIC VI Lugdunum 15): both
  // are offered, and his coins of other mints are not.
  const diocletian = await lookup('Diocletian. Follis. Lugdunum. RIC 15.');
  assert.equal(diocletian.status, 'candidates');
  assert.deepEqual(diocletian.candidates.map((entry) => entry.id).sort(), ['ric.5.dio.15', 'ric.6.lug.15']);
  // A mint where the ruler has no coin with the number narrows nothing: every coin is offered, as before.
  const nowhere = await lookup('Constantine I. Follis, Londinium. RIC VII 42.');
  assert.ok(nowhere.status !== 'ok' || sectionOf(nowhere) === 'Londinium', nowhere.card?.id);
});

// Loop V-01: two mints in one heading ("Rome Roman Empire. … Siscia mint.") may be a category and the mint. Narrowed to them, a coin is still only
// offered, since nothing says which one is where it was struck.
test('over the bundled catalogue, a heading naming two mints narrows to them and opens nothing on that alone', { skip }, async () => {
  const two = await lookup('Constantine I. Follis. Treveri or Londinium. RIC VII 42.');
  assert.notEqual(two.status, 'ok');
  assert.deepEqual(two.candidates.map((entry) => entry.id).sort(), ['ric.7.lon.42', 'ric.7.tri.42']);
});
