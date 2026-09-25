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
  // The category in front of the ruler is no mint of his coin (loop S1 review, Important 1): only the mint behind him travels.
  assert.deepEqual(struck('Rome Roman Empire 323 - 324 PLON AE Nummus - Constantinus II (BEATA TRANQVILLITAS) Bronze Londinium Mint 3.22g XF RIC VII 287; Condition XF.'),
    ['Londinium']);
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
  // Constantine has no RIC VII Alexandria 500, only Treveri's, which is offered and not opened (loop S1 review, Minor 9).
  const nowhere = await lookup('Constantine I. Follis, Alexandria. RIC VII 500.');
  assert.equal(nowhere.status, 'candidates');
  assert.deepEqual(nowhere.candidates.map((entry) => entry.id), ['ric.7.tri.500']);
});

// Loop V-01: two mints in one heading ("Rome Roman Empire. … Siscia mint.") may be a category and the mint. Narrowed to them, a coin is still only
// offered, since nothing says which one is where it was struck.
test('over the bundled catalogue, a heading naming two mints narrows to them and opens nothing on that alone', { skip }, async () => {
  const two = await lookup('Constantine I. Follis. Treveri or Londinium. RIC VII 42.');
  assert.notEqual(two.status, 'ok');
  assert.deepEqual(two.candidates.map((entry) => entry.id).sort(), ['ric.7.lon.42', 'ric.7.tri.42']);
});

// Loop V-03: Tauler & Fau's "(Ric-II 118)" behind a Trajan heading is his coin, found in the bundle, where it went online and failed offline.
test('over the bundled catalogue, a Tauler & Fau lot opens its coin', { skip }, async () => {
  const trajan = await lookup('Trajan. Denarius. 103-111 AD. Rome. (Ric-II 118). (Bmcre-284). (Rsc-74). Ag. 3,32 g. Choice VF. Est...100.');
  assert.equal(trajan.card?.id, 'ric.2.tr.118');
  const pius = await lookup('Antoninus Pius. Sestertius. 145-161 AD. Rome. (Ric-III 772). (Bmcre-1655). (C-579). Ae. 26,34 g.');
  assert.equal(pius.card?.id, 'ric.3.ant.772');
});

// Loop V-06 (as the lead corrected it): CNG and Roma cite every Julio-Claudian coin "RIC I 306", Baldwin's and Spink Hadrian "RIC II.3 2140", and
// OCRE holds those volumes in their second edition alone. A citation without its edition may be the 1923 first edition's number, which is another
// coin, so the one type is never opened on it, ruler or no ruler, lot or typed. It is offered as the collector writes it ("RIC I² Nero 306"), with
// why he has to take it himself.
test('over the bundled catalogue, an unedited "RIC I 306" offers its one type, labelled, and never opens it', { skip }, async () => {
  for (const [text, id, label, volume] of [
    ['Nero. As. RIC I 306; WCN 275.', 'ric.1(2).ner.306', 'RIC I² Nero 306', 'I'],
    ['Roman Imperial, Hadrian (AD 117-138), AR Denarius, Rome, AD 134-138, HADRIANVS AVG COS III P P, bare head right, rev. FIDES PVBLICA, Fides standing right holding corn ears and fruit, 3.42g (RIC II.3 2140; RSC 716). About extremely fine.', 'ric.2_3(2).hdn.2140', 'RIC II.3² Hadrian 2140', 'II.3'],
    ['Vespasian. Denarius. RIC II.1 772.', 'ric.2_1(2).ves.772', 'RIC II.1² Vespasian 772', 'II.1'],
    ['Galba. Denarius. RIC I 306.', 'ric.1(2).gal.306', 'RIC I² Galba 306', 'I'],
  ]) {
    const result = await lookup(text);
    assert.equal(result.status, 'candidates', text.slice(0, 50));
    assert.deepEqual(result.candidates, [{ id, title: result.candidates[0].title, source: 'local', label,
      note: `the lot says RIC ${volume} without an edition; the second edition is the one bundled` }], text.slice(0, 50));
  }
  // Typed, with the ruler or without, it is the same offer.
  for (const [typed, id] of [['RIC I Nero 306', 'ric.1(2).ner.306'], ['RIC II.3 Hadrian 2140', 'ric.2_3(2).hdn.2140'], ['RIC II.3 2140', 'ric.2_3(2).hdn.2140']]) {
    const result = await answer(parseReference(typed));
    assert.equal(result.status, 'candidates', typed);
    assert.deepEqual(result.candidates.map((entry) => entry.id), [id], typed);
    assert.match(result.candidates[0].note, /^the reference says RIC II?(?:\.\d)? without an edition; the second edition is the one bundled$/, typed);
  }
  // With the edition written, the type opens as it always did; several types are offered without a label, as before.
  assert.equal((await answer(parseReference('RIC I² Nero 306'))).card?.id, 'ric.1(2).ner.306');
  assert.equal((await lookup('Nero. As. RIC I² 306.')).card?.id, 'ric.1(2).ner.306');
  const three = await answer(parseReference('RIC I 306'));
  assert.equal(three.candidates.length, 3);
  assert.ok(three.candidates.every((entry) => entry.note === undefined));
  // Plain RIC II is no single-edition shelf: its hits carry no such label.
  const plain = await lookup('Trajan. Denarius. RIC II 118.');
  assert.equal(plain.card?.id, 'ric.2.tr.118');
});

// Loop V-06: over the three volumes OCRE holds in their second edition alone, the unedited numeral opens nothing, behind the ruler or typed.
test('over the bundled catalogue, an unedited RIC I, II.1 or II.3 never opens a type', { skip }, async () => {
  let offered = 0;
  let n = 0;
  for (const [id, title] of bundleJson('ocre/index.json').entries) {
    const hit = parseReference(title, false);
    if (!hit || !/\(2nd edition\)$/.test(hit.volume) || n++ % 5) continue;
    const volume = hit.volume.replace(' (2nd edition)', '').replace(', Part ', '.');
    const number = hit.number.split(' ')[0];
    for (const result of [await lookup(`${hit.section.split(' (')[0]}. Denarius. RIC ${volume} ${number}.`),
      await answer(parseReference(`RIC ${volume} ${hit.section.split(' (')[0]} ${number}`) ?? {}), await answer(parseReference(`RIC ${volume} ${number}`) ?? {})]) {
      assert.notEqual(result?.status, 'ok', `${title}: opened ${result?.card?.id}`);
      if (result?.candidates?.length === 1 && result.candidates[0].id === id && result.candidates[0].note) offered += 1;
    }
  }
  assert.ok(offered > 1000, `${offered} labelled offers`);
});

// Loop V-12: Rauch's "RIC 306 (2. Aufl.)" behind Nero opens his coin.
test('over the bundled catalogue, a German edition remark behind the number opens the coin', { skip }, async () => {
  const rauch = await lookup('RÖMISCHE KAISERZEIT. Nero 54-68. As, Rom, 62-68. 10,80g. RIC 306 (2. Aufl.), WCN 275. ss/vz');
  assert.equal(rauch.card?.id, 'ric.1(2).ner.306');
});

// Loop S1 review, Important 1: a mint word in front of the ruler is the house's category or name ("Rome Roman Empire. …", "Roma Numismatics E-Sale
// 100. …", "London Coins Auction 180. …"), and a place with a hoard behind it or "found near" in front of it is where the coin was found. Neither is
// where it was struck, so neither travels with the row, and the ruler's coin of that mint is never opened on it: 4,272 wrong coins in the review's sweep.
test('a mint before the ruler, or a find-spot, is not where the coin was struck', () => {
  const struck = (text) => { const lot = findReferences(text); return lotLookup(lot.references[0], lot.rulers).struckAt; };
  for (const text of ['Rome Roman Empire. Diocletian. Follis. RIC VI 1.', 'Roma Numismatics E-Sale 100. Diocletian. Follis. RIC VI 1.',
    'London Coins Auction 180. Constantine I. Follis. RIC VI 108.', 'Constantine I, from the Lyon hoard. Follis. RIC VII 42.',
    'Constantine I. Follis. Found near London. RIC VII 42.', 'Constantine I. Follis. Trier hoard. RIC VII 42.',
    'Constantine I. Follis, found at Trier. RIC VII 42.', 'Constantine I. Follis. Aus dem Hort von Trier. RIC VII 42.', 'Constantine I. Follis. Trier find. RIC VII 42.']) {
    assert.equal(struck(text), undefined, text);
  }
  // The mint behind the ruler still travels, and a category in front of it is left out.
  assert.deepEqual(struck('Rome Roman Empire. Constantine I. Follis. Siscia mint. RIC VII 42.'), ['Siscia']);
  assert.deepEqual(struck('Constantine I. Follis, Treveri. RIC VII 42.'), ['Treveri']);
  assert.deepEqual(struck('Constantine I, from the Lyon hoard. Follis, Treveri. RIC VII 42.'), ['Treveri']);
  // A heading naming no ruler is still its first mint's section, as before.
  assert.equal(lotLookup(...(({ references, rulers }) => [references[0], rulers])(findReferences('Rome Roman Empire. Follis. Siscia mint. RIC VII 42.'))).section, 'Rome');
});

test('over the bundled catalogue, a category or a find-spot never opens the coin of its mint', { skip }, async () => {
  for (const text of ['Rome Roman Empire. Diocletian. Follis. RIC VI 1.', 'Roma Numismatics E-Sale 100. Diocletian. Follis. RIC VI 1.',
    'London Coins Auction 180. Constantine I. Follis. RIC VI 108.', 'Constantine I, from the Lyon hoard. Follis. RIC VII 42.',
    'Constantine I. Follis. Found near London. RIC VII 42.', 'Constantine I. Follis. Trier hoard. RIC VII 42.']) {
    const result = await lookup(text);
    assert.notEqual(result.status, 'ok', `${text}: ${result.card?.id}`);
  }
  // The mint behind the ruler opens his coin there.
  assert.equal((await lookup('Rome Roman Empire. Constantine I. Follis. Siscia mint. RIC VII 42.')).card?.id, 'ric.7.sis.42');
});

// Loop S1 review, Important 3: the edition a lot writes after the number is the edition it cites. Written second, the one bundled type opens; written
// first, nothing is found, and nothing is offered with a note that the lot named no edition.
test('over the bundled catalogue, an edition written after the number opens or finds nothing as it says', { skip }, async () => {
  for (const text of ['Nero. As. RIC I 306 (2nd ed.); WCN 275.', 'RÖMISCHE KAISERZEIT. Nero 54-68. As. RIC I 306 (2. Aufl.), WCN 275. ss/vz',
    'Néron. As. RIC I 306 (2e éd.).', 'Nero. As. RIC I 306 2. Aufl., WCN 275.']) {
    assert.equal((await lookup(text)).card?.id, 'ric.1(2).ner.306', text);
  }
  assert.equal((await lookup('Hadrian. Denarius. RIC II.3 2140 (2nd ed.); RSC 716.')).card?.id, 'ric.2_3(2).hdn.2140');
  assert.equal((await answer(parseReference('RIC I Nero 306 (2nd ed.)'))).card?.id, 'ric.1(2).ner.306');
  for (const text of ['Nero. As. RIC I 306 (1st ed.).', 'Nero. As. RIC 306 (1st ed.).']) {
    const result = await lookup(text);
    assert.notEqual(result.status, 'ok', text);
    assert.ok(!(result.candidates ?? []).some((entry) => entry.note), text);
  }
});

// Loop S1 re-review, Minors 1 and 2: a mint word that is part of a house's or firm's name ("London Coins Auction 12", "Sold by Baldwin's of London",
// "Roma Numismatics"), even behind the ruler, and a treasure, cache or deposit named before its place ("Treasure of Trier") say nothing of where the
// coin was struck.
test('a house name or a treasure behind the ruler is not where the coin was struck', () => {
  const struck = (text) => { const lot = findReferences(text); return lotLookup(lot.references[0], lot.rulers).struckAt; };
  for (const text of ['Constantine I. Follis. London Coins Auction 12. RIC VII 42.', "Constantine I. Follis. Sold by Baldwin's of London. RIC VII 42.",
    'Constantine I. Follis. Roma Numismatics E-Sale 100, lot 12. RIC VII 42.', 'Constantine I. Follis. Trier Numismatik GmbH. RIC VII 42.',
    'Constantine I. Follis. London Auctions Ltd. RIC VII 42.', 'Constantine I. Follis. Lyon Auktionen. RIC VII 42.', 'Constantine I. Follis. London Ltd. RIC VII 42.',
    'Constantine I. Follis. London Limited. RIC VII 42.', 'Constantine I. Follis. London & Co. RIC VII 42.', 'Constantine I. Follis. Ex Trier collection. RIC VII 42.',
    'Constantine I. Follis. From London dealer. RIC VII 42.', 'Constantine I. Follis. Gekauft bei Trier Münzen. RIC VII 42.',
    'Constantine I. Follis. Treasure of Trier. RIC VII 42.', 'Constantine I. Follis. Schatz von Trier. RIC VII 42.', 'Constantine I. Follis. Trésor de Lyon. RIC VII 42.',
    'Constantine I. Follis. Tesoro di Aquileia. RIC VII 42.', 'Constantine I. Follis. Cache of London. RIC VII 42.', 'Constantine I. Follis. Deposit of Trier. RIC VII 42.']) {
    assert.equal(struck(text), undefined, text);
  }
  // The mint itself, behind the ruler, still travels.
  assert.deepEqual(struck('Constantine I. Follis, London. RIC VII 42.'), ['Londinium']);
  assert.deepEqual(struck('Constantine I. Follis. Treveri mint. RIC VII 42.'), ['Treveri']);
});
