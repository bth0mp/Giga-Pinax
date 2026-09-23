import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeLot, findReferences, isLot, lotLabel, lotLookup, oneLine } from '../extension/lot.js';
import { parseReference } from '../extension/lookup.js';
import { defaultTerm } from '../extension/prices.js';

const LOTS = [
  'TITUS, AD 69-79. AR, Denarius. Rome. Obv: T CAESAR VESPASIANVS. Head of Titus, laureate, right. Rev: ANNONA AVG. Ref: RIC 972; Cohen 17; BMC 319.',
  'Titus, as Caesar, 69-79. Denarius. BMC 256. Cohen 336. RIC 1073.',
  'Julia Maesa, 218-222 AD. Denarius, 2,81 g. Ref: RIC 268 (Elagabalus), BMC 76 (Elagabalus), S 7756, C 36',
  'Diva Faustina I (Died 140/1) AR Denarius (Silver, 3.00g, 18mm). RIC III (Antoninus Pius) 394a',
  'Nero (54-68 AD) Bronze as (11.57 g. 27 mm.) RIC I 306; BMCRE 228.',
  'ATTICA. Athens. Circa 393-355 BC. Silver, 23 mm, 17.21 g, 8 h. HGC 4, 1598. Kroll 15. Svoronos pl. 20 passim.',
  'SELEUKID EMPIRE. Seleukos I Nikator. SC 165.1a; ESMS Al.33 (A16/P5) = ESM 299 (this coin illustrated); HGC 9, 12j.',
  'BAKTRIA, Greco-Baktrian Kingdom. Euthydemos II, circa 185-180 BC. Bopearachchi 1C. HGC 12, 72. MIG 113d. SNG ANS 216.',
  'L. Titurius L.f. Sabinus (ca. 89 BC). Denarius. Crawford 344/1a; Sydenham 698',
  'TITUS Denier TTB, Poids : 2,81 g. C.309 - RIC.112 - BMC/RE.72 - RSC.309 - BN/R.61 - RCV.2517 (544$)',
  'Heraclius with Heraclius Constantine. RY 13 = 539/40 CE. Doc-8h, MIB-8a, Sear-734',
  'Gallienus, 1st emission, 253-254. NGC Choice VF 5/5 - 4/5. Ex Triton VIII (2005, 1132).',
];

const ric = (number, volume = '', section = '') => ({ catalogue: 'RIC', number, volume, section });
const other = (text) => ({ catalogue: 'Other', number: text, volume: '', section: '' });
const texts = (text) => findReferences(text).references.map((found) => found.text);
const only = (text) => {
  const { references } = findReferences(text);
  assert.equal(references.length, 1, `${text}: ${JSON.stringify(references)}`);
  return references[0];
};

test('every lot gives its references in text order, as the dealer wrote them', () => {
  const expected = [
    ['RIC 972', 'Cohen 17', 'BMC 319'],
    ['BMC 256', 'Cohen 336', 'RIC 1073'],
    ['RIC 268 (Elagabalus)', 'BMC 76', 'S 7756', 'C 36'],
    ['RIC III (Antoninus Pius) 394a'],
    ['RIC I 306', 'BMCRE 228'],
    ['HGC 4, 1598', 'Kroll 15', 'Svoronos pl. 20'],
    ['SC 165.1a', 'ESMS Al.33 (A16/P5)', 'ESM 299', 'HGC 9, 12j'],
    ['Bopearachchi 1C', 'HGC 12, 72', 'MIG 113d', 'SNG ANS 216'],
    ['Crawford 344/1a', 'Sydenham 698'],
    ['C.309', 'RIC.112', 'BMC/RE.72', 'RSC.309', 'BN/R.61', 'RCV.2517'],
    ['Doc-8h', 'MIB-8a', 'Sear-734'],
    [],
  ];
  LOTS.forEach((lot, index) => assert.deepEqual(texts(lot), expected[index], lot));
});

test('the type references are read, and only RIC, RRC, SC, Price and Bop are typed', () => {
  const [one, two, three, four, five, , seven, eight, nine, ten] = LOTS.map((lot) => findReferences(lot).references);
  assert.deepEqual(one[0], { text: 'RIC 972', reference: ric('972'), cf: false, variant: false, typed: true });
  assert.deepEqual(one[1], { text: 'Cohen 17', reference: other('Cohen 17'), cf: false, variant: false, typed: false });
  assert.deepEqual(two[2].reference, ric('1073'));
  assert.deepEqual(three.map((found) => found.reference), [ric('268', '', 'Elagabalus'), other('BMC 76'), other('S 7756'), other('C 36')]);
  assert.deepEqual(four[0].reference, ric('394a', 'III', 'Antoninus Pius'));
  assert.deepEqual(five[0].reference, ric('306', 'I'));
  assert.deepEqual(seven[0].reference, { catalogue: 'SC', number: '165.1a', volume: '', section: '' });
  assert.equal(seven[0].typed, true);
  assert.deepEqual(eight[0].reference, { catalogue: 'Bop', number: '1C', volume: '', section: '' });
  assert.deepEqual(nine[0].reference, { catalogue: 'RRC', number: '344/1a', volume: '', section: '' });
  assert.deepEqual(ten[1].reference, ric('112'));
  assert.deepEqual(ten.filter((found) => found.typed).map((found) => found.text), ['RIC.112']);
});

test('SG, SGCV and GCV are keys: a Sear Greek reference, normalised, prices only, a trailing "v" or "var." its variant flag', () => {
  const lot = findReferences('SELEUKID KINGDOM. Seleukos I Nikator, 312-280 BC. Tetradrachm. SG 6829v; SC 1.');
  assert.deepEqual(lot.references, [
    { text: 'SG 6829', reference: other('SG 6829 var.'), cf: false, variant: true, typed: false },
    { text: 'SC 1', reference: { catalogue: 'SC', number: '1', volume: '', section: '' }, cf: false, variant: false, typed: true },
  ]);
  assert.equal(lotLabel(lot.references[0], lot.rulers), 'SG 6829 · prices only · var.');
  assert.deepEqual(only('Tetradrachm. SG 6829 var.'), { text: 'SG 6829', reference: other('SG 6829 var.'), cf: false, variant: true, typed: false });
  assert.deepEqual(only('Tetradrachm. SGCV 6829.'), { text: 'SGCV 6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Tetradrachm. GCV 6829a.'), { text: 'GCV 6829a', reference: other('SG 6829a'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Tetradrachm. SGCV II 6829.'), { text: 'SGCV II 6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Tetradrachm. SG.6829.'), { text: 'SG.6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Tetradrachm. SG-6829.'), { text: 'SG-6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Tetradrachm. SG 6829var.'), { text: 'SG 6829', reference: other('SG 6829 var.'), cf: false, variant: true, typed: false });
  // "SG" inside a word is no SG key; Sear Greek Imperial (SGI) is its own key, tested with the other areas below.
  assert.deepEqual(texts('MASGUT 12. ASG 5.'), []);
});

test('a bracket that opens on the next key is that key\'s, so the reference before it keeps its whole body', () => {
  assert.deepEqual(texts('HGC 9, 12 (SG 6829)'), ['HGC 9, 12', 'SG 6829']);
  assert.deepEqual(texts('SELEUKID KINGDOM. Antiochos I Soter, 281-261 BC. Tetradrachm. SC 130.2; HGC 9, 18b (SG 6829v). Toned, VF.'), ['SC 130.2', 'HGC 9, 18b', 'SG 6829']);
  // The bracket still ends the run, so a single letter in it stays unlisted.
  assert.deepEqual(texts('RIC 972 (C 17)'), ['RIC 972']);
});

test('a typed reference ends at its first number: a second one after a comma is another type, not part of it', () => {
  assert.deepEqual(texts('Tetradrachm. Price 3949, 3950 (Müller 5)'), ['Price 3949', 'Müller 5']);
  assert.deepEqual(findReferences('Tetradrachm. Price 3949, 3950 (Müller 5)').references[0].reference, { catalogue: 'Price', number: '3949', volume: '', section: '' });
  assert.deepEqual(findReferences('Denarius. RIC 972, 973; Cohen 17').references.map((found) => [found.text, found.typed]), [['RIC 972', true], ['Cohen 17', false]]);
  // A catalogue without type data still carries on into its number ("HGC 12, 72").
  assert.deepEqual(texts('Tetradrachm. HGC 12, 72; SNG ANS 216'), ['HGC 12, 72', 'SNG ANS 216']);
});

test('rulers are the RIC persons named before the first reference', () => {
  const rulers = LOTS.map((lot) => findReferences(lot).rulers);
  assert.deepEqual(rulers, [['Titus'], ['Titus'], ['Julia Maesa'], [], ['Nero'], [], [], [], [], ['Titus'], [], ['Gallienus']]);
  assert.deepEqual(findReferences('Claudius with Nero, as Caesar. RIC 107').rulers, ['Claudius', 'Nero']);
  assert.deepEqual(findReferences('Divus Vespasian. Struck under Titus. RIC 357').rulers, ['Vespasian', 'Titus']);
  // A mint is a RIC section too, but not a person; a name after the first reference is not the lot's ruler.
  assert.deepEqual(findReferences('Rome. Denarius. RIC 972 (Titus); Hadrian').rulers, []);
  assert.deepEqual(findReferences('SEVERUS ALEXANDER. RIC 12').rulers, ['Severus Alexander']);
});

test('a mint-volume lot keeps its RIC citation clean and carries a strict matching OCRE id hint', () => {
  const text = 'Rome Roman Empire 323 - 324 PLON AE Nummus - Constantinus II (BEATA TRANQVILLITAS) Bronze Londinium Mint 3.22g XF RIC VII 287 OCRE ric.7.lon.287; Condition XF.';
  const lot = findReferences(text);
  assert.deepEqual(lot.rulers, ['Constantine II']);
  assert.equal(lot.references.length, 1);
  assert.equal(lot.references[0].text, 'RIC VII 287');
  assert.deepEqual(lotLookup(lot.references[0], lot.rulers), {
    catalogue: 'RIC', volume: 'VII', section: '', number: '287', rulers: ['Constantine II'], id: 'ric.7.lon.287',
  });
  assert.equal(lotLabel(lot.references[0], lot.rulers), 'RIC VII 287 · Constantine II');
});

test('an arbitrary or malformed OCRE token is never carried as a record hint', () => {
  for (const text of ['Constantinus II. RIC VII 287 OCRE ../ric.7.lon.287', 'Constantinus II. RIC VII 287 OCRE ric.7.lon.287/evil']) {
    assert.equal(lotLookup(findReferences(text).references[0], ['Constantine II']).id, undefined);
  }
});

test('several distinct OCRE ids disable the hint, and an ambiguous Latin person alias keeps every identity', () => {
  const several = findReferences('Constantine II. RIC VII 287 OCRE ric.7.lon.287; OCRE ric.7.rom.287');
  assert.equal(lotLookup(several.references[0], several.rulers).id, undefined);
  // Nomisma files "Valerianus" under Valerian and under Valerian II alike: the heading names both, and the lookup offers the two rather than
  // opening one of them.
  assert.deepEqual(findReferences('Valerianus. RIC 1').rulers, ['Valerian', 'Valerian II']);
  assert.deepEqual(findReferences('Valerian II. RIC 1').rulers, ['Valerian II']);
  assert.deepEqual(findReferences('Valerian I. RIC 1').rulers, ['Valerian']);
});

test('a mint section keeps the lot ruler so an id hint must satisfy both', () => {
  const lot = findReferences('Constantinus II. RIC VII Londinium 287 OCRE ric.7.lon.287');
  assert.deepEqual(lotLookup(lot.references[0], lot.rulers), {
    catalogue: 'RIC', volume: 'VII', section: 'Londinium', number: '287', rulers: ['Constantine II'], id: 'ric.7.lon.287',
  });
});

test('these never read as a reference', () => {
  for (const text of ['c. 386-338 BC', 'S - C', 'Died 140/1', 'NGC Choice VF 5/5 - 4/5', 'Triton VIII (2005, 1132)', 'Rome, 79.', 'RY 13 = 539/40',
    'EL 1/24', 'AE17', 'Rev: S C in field', 'AD 69-79', '3.00g, 18mm, 6h', 'Lot 23312', 'Est. 200 EUR', 'Hammer price 500', 'see doc 12']) {
    assert.deepEqual(findReferences(text).references, [], text);
  }
  // A date or weight after a reference ends it rather than joining it.
  assert.deepEqual(texts('RIC 972, AD 69-79'), ['RIC 972']);
  assert.deepEqual(texts('RIC 972, 3.21 g'), ['RIC 972']);
  assert.deepEqual(texts('RIC 972 Very rare. Good VF'), ['RIC 972']);
});

test('a price inside a reference is dropped', () => {
  const found = only('RCV.2517 (544$)');
  assert.equal(found.text, 'RCV.2517');
  assert.ok(!JSON.stringify(found).includes('544'));
  assert.equal(only('Sear 734 (120 EUR)').text, 'Sear 734');
});

test('cf. and var. become flags, remarks go, and the RIC forms dealers use are read', () => {
  const cf = only('Cf. RIC 20 (aureus)');
  assert.deepEqual([cf.text, cf.cf, cf.variant], ['RIC 20 (aureus)', true, false]);
  assert.deepEqual(cf.reference, ric('20 (aureus)'));
  const variant = only('RIC IV 34a-b var.');
  assert.deepEqual([variant.text, variant.cf, variant.variant], ['RIC IV 34a-b', false, true]);
  // The number as the dealer wrote it rides along, so the range OCRE may title a type over is tried before its first number.
  assert.deepEqual(variant.reference, { ...ric('34a', 'IV'), range: '34a-b' });
  const legend = only('RIC 972 var. (obv. legend)');
  assert.deepEqual([legend.text, legend.variant], ['RIC 972', true]);
  assert.deepEqual(only('RIC² 1180').reference, ric('1180'));
  assert.deepEqual(only('RIC II.1 357 (Titus)').reference, ric('357', 'II, Part 1', 'Titus'));
  assert.deepEqual(only('RIC II.1 (Vespasian) 696').reference, ric('696', 'II, Part 1', 'Vespasian'));
  assert.deepEqual(only('RIC V-1 123').reference, ric('123', 'V, Part 1'));
  assert.equal(only('ESM 299 (misdescribed)').text, 'ESM 299');
  assert.deepEqual(only('Pr-458').reference, { catalogue: 'Price', number: '458', volume: '', section: '' });
  assert.deepEqual(only('Coh. 284').reference, other('Coh. 284'));
  assert.deepEqual(only('SNG Keckman 547-8').reference, other('SNG Keckman 547-8'));
  assert.deepEqual(texts('RPC IV.1, 4790; BCD Peloponnesos 665.1'), ['RPC IV.1, 4790', 'BCD Peloponnesos 665.1']);
  assert.deepEqual(texts('Price 3426; cf. Müller 1375'), ['Price 3426', 'Müller 1375']);
  assert.equal(findReferences('Price 3426; cf. Müller 1375').references[1].cf, true);
});

test('duplicates go, the provenance tail is cut and hidden characters and dashes are cleaned', () => {
  assert.deepEqual(texts('RIC 972; Cohen 17; RIC 972.'), ['RIC 972', 'Cohen 17']);
  assert.deepEqual(texts('RIC 972. From the Smith Collection, RIC 1'), ['RIC 972']);
  assert.deepEqual(texts('RIC 972.\nProvenance: Leu 12, 345'), ['RIC 972']);
  assert.deepEqual(texts('RIC\u00ad 972 \u2013 Coh\u200b 17'), ['RIC 972', 'Coh 17']);
  assert.deepEqual(texts(`${'word '.repeat(700)}RIC 972`), []);
});

test('a reference carries on only into a number, so a later non-key reference, a grade, a lot number or a place ends it', () => {
  assert.deepEqual(texts('Trajan, 98-117. Denarius, Rome, 103-111. BMC 316. RIC 128. Thirion 123.'), ['BMC 316', 'RIC 128']);
  assert.deepEqual(findReferences('Trajan. BMC 316. RIC 128. Thirion 123.').references[1].reference, ric('128'));
  assert.deepEqual(texts('Crawford 344/1a. Hersh 12.'), ['Crawford 344/1a']);
  assert.deepEqual(texts('Crawford 344/1a, Sternberg 1353'), ['Crawford 344/1a']);
  assert.deepEqual(texts('RIC II.1 1073 (Vespasian), Paris 12'), ['RIC II.1 1073 (Vespasian)']);
  assert.deepEqual(texts('Philip I. Antoninianus. RIC 28c. NGC Choice VF 5/5 - 4/5.'), ['RIC 28c']);
  for (const tail of ['. Lot 23312', ', Rome 79', ', axis 6', '. Extremely Fine 5', '. ex Roma E-Sale 45, 123.']) {
    assert.deepEqual(findReferences(`RIC 972${tail}`).references.map((found) => found.reference), [ric('972')], tail);
  }
});

test('a non-key reference ends the reference before it but not the run, so a later C or S still counts; a grade ends the run', () => {
  assert.deepEqual(texts('Julia Maesa, 218-222 AD. Denarius. Ref: RIC 268 (Elagabalus), BMC 76, Thirion 123, S 7756, C 36'),
    ['RIC 268 (Elagabalus)', 'BMC 76', 'S 7756', 'C 36']);
  assert.deepEqual(texts('Ref: RIC 268 (Elagabalus), BMC 76, Good VF, S 7756, C 36'), ['RIC 268 (Elagabalus)', 'BMC 76']);
});

test('rarity and equivalence brackets after a number are dropped; a capital type letter stays', () => {
  assert.deepEqual(findReferences('TITUS, AD 69-79. Denarius. RIC 972 (R2); Cohen 17.').references[0].reference, ric('972'));
  assert.deepEqual(findReferences('Titus, as Caesar. Denarius. RIC II.1 1073 (R); BMC 256.').references[0].reference, ric('1073', 'II, Part 1'));
  assert.deepEqual(only('RIC 972 (= BMC 319)').reference, ric('972'));
  assert.deepEqual(only('RIC 5 (Rare)').reference, ric('5'));
  for (const rarity of ['(RRR)', '(Scarce)', '(Very scarce)']) {
    assert.deepEqual(findReferences(`Titus. Denarius. RIC 972 ${rarity}; Cohen 17`).references[0].reference, ric('972'), rarity);
  }
  assert.deepEqual(only('RIC V 509 (BB)').reference.number, '509 (BB)');
});

test('a bracket that opens on a reference keeps every reference listed in it', () => {
  assert.deepEqual(texts('Titus. Denarius (Cohen 17; RIC 972).'), ['Cohen 17', 'RIC 972']);
  assert.deepEqual(texts('Titus (RIC 972, Cohen 17, BMC 319)'), ['RIC 972', 'Cohen 17', 'BMC 319']);
  assert.deepEqual(texts('RIC 5 (= BMC 7)'), ['RIC 5']);
  // A key after other words in a bracket is still skipped: no BMC row.
  assert.equal(texts('Nero. RIC 5 (see also BMC 7)').length, 1);
});

test('a regnal numeral, "Magnus" and an "as Augustus" title never make another person the ruler', () => {
  const rulers = (text) => findReferences(text).rulers;
  assert.deepEqual(rulers('Claudius II Gothicus, 268-270. Antoninianus (Billon, 20 mm, 3.90 g), Rome. RIC 36; Cohen 92.'), ['Claudius Gothicus']);
  assert.deepEqual(rulers('Claudius II RIC 36'), ['Claudius Gothicus']);
  assert.deepEqual(rulers('Divus Claudius II. Antoninianus. RIC 266'), ['Claudius Gothicus']);
  assert.deepEqual(rulers('Claudius, 41-54. As, Rome. RIC I 66; Cohen 84.'), ['Claudius']);
  assert.deepEqual(rulers('Magnus Maximus, 383-388. AE2, Lugdunum. RIC 34.'), ['Magnus Maximus']);
  assert.ok(!rulers('Philip II, as Augustus, 247-249. Sestertius, Rome. RIC 268; Cohen 1.').includes('Augustus'));
  assert.ok(!rulers('Carinus, as Augustus, 283-285. Antoninianus, Lugdunum. RIC 306.').includes('Augustus'));
  assert.deepEqual(rulers('Titus, as Augustus, AD 79-81. Denarius. RIC 112.'), ['Titus']);
  assert.deepEqual(rulers('Titus augustus, 79-81. Denarius. RIC 112.'), ['Titus']);
  assert.deepEqual(rulers('Augustus, 27 BC-AD 14. Denarius. RIC 207.'), ['Augustus']);
});

test('a lot row looks up its parsed reference, with the rulers only on a RIC reference without a section, and says so', () => {
  const [lot, maesa] = [LOTS[0], LOTS[2]].map(findReferences);
  assert.deepEqual(lotLookup(lot.references[0], lot.rulers), { ...ric('972'), rulers: ['Titus'] });
  assert.deepEqual(lotLookup(lot.references[1], lot.rulers), other('Cohen 17'));
  assert.deepEqual(lotLookup(maesa.references[0], ['Julia Maesa']), ric('268', '', 'Elagabalus'));
  assert.deepEqual(lotLookup(lot.references[0], []), ric('972'));
  assert.equal(lotLabel(lot.references[0], lot.rulers), 'RIC 972 · Titus');
  assert.equal(lotLabel(lot.references[1], lot.rulers), 'Cohen 17 · prices only');
  assert.equal(lotLabel(only('Cf. RIC 20 var.'), []), 'RIC 20 · cf. · var.');
});

// A RIC key names a book with type data, so its row is a RIC row and the lookup reports a clean miss. Built as an Other row instead, each of these
// sent its own text to the sale sites as the phrase to median a price from.
test('a RIC key always makes a RIC row, never a prices-only Other one', () => {
  for (const [text, number] of [['Denarius. RIC 1,2', '1,2'], ['Denarius. RIC XI Nero 1', 'XI Nero 1'], ['Denarius. RIC 1073 18', '1073 18']]) {
    const found = only(text);
    assert.deepEqual(found.reference, { catalogue: 'RIC', volume: '', section: '', number }, text);
    assert.equal(found.typed, true, text);
  }
  // A row a reading rule refuses outright keeps no number at all and is still no row, and another catalogue's key still makes its prices-only row.
  assert.deepEqual(texts('Trajan. RIC II, 2, 123'), []);
  assert.deepEqual(texts('Denarius. RIC 972; Cohen 17'), ['RIC 972', 'Cohen 17']);
});

test('isLot: lot text, or a reference inside other words, but a mistyped type reference stays an error', () => {
  for (const text of ['RIC 972; Cohen 17', 'Diva Faustina I (Died 140/1) AR Denarius. RIC III (Antoninus Pius) 394a', 'cf. RIC 972', 'Lot 80: RIC 972',
    'SELEUCID KINGDOM. Antiochus VII Euergetes, 138-129 BC. AE. SC 2069']) {
    assert.equal(isLot(text), true, text);
  }
  for (const text of ['RIC XI Nero 1', 'Price P1', 'RIC 2 Titus', 'RIC Nerro 306', 'RIC I2 Nero 306', 'RIC 972', 'Titus 123', 'Craw. 44/5', 'SC 1266.2',
    'Bop Euthydemus I 24A', 'Price 23', 'RPC I 1234', 'BCD Boiotia 174b', 'Cohen 17', 'Seleucid Coins 1044.1x', '']) {
    assert.equal(isLot(text), false, text);
  }
});

test('oneLine: in lot text a line break separates like ". ", so a weight or a provenance line never joins a reference', () => {
  assert.deepEqual(texts(oneLine('Titus, as Caesar. AR Denarius\nRIC 1073\n18 mm, 3.42 g')), ['RIC 1073']);
  assert.deepEqual(texts(oneLine('TITUS, AD 69-79. AR, Denarius. Rome. Ref: RIC 972\r\nEx CNG 105, lot 123.')), ['RIC 972']);
  assert.deepEqual(texts(oneLine('Julia Maesa, 218-222 AD. Denarius. Ref: RIC 268 (Elagabalus), BMC 76, S 7756, C 36\nProvenance: Leu 12, 345')),
    ['RIC 268 (Elagabalus)', 'BMC 76', 'S 7756', 'C 36']);
  assert.deepEqual(texts(oneLine('Nero. AE As\nRIC I 306; BMCRE 228\nAD 64-65')), ['RIC I 306', 'BMCRE 228']);
  assert.equal(oneLine('HGC 4,\n1598; BCD 12'), 'HGC 4, 1598; BCD 12');
  // One reference split over lines reads with a space, as before; breaks at the ends go.
  assert.equal(oneLine('RIC I²\nNero 306'), 'RIC I² Nero 306');
  assert.equal(oneLine('\nRIC 972\r\n'), 'RIC 972');
});

test('looksLikeLot: over 120 characters, or two catalogue keys', () => {
  assert.equal(looksLikeLot('RIC 972'), false);
  assert.equal(looksLikeLot('RIC II.1 (Vespasian) 696'), false);
  assert.equal(looksLikeLot('S - C'), false);
  assert.equal(looksLikeLot(''), false);
  assert.equal(looksLikeLot(undefined), false);
  assert.equal(looksLikeLot('RIC 972; Cohen 17'), true);
  assert.equal(looksLikeLot('x'.repeat(121)), true);
  assert.equal(looksLikeLot(`${'\u200b'.repeat(200)}Crawford 44/5`), false);
});

test('KM is a key: a Krause reference, normalised, prices only, and the lot heading\'s country stays out of it', () => {
  const lot = findReferences('Netherlands. 2½ Gulden 1898. KM# 123; Scholten 782.');
  assert.deepEqual(lot.references, [
    { text: 'KM# 123', reference: other('KM# 123'), cf: false, variant: false, typed: false },
    { text: 'Scholten 782', reference: other('Scholten 782'), cf: false, variant: false, typed: false },
  ]);
  assert.equal(lotLabel(lot.references[0], lot.rulers), 'KM# 123 · prices only');
  assert.deepEqual(only('2½ Gulden 1898. KM-123.'), { text: 'KM-123', reference: other('KM# 123'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('2½ Gulden 1898. KM.123.'), { text: 'KM.123', reference: other('KM# 123'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('2½ Gulden 1898. KM#123.2a.'), { text: 'KM#123.2a', reference: other('KM# 123.2a'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('2½ Gulden 1898. KM# A123.'), { text: 'KM# A123', reference: other('KM# A123'), cf: false, variant: false, typed: false });
  // "KM" inside a word is no key.
  assert.deepEqual(texts('2½ Gulden 1898. KMS 1. AKM 5.'), []);
});

test('the standard catalogue of each collecting area is a key, so a dealer line lists every reference in it', () => {
  const lines = [
    ['TARAS, Calabria. Nomos, circa 380 BC. Vlasto 123; HN Italy 934; ACGC 12.', ['Vlasto 123', 'HN Italy 934', 'ACGC 12']],
    ['Roman Republic. L. Titurius Sabinus. Denarius. Crawford 344/1a; Sydenham 698; RBW 1353; BMCRR Rome 2320.',
      ['Crawford 344/1a', 'Sydenham 698', 'RBW 1353', 'BMCRR Rome 2320']],
    ['Marc Antony, 32-31 BC. Denarius. CRI 350; HCRI 419; Sydenham 1216.', ['CRI 350', 'HCRI 419', 'Sydenham 1216']],
    ['Trajan, 98-117. Denarius, Rome. RIC 128; Woytek 290b; Hunter 12.', ['RIC 128', 'Woytek 290b', 'Hunter 12']],
    ['Constantius II, 337-361. AE3, Siscia. LRBC 1401; Cunetio 2452; Elmer 638.', ['LRBC 1401', 'Cunetio 2452', 'Elmer 638']],
    ['Caracalla. Tetradrachm, Antioch. Prieur 234; McAlee 677; Lindgren III 456.', ['Prieur 234', 'McAlee 677', 'Lindgren III 456']],
    ['Septimius Severus. Marcianopolis. Varbanov 1234; AMNG I/1 1234; GIC 1234; SGI 1234.',
      ['Varbanov 1234', 'AMNG I/1 1234', 'GIC 1234', 'SGI 1234']],
    ['Hadrian. Tetradrachm, Alexandria. Emmett 838 (R2); Dattari 5678; Milne 1234; Geissen 1234.',
      ['Emmett 838', 'Dattari 5678', 'Milne 1234', 'Geissen 1234']],
    ['Judaea. Bar Kokhba Revolt. Zuz. Hendin 1435; Meshorer 123; TJC 234; AJC II 12.',
      ['Hendin 1435', 'Meshorer 123', 'TJC 234', 'AJC II 12']],
    ['Seleukid Empire. Antiochos III. Drachm. WSM 1234; CSE II 456; SMA 12.', ['WSM 1234', 'CSE II 456', 'SMA 12']],
    ['Ptolemy II. Tetradrachm, Alexandria. CPE 456; Svoronos 552.', ['CPE 456', 'Svoronos 552']],
    ['Parthia. Mithradates II. Drachm, Rhagae. Sellwood 24.9; Shore 76; Sell. 25.1.', ['Sellwood 24.9', 'Shore 76', 'Sell. 25.1']],
    ['Sasanian Kings. Shapur I, 240-272. Drachm. Göbl I/1; SNS 12.', ['Göbl I/1', 'SNS 12']],
    ['CELTIC, Northeast Gaul. Stater. LT XXII 1234; DT 123; Scheers 12.', ['LT XXII 1234', 'DT 123', 'Scheers 12']],
    ['CELTIC, Britain. Durotriges. Stater. ABC 1244; VA 1234; Hobbs 2525.', ['ABC 1244', 'VA 1234', 'Hobbs 2525']],
    ['Umayyad Caliphate. Dirham, Wasit AH 100. Album 128; SICA 1234; Walker 123.', ['Album 128', 'SICA 1234', 'Walker 123']],
    ['Justinian I, 527-565. Follis, Nicomedia. MIBEC 12; Ratto 1234; MEC 1, 12.', ['MIBEC 12', 'Ratto 1234', 'MEC 1, 12']],
    ['Netherlands. Ducat 1729. Friedberg 285; Davenport 1234; Dav. 4567.', ['Friedberg 285', 'Davenport 1234', 'Dav. 4567']],
  ];
  for (const [line, expected] of lines) assert.deepEqual(texts(line), expected, line);
});

test('the dotted keys keep their literal dot, so a key plus one more letter is not one', () => {
  assert.deepEqual(texts('Cohn 12. Cra 12. Cro 12. Crawl 12. Sells 100. Bopp 12. Davy 12. Sella 12.'), []);
  assert.deepEqual(texts('Rev: Selle curule entre 2 epis.'), []);
  assert.deepEqual(texts('Roman Republic. Denarius. Cr, 344/1a.'), []);
  assert.deepEqual(texts('Cr. 344/1a; Coh. 309; Craw. 44/5; Syd. 698; Bop. 1C; Sell. 25.1; Dav. 4567.'),
    ['Cr. 344/1a', 'Coh. 309', 'Craw. 44/5', 'Syd. 698', 'Bop. 1C', 'Sell. 25.1', 'Dav. 4567']);
});

test('a plain surname counts only with its own number, so a scholar and a year in prose is no reference', () => {
  assert.deepEqual(texts('A rare provincial bronze. Butcher 2004 notes 3 obverse dies for this issue. RPC IV 1234.'), ['RPC IV 1234']);
  assert.deepEqual(texts('Athens. New Style tetradrachm. Thompson 1961 dates the issue to 135/4 BC.'), []);
  assert.deepEqual(texts('Tetradrachm. Newell 1938 published this obverse die. Price 3949.'), ['Price 3949']);
  assert.deepEqual(texts('Milne 1933 records 4 specimens.'), []);
  assert.deepEqual(texts('Metcalf 1995 volume 3 covers this mint.'), []);
  assert.deepEqual(texts('Erworben im Sommer 1994 bei Muenzhandlung Ritter. RIC IV 12.'), ['RIC IV 12']);
  assert.deepEqual(texts('Roman Imperial. Sestertius. With an old Seaby 1970 ticket. RIC III 623.'), ['RIC III 623']);
  assert.deepEqual(texts('NGC MS 62. Walker 1956 records 12 specimens of this dirham. Album 123.'), ['Album 123']);
  assert.deepEqual(texts('Tetradrachm, purchased from Ratto 1927, 345 francs. Sear 1234.'), ['Sear 1234']);
  // The citation itself still reads: its number is the whole of it.
  assert.deepEqual(texts('Judaea. Prutah. Hendin 1243. Fine.'), ['Hendin 1243']);
  // An edition between the key and the number is read past, so the citation is the number after it, not the ordinal.
  assert.deepEqual(texts('Judaea. Prutah. Hendin 6th ed. 1243. Fine.'), ['Hendin 1243']);
  assert.deepEqual(texts('Album 3rd ed. 1234.'), ['Album 1234']);
  // An ordinal with no number after it is still no reference.
  assert.deepEqual(texts('Judaea. Prutah. Hendin 6th ed. Fine.'), []);
});

test('every plain surname key is guarded, so a bibliographic aside in a lot is never a reference', () => {
  assert.deepEqual(texts('Trajan, 98-117. Tetradrachm of Antioch. Prieur 1506; McAlee 452. Butcher 2004 notes three obverse dies.'),
    ['Prieur 1506', 'McAlee 452']);
  assert.deepEqual(texts('Tetradrachm of Antioch. See Prieur 2000, p. 12 for the dies. RPC III 1234.'), ['RPC III 1234']);
  for (const aside of ['Emmett 1996 lists the regnal years', 'Meshorer 1982 dates the issue', 'Woytek 2010 records five obverse dies',
    'Bastien 1976 publishes this bust type', 'Mildenberg 1984 reads the letters', 'Vlasto 1899 owned this piece',
    'Alram 1986 lists the legend', 'Morrisson 1970 catalogues the Paris cabinet', 'Bitkin 2003 prices it higher',
    'Szaivert 1984 dates the emission', 'Friedberg 2017 illustrates the type', 'Bellinger 1940 excavated the hoard',
    'Christiansen 1988 counted the dies', 'Le Rider 1977 grouped the issues', 'Fischer-Bossert 1999 dated the dies',
    'Gnecchi 1912 published the medallions', 'Troxell 1997 revised the sequence', 'Lindgren 1989 bought it in Athens']) {
    assert.deepEqual(texts(`Denarius. ${aside}.`), [], aside);
  }
  // The citations themselves still read: a rarity bracket or a variety after the number is part of the reference, not prose.
  assert.deepEqual(texts('Tetradrachm. Prieur 1506 var.; Emmett 838 (R2); Lindgren III 456.'), ['Prieur 1506', 'Emmett 838', 'Lindgren III 456']);
});

test('a ruler, a city and a field letter are not keys, however a number follows them', () => {
  // Albert I and II head Belgian, Monegasque and Saxon lots far more often than Rainer Albert's handbook is cited.
  assert.deepEqual(texts('BELGIUM. Albert I, 1909-1934. 20 Francs 1914, Brussels. KM# 78. Good VF.'), ['KM# 78']);
  assert.deepEqual(texts('MONACO. Albert II. 2 Euro 2007.'), []);
  assert.deepEqual(texts('SAXONY. Albert 1485-1500. Groschen. KM# 12.'), ['KM# 12']);
  // Köln is guarded as its transliteration is.
  assert.deepEqual(texts('Köln Erzbistum 12'), []);
  assert.deepEqual(texts('Germany. Köln. 1 Taler 1705. Dav. 5155.'), ['Dav. 5155']);
  assert.deepEqual(texts('Alexandria. Köln 1234. RIC 12.'), ['Köln 1234', 'RIC 12']);
  // Nothing in the clause decides "Butcher 2004. Prieur 123." either, so that reference is kept too: a stray prices-only row is the cheaper failure.
  assert.deepEqual(texts('A rare provincial bronze. Butcher 2004. Prieur 123.'), ['Butcher 2004', 'Prieur 123']);
  // The short Celtic keys need their number straight after them; La Tour's plate volume may come between.
  assert.deepEqual(texts('Celtic. Obv: blank. Rev: horse left, VA below 12.'), []);
  assert.deepEqual(texts('VF. Struck on a broad flan, LT in exergue 12 mm.'), []);
});

test('a key straight after another is part of that reference, not a second catalogue', () => {
  assert.deepEqual(texts('Sear GIC 1234'), ['Sear GIC 1234']);
  assert.deepEqual(texts('Sear SGI 1234'), ['Sear SGI 1234']);
  assert.deepEqual(texts('SNG Klein 123'), ['SNG Klein 123']);
  assert.deepEqual(texts('SNG Hunter 12'), ['SNG Hunter 12']);
  assert.equal(looksLikeLot('Sear GIC 1234'), false);
  assert.equal(looksLikeLot('SNG Klein 123'), false);
});

test('a key the run-on rule has already dropped no longer suppresses the key after it', () => {
  // "Sear GIC" carries no number of its own, so the reference is SGI's; only the key before a kept one joins it.
  assert.deepEqual(texts('Sear GIC SGI 1234'), ['SGI 1234']);
  assert.deepEqual(texts('Denarius. BMC Sear SG 6829.'), ['SG 6829']);
  // A single run-on still reads as one reference.
  assert.deepEqual(texts('Sear GIC 1234; SNG Klein 123'), ['Sear GIC 1234', 'SNG Klein 123']);
});

test('a Sear Greek reference keeps its book title, so "Sear GCV 2757" is still an SG number', () => {
  assert.deepEqual(only('Athens. Tetradrachm. Sear GCV 2757.'), { text: 'Sear GCV 2757', reference: other('SG 2757'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Athens. Tetradrachm. Sear SG 6829.'), { text: 'Sear SG 6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Athens. Tetradrachm. Sear Greek 6829.'), { text: 'Sear Greek 6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('Athens. Tetradrachm. Sear SGCV II 6829.'), { text: 'Sear SGCV II 6829', reference: other('SG 6829'), cf: false, variant: false, typed: false });
  // Sear's own Roman and Byzantine numbers stay as the dealer wrote them.
  assert.deepEqual(only('Denarius. Sear 1234.'), { text: 'Sear 1234', reference: other('Sear 1234'), cf: false, variant: false, typed: false });
});

test('Y# is read glued to its number, as KM# is', () => {
  assert.deepEqual(texts('CHINA. Dollar Year 3. Y#31.'), ['Y#31']);
  assert.deepEqual(texts('CHINA. Dollar Year 3. Y#31a.'), ['Y#31a']);
  assert.deepEqual(texts('NETHERLANDS. 2½ Gulden 1898. Y# 123. VF.'), ['Y# 123']);
});

test('a Y# reference is normalised as KM# is, so its spellings are one row and one search', () => {
  assert.deepEqual(only('CHINA. Dollar Year 3. Y#31.'), { text: 'Y#31', reference: other('Y# 31'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('CHINA. Dollar Year 3. Y# 31.'), { text: 'Y# 31', reference: other('Y# 31'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('CHINA. Dollar Year 3. Y#31a.'), { text: 'Y#31a', reference: other('Y# 31a'), cf: false, variant: false, typed: false });
  assert.deepEqual(only('RUSSIA. Rouble 1899. Y#59.3.'), { text: 'Y#59.3', reference: other('Y# 59.3'), cf: false, variant: false, typed: false });
  // The two spellings are the same reference, so the second is the duplicate it is.
  assert.deepEqual(texts('CHINA. Dollar Year 3. Y#31; Y# 31.'), ['Y#31']);
});

test('the word-like keys need their number straight after them, and an auction house of the same name is never one', () => {
  // "Hunter", "Album", "Shore" and "Ratto" are ordinary words, a sale house and a cabinet name as well as catalogues.
  assert.deepEqual(texts('Hunter Coin Cabinet, Glasgow. RIC 128.'), ['RIC 128']);
  assert.deepEqual(texts('Sold by Stephen Album 12. RIC 128.'), ['RIC 128']);
  assert.deepEqual(texts('Rodolfo Ratto 1234. RIC 128.'), ['RIC 128']);
  assert.deepEqual(texts('Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago'), []);
});

// The word limit on an Other part (0.22) is the Reference box's rule, not the lot path's: a lot still lists every reference in its prose.
test('a lot description with two catalogue keys still lists its references', () => {
  const text = 'Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago. BCD Boiotia 174b; HGC 4, 1218.';
  assert.equal(isLot(text), true);
  assert.deepEqual(findReferences(text).references.map((found) => found.text), ['BCD Boiotia 174b', 'HGC 4, 1218']);
  // Prose alone names no catalogue, so it is neither a lot nor a reference.
  assert.equal(isLot('Good VF, 3.21 g, 6h, lot 42, from an old album, bought in Vienna 12 years ago'), false);
});

// A group lot's one reference is listed and can be opened: the row's term is the rule the click applies, so the two must agree.
test('a group lot listing several numbers under one key gives a row that can be searched', () => {
  const text = 'GREEK. Cilicia, Tarsos. Lot of 5 AR staters, 4th century BC. SNG von Aulock 5960, 5961, 5962, 5963, 5964. Fine to VF.';
  const [found, ...rest] = findReferences(text).references;
  assert.deepEqual(rest, []);
  assert.equal(found.text, 'SNG von Aulock 5960, 5961, 5962, 5963, 5964');
  assert.equal(defaultTerm(found.reference), '"SNG von Aulock 5960, 5961, 5962, 5963, 5964"');
});

test('a publication year after a key is no type number when the clause says it is a book', () => {
  // A typed catalogue whose numbers never reach the year: Crawford's Republic ends in the 500s, a Bopearachchi series is one or two digits.
  assert.deepEqual(texts('See Crawford 1974, p. 745, for the chronology. Crawford 443/1; Sydenham 1006.'), ['Crawford 443/1', 'Sydenham 1006']);
  assert.deepEqual(texts('Bopearachchi 1991 assigns this to Series 24. MIG 217.'), ['MIG 217']);
  // Every other catalogue needs the evidence: a cue in front of the year, or a page, plate or verb of argument behind it.
  const asides = [['Price 1991 dates the issue to 325 BC. Price 3949.', ['Price 3949']],
    ['Mitchiner 1975, p. 23, illustrates a similar piece. MIG 217.', ['MIG 217']],
    ['Sear 2000 lists this as common. RIC II 456.', ['RIC II 456']],
    ['Svoronos 1904 pl. 12. SNG Cop 123.', ['SNG Cop 123']],
    ['Kroll 1993 discusses the series. SNG Cop 12.', ['SNG Cop 12']],
    ['Sydenham 1952 remains the standard. Crawford 443/1.', ['Crawford 443/1']],
    ['Cohen 1880 lists two variants. RIC 972.', ['RIC 972']],
    ['McClean 1923 records this. SNG Cop 12.', ['SNG Cop 12']],
    ['DOC 1973 catalogues the type. SB 139.', ['SB 139']],
    ['MEC 1986 covers the period. SB 139.', ['SB 139']],
    ['Published by Sommer 1994.', []],
    ['Attributed following Hendin 2010.', []],
    ['See Metcalf 1995.', []],
    ['Discussed in Walker 1956.', []],
    ['Compare Newell 1938.', []],
    ['Dated by Estiot 2004.', []],
    ['Cited in Grierson 1982.', []],
    ['Purchased from Seaby 1975. RSC 12.', ['RSC 12']],
    ['Price 1991, p. 123. Price 3949.', ['Price 3949']],
    ['As Price 1991 argues, the issue is late. Price 3949.', ['Price 3949']],
    ['Hendin (2010) revised the dates. RPC I 4846.', ['RPC I 4846']]];
  for (const [line, expected] of asides) assert.deepEqual(texts(line), expected, line);
  // Nothing decides these, so the reference is kept: Price runs past 3900 and Hendin, Sear, Svoronos and SNG Copenhagen all number into the 1500s.
  assert.deepEqual(texts('Alexander III. Tetradrachm. Price 1991.'), ['Price 1991']);
  assert.deepEqual(texts('Judaea. Prutah. Hendin 1610; TJC 234.'), ['Hendin 1610', 'TJC 234']);
  assert.deepEqual(texts('Alexandria. Köln 1234. RIC 12.'), ['Köln 1234', 'RIC 12']);
  // Nothing in the clause decides "Butcher 2004. Prieur 123." either, so that reference is kept too: a stray prices-only row is the cheaper failure.
  assert.deepEqual(texts('A rare provincial bronze. Butcher 2004. Prieur 123.'), ['Butcher 2004', 'Prieur 123']);
});

test('a house sale, a certificate and a hammer price are not catalogues', () => {
  const lines = [['Album 46, lot 1234. SICA 123.', ['SICA 123']],
    ['Aureo & Calico 300, lot 45. RIC II 123.', ['RIC II 123']],
    ['Freeman & Sear 15, lot 123. Crawford 443/1.', ['Crawford 443/1']],
    ['Sear 25, lot 12. RIC 123.', ['RIC 123']],
    ['Includes David R. Sear certificate no. 12345. RIC II 123.', ['RIC II 123']],
    ['Estimate 500 CHF. Price realized 1,200 CHF. RIC 123.', ['RIC 123']],
    ['Price realised: 1200 EUR. Hammer 1000. RIC 123.', ['RIC 123']]];
  for (const [line, expected] of lines) assert.deepEqual(texts(line), expected, line);
  // The catalogues of the same name still read where no sale, name or price is around them.
  assert.deepEqual(texts('Umayyad Caliphate. Dirham. Album 128; SICA 1234.'), ['Album 128', 'SICA 1234']);
  assert.deepEqual(texts('Denarius. Sear 1234; Price 3949.'), ['Sear 1234', 'Price 3949']);
});

test('one short word from a closed list may sit between a key and its number', () => {
  const lines = [['Judaea. Prutah. Hendin 6th ed. 1243. Fine.', ['Hendin 1243']],
    ['Judaea. Prutah. Hendin 1243 (6th ed.). Fine.', ['Hendin 1243']],
    ['Hadrian. Tetradrachm, Alexandria. Dattari-Savio Pl. 123, 456.', ['Dattari-Savio Pl. 123, 456']],
    ['Septimius Severus. Marcianopolis. Varbanov (Eng.) 1234.', ['Varbanov (Eng.) 1234']],
    ['Alexandria. Tetradrachm. Recueil general 123.', ['Recueil general 123']],
    ['Alexandria. Tetradrachm. Recueil général 123.', ['Recueil général 123']],
    ['Indo-Scythian. Azes. Drachm. Senior ISCH 123.', ['Senior ISCH 123']],
    ['Caracalla. Tetradrachm. Lindgren-Kovacs 123.', ['Lindgren-Kovacs 123']],
    ['Kushan. Vima Kadphises. Jongeward & Cribb 123.', ['Jongeward & Cribb 123']],
    ['Byzantine. Solidus. Morrisson BnF 5/Cp/AV/12.', ['Morrisson BnF 5/Cp/AV/12']],
    ['Trajan. Denarius. Hunter, vol. III, 45.', ['Hunter III, 45']],
    ['Byzantine. Solidus. Fueg I.A.1.', ['Fueg I.A.1']],
    ['Islamic. Diler Ab-123.', ['Diler Ab-123']]];
  for (const [line, expected] of lines) assert.deepEqual(texts(line), expected, line);
  // Only a word from the list: any word at all would undo the sale and name guards.
  assert.deepEqual(texts('Price realized 1,200 CHF.'), []);
  assert.deepEqual(texts('MONACO. Albert II. 2 Euro 2007.'), []);
  assert.deepEqual(texts('Hunter Coin Cabinet, Glasgow. RIC 128.'), ['RIC 128']);
});

test('provenance cuts its own sentence, so the references written after it are still read', () => {
  const lines = [['Ex Leu 4, 25 May 1972, lot 123. RIC 972; Cohen 17.', ['RIC 972', 'Cohen 17']],
    ['From the Sunrise Collection. Gobl I/1; SNS II 12.', ['Gobl I/1', 'SNS II 12']],
    ['From the Weber Collection, part II. SNG ANS 123.', ['SNG ANS 123']],
    ['Ex Hunter duplicates. RIC II 45.', ['RIC II 45']],
    ['Provenance: Gorny & Mosch 250. RIC II 45; BMC 12.', ['RIC II 45', 'BMC 12']],
    ['Ex CNG 105, lot 123. Ex NAC 50, lot 4. RIC 972.', ['RIC 972']]];
  for (const [line, expected] of lines) assert.deepEqual(texts(line), expected, line);
  // Provenance after the references still takes nothing with it.
  assert.deepEqual(texts('RIC 972; Cohen 17. Ex Leu 4, 25 May 1972, lot 123.'), ['RIC 972', 'Cohen 17']);
  assert.deepEqual(texts('RIC 972. From the Smith Collection, RIC 1'), ['RIC 972']);
});

test('the de-accented spellings are keys as their accented ones are, and Noe is one', () => {
  assert.deepEqual(texts('Alexandria. Koln 1234. RIC 12.'), ['Koln 1234', 'RIC 12']);
  assert.deepEqual(texts('Syracuse. Tetradrachm. Bohringer 411; SNG ANS 12.'), ['Bohringer 411', 'SNG ANS 12']);
  assert.deepEqual(texts('Metapontum. Nomos. Noe 322; HN Italy 1234.'), ['Noe 322', 'HN Italy 1234']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. Delestree 240.'), ['Delestree 240']);
});

test('the name guard wants a name, so a conjunction, a mintmark or a regnal numeral is not one', () => {
  // "&" and "and" join two references as often as they join a firm's two partners: what tells them apart is a word, never a number, in front.
  const joined = [['Titus. Denarius. RIC 972 and Cohen 17.', ['RIC 972', 'Cohen 17']],
    ['Nero. AE As. RIC I 543 and BMCRE 380. Fine.', ['RIC I 543', 'BMCRE 380']],
    ['Augustus. RIC 207 & BMC 12.', ['RIC 207', 'BMC 12']],
    ['Titus. RIC II 972 & RSC 123.', ['RIC II 972', 'RSC 123']],
    ['Roman Republic. Crawford 443/1 and Sydenham 1006.', ['Crawford 443/1', 'Sydenham 1006']],
    ['Judaea. Prutah. Hendin 1243 & TJC 234.', ['Hendin 1243', 'TJC 234']],
    ['Alexandria. Emmett 838 & Dattari 5678.', ['Emmett 838', 'Dattari 5678']]];
  for (const [line, expected] of joined) assert.deepEqual(texts(line), expected, line);
  // Ordinary lot furniture ends in a single letter and a full stop; none of it is a forename's initial.
  const furniture = [['Constantius II. AE3. Siscia, officina B. RIC VIII 123; LRBC 1000.', ['RIC VIII 123', 'LRBC 1000']],
    ['Honorius. Solidus. Mintmark R. RIC X 1205.', ['RIC X 1205']],
    ['Nero. Bronze Æ. RIC 543.', ['RIC 543']],
    ['Titus. AE. Rev: S C. RIC 543.', ['RIC 543']],
    ['Antioch. Series A. Prieur 1234.', ['Prieur 1234']],
    ['Philip I. RIC 12.', ['RIC 12']],
    ['Seleukid Kingdom. Antiochos I. SC 322.', ['SC 322']],
    ['RPC I. Sear 12.', ['Sear 12']]];
  for (const [line, expected] of furniture) assert.deepEqual(texts(line), expected, line);
  // The names themselves still drop.
  assert.deepEqual(texts('Includes David R. Sear certificate no. 12345. RIC II 123.'), ['RIC II 123']);
  assert.deepEqual(texts('Aureo & Calico 300. RIC II 123.'), ['RIC II 123']);
  assert.deepEqual(texts('Freeman & Sear 15. Crawford 443/1.'), ['Crawford 443/1']);
});

test('the evidence for a book is in the reference\u2019s own clause, not the sentence before it', () => {
  // "As" is the commonest Roman bronze denomination as well as a citation cue, so a cue across a full stop is no cue at all.
  const denomination = [['Nero, 54-68. As. RIC 1600.', ['RIC 1600']],
    ['Claudius. AE As. Sear 1857; RIC I 113.', ['Sear 1857', 'RIC I 113']],
    ['Domitian. As. Cohen 1550.', ['Cohen 1550']],
    ['Titus as Caesar. As. Sear 2000.', ['Sear 2000']]];
  for (const [line, expected] of denomination) assert.deepEqual(texts(line), expected, line);
  // A plate hung on the number with a comma is part of the citation; a reign date or a run of further numbers is not a page range.
  const kept = [['Ptolemaic. Svoronos 1600, pl. 20; SNG Cop 123.', ['Svoronos 1600', 'SNG Cop 123']],
    ['Alexander III. Tetradrachm. Price 1533, pl. 12.', ['Price 1533']],
    ['Roman. Sear 1962, pl. 3.', ['Sear 1962']],
    ['Byzantine. SB 1868, pl. 44.', ['SB 1868']],
    ['Alexander III. Tetradrachm. Price 1533, 336-323 BC.', ['Price 1533']],
    ['Roman. Sear 1962, 54-68 AD.', ['Sear 1962']],
    ['Alexander III. Tetradrachm. Price 1533, 1534-1536.', ['Price 1533']],
    // A verb that describes the coin or its entry says nothing about a book's author.
    ['Roman. RIC 1600 reads IMP CAES on the obverse.', ['RIC 1600']],
    ['Byzantine. SB 1868 gives the mint as Constantinople.', ['SB 1868']],
    ['Roman. RIC 1600 places this at Lugdunum.', ['RIC 1600']],
    ['Roman. RIC 1600 attributes it to Siscia.', ['RIC 1600']]];
  for (const [line, expected] of kept) assert.deepEqual(texts(line), expected, line);
  // The bibliographic shapes still drop: a plate written as prose, a page, and the verbs an author is the subject of.
  const dropped = [['Svoronos 1904 pl. 12. SNG Cop 123.', ['SNG Cop 123']],
    ['See Crawford 1974, p. 745, for the chronology. Crawford 443/1.', ['Crawford 443/1']],
    ['Sydenham 1952 remains the standard. Crawford 443/1.', ['Crawford 443/1']],
    ['MEC 1986 covers the period. SB 139.', ['SB 139']],
    ['Sear 2000 lists this as common. RIC II 456.', ['RIC II 456']],
    ['Published by Sommer 1994.', []],
    ['Cited in Grierson 1982.', []]];
  for (const [line, expected] of dropped) assert.deepEqual(texts(line), expected, line);
});

test('a RIC volume keeps its edition, and a lot number belongs to a house', () => {
  const found = only('Nero. AR Denarius. RIC I (2nd ed.) Nero 306.');
  assert.equal(found.text, 'RIC I (2nd ed.) Nero 306');
  assert.deepEqual(found.reference, ric('306', 'I (2nd edition)', 'Nero'));
  // An edition after the whole reference is still a remark on the book.
  assert.deepEqual(texts('Judaea. Prutah. Hendin 1243 (6th ed.). Fine.'), ['Hendin 1243']);
  // Only a house's number is a sale number; a catalogue's is its own.
  assert.deepEqual(texts('Price 3949, lot 12. M\u00fcller 123.'), ['Price 3949', 'M\u00fcller 123']);
  assert.deepEqual(texts('RIC 972, lot 123.'), ['RIC 972']);
  assert.deepEqual(texts('Judaea. Hendin 1243, lot 45. TJC 234.'), ['Hendin 1243', 'TJC 234']);
  assert.deepEqual(texts('Album 46, lot 1234. SICA 123.'), ['SICA 123']);
  assert.deepEqual(texts('Sear 25, lot 12. RIC 123.'), ['RIC 123']);
  // A provenance ends at the end of its sentence, not at the abbreviation inside it.
  assert.deepEqual(texts('Ex Dr. Sear collection, 1975. RIC 972.'), ['RIC 972']);
});

test('a weight or a die axis in front of a name is no initial, and a dealer\u2019s aside is no book', () => {
  // The initial and partner guards are read case-sensitively: "8 h." is how a dealer writes the die axis, not how anyone writes a forename.
  assert.deepEqual(texts('ATTICA. Athens. Circa 393-355 BC. Silver, 23 mm, 17.21 g, 8 h. Sear 2537. SNG Cop 63.'), ['Sear 2537', 'SNG Cop 63']);
  assert.deepEqual(texts('ROMAN EMPIRE. Nero. AR Denarius. Rome, AD 65. 3.42 g. Sear 1943; RIC I 52.'), ['Sear 1943', 'RIC I 52']);
  assert.deepEqual(texts('David R. Sear certificate no. 12345.'), []);
  assert.deepEqual(texts('Aureo & Calico 300, lot 45.'), []);
  // Only a firm's own key takes the partner rule, so a run of catalogues reads as itself.
  assert.deepEqual(texts('Sydenham and Crawford 443/1.'), ['Crawford 443/1']);
  assert.deepEqual(texts('RIC 972 and Cohen 17.'), ['RIC 972', 'Cohen 17']);
  // A die match is not a citation, however the dealer phrases it.
  assert.deepEqual(texts('Same obverse die as Price 1533.'), ['Price 1533']);
  assert.deepEqual(texts('Struck from the same dies as Sear 1998.'), ['Sear 1998']);
  assert.deepEqual(texts('As RIC 1600, but with a star.'), ['RIC 1600']);
  // A colon or a note number is the dealer writing about the coin; only a page marker after a comma is a book.
  assert.deepEqual(texts('RIC 1600: this coin.'), ['RIC 1600']);
  assert.deepEqual(texts('RIC 1600, no. 5.'), ['RIC 1600']);
  assert.deepEqual(texts('Svoronos 1600, pl. 20.'), ['Svoronos 1600']);
  assert.deepEqual(texts('Svoronos 1904 pl. 12, see Newell 1938 p. 4.'), []);
  // A firm or a collection ends the provenance sentence like any other, and what follows it is read.
  assert.deepEqual(texts('Ex the J. P. Morgan coll. RIC 972.'), ['RIC 972']);
  assert.deepEqual(texts('From Roma Numismatics Ltd. RIC 972.'), ['RIC 972']);
});

test('a house writes its own separator between a key and its number, and a hyphen is not always one', () => {
  // Stephen Album glues the number on with a hyphen and every Indian house puts a hash with spaces round it; both are the whole reference.
  assert.deepEqual(texts('JUDAEA. Prutah. Hendin-1188.'), ['Hendin-1188']);
  assert.deepEqual(texts('GREEK. Tetradrachm. Sear-6829.'), ['Sear-6829']);
  assert.deepEqual(texts('GREEK. AR Obol. SNG Cop-63.'), ['SNG Cop-63']);
  assert.deepEqual(texts('EGYPT. Tetradrachm. Emmett # 874.'), ['Emmett # 874']);
  assert.deepEqual(texts('JUDAEA. Prutah. (Hendin # 1188).'), ['Hendin # 1188']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Album-1827; SICA 123.'), ['Album-1827', 'SICA 123']);
  // The museums write a dot and a few write a colon; the separator is the house's, never part of the number.
  assert.deepEqual(texts('SASANIAN. Ardashir I. AR Drachm. Paruck.285; SNS I 12.'), ['Paruck.285', 'SNS I 12']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Klat.587b; Album 128.'), ['Klat.587b', 'Album 128']);
  assert.deepEqual(texts('HUNNIC. AR Drachm. Vondrovec.001A.'), ['Vondrovec.001A']);
  assert.deepEqual(texts('SAMANID. AR Dirham. SNAT-XIVc:336; Album 1449.'), ['SNAT-XIVc:336', 'Album 1449']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. Delestree:161; DT 240.'), ['Delestree:161', 'DT 240']);
  // A typed catalogue is read the same whichever separator carries its number.
  assert.deepEqual(only('ROMAN. Denarius. RIC-972.'), { text: 'RIC-972', reference: ric('972'), cf: false, variant: false, typed: true });
  assert.deepEqual(only('ROMAN. Denarius. RIC:972.').reference, ric('972'));
  // The numbers in this area are not plain digits: a letter code, a dotted number, a variant letter and a glued "var" all belong to the reference.
  assert.deepEqual(texts('INDO-SCYTHIAN. Azes II. AR Tetradrachm. Senior-98.245T.'), ['Senior-98.245T']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Klat-581.b; Album 128.'), ['Klat-581.b', 'Album 128']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Klat 61v4.'), ['Klat 61v4']);
  assert.deepEqual(texts('EGYPT. Tetradrachm. Emmett-874var.'), ['Emmett-874var']);
  // A hyphen is also a range, a sub-number, a "not in" marker and an ordinary dash between words, and a dot is also a sentence end and a decimal.
  assert.deepEqual(texts('JUDAEA. Prutah. Hendin 1188-1190.'), ['Hendin 1188-1190']);
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. VA 620-7.'), ['VA 620-7']);
  assert.deepEqual(texts('ROMAN. Denarius. RIC -; Cohen 17.'), ['Cohen 17']);
  assert.deepEqual(texts('JUDAEA. Prutah. Hendin --; TJC 234.'), ['TJC 234']);
  assert.deepEqual(texts('SASANIAN. AR Drachm. Flesche -. SNS--. Paruck 285.'), ['Paruck 285']);
  assert.deepEqual(texts('ROMAN. AE As. Arab-Byzantine imitation. RIC I 543.'), ['RIC I 543']);
  assert.deepEqual(texts('Caracalla. Tetradrachm. Lindgren-Kovacs 123.'), ['Lindgren-Kovacs 123']);
  assert.deepEqual(texts('TITUS. AR Denarius. RIC 972. Cohen 17.'), ['RIC 972', 'Cohen 17']);
  assert.deepEqual(texts('Parthia. Drachm. Sellwood 24.9.'), ['Sellwood 24.9']);
  // A grading term, an auction house, a scholar in a footnote and a lot number are no more references glued than they are spaced.
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Good VF. GH-109.'), []);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Stephen Album-1827; SICA 123.'), ['SICA 123']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Stephen Album # 1827; SICA 123.'), ['SICA 123']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Album # 46, lot 1234. SICA 123.'), ['SICA 123']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Album-46, lot 1234. SICA 123.'), ['SICA 123']);
  assert.deepEqual(texts('Tetradrachm of Antioch. See Butcher-2004, p. 12. RPC IV 1234.'), ['RPC IV 1234']);
  assert.deepEqual(texts('ROMAN. Denarius. Lot #123. RIC 972.'), ['RIC 972']);
});

test('the countermark, Kushan, Sasanian and Islamic corpora are keys', () => {
  // Each is cited as the whole reference, so the surname guard is enough; every line also carries a key that reads today.
  assert.deepEqual(texts('ROMAN. AE As, countermarked. Howgego 123; RIC I 543.'), ['Howgego 123', 'RIC I 543']);
  assert.deepEqual(texts('ROMAN. AE As, countermarked TIB IM. Pangerl 45. RIC I 543.'), ['Pangerl 45', 'RIC I 543']);
  assert.deepEqual(texts('KUSHAN. Kanishka I. AV Dinar. Rosenfield 123; Gobl 57.'), ['Rosenfield 123', 'Gobl 57']);
  assert.deepEqual(texts('SASANIAN. Shapur II. AR Drachm. Schindel 12; SNS II 12.'), ['Schindel 12', 'SNS II 12']);
  assert.deepEqual(texts('SASANIAN. Khusro II. AR Drachm. Saeedi 345; SNS III 12.'), ['Saeedi 345', 'SNS III 12']);
  assert.deepEqual(texts('SASANIAN. Ardashir I. AR Drachm. Paruck 345; SNS I 12.'), ['Paruck 345', 'SNS I 12']);
  assert.deepEqual(texts('HUNNIC. Alchon. AR Drachm. Vondrovec 345; Gobl Em. 60.'), ['Vondrovec 345', 'Gobl Em. 60']);
  assert.deepEqual(texts('UMAYYAD. AR Dirham. Wasit, AH 96. Klat 686; Album 128.'), ['Klat 686', 'Album 128']);
  assert.deepEqual(texts('MAMLUK. AR Dirham. Balog 229; Album 1000.'), ['Balog 229', 'Album 1000']);
  assert.deepEqual(texts('ARAB-BYZANTINE. AE Fals. Goodwin 123; Album 3512.'), ['Goodwin 123', 'Album 3512']);
  assert.deepEqual(texts('ARTUQID. AE Dirham. Artuk 1234; Album 1827.'), ['Artuk 1234', 'Album 1827']);
  assert.deepEqual(texts('SPAIN, Umayyad. AR Dirham. Vives 123; Album 340.'), ['Vives 123', 'Album 340']);
  // A plain key needs no guard: SNAT carries its volume as a word, and MIRB is not swallowed by MIR.
  assert.deepEqual(texts('SAMANID. AR Dirham. SNAT XIVa 456; Album 1449.'), ['SNAT XIVa 456', 'Album 1449']);
  assert.deepEqual(texts('SAMANID. AR Dirham. SNAT Ia 123.'), ['SNAT Ia 123']);
  assert.deepEqual(texts('INDO-SCYTHIAN. AR Tetradrachm. MACW 2158; Senior 98.245T.'), ['MACW 2158', 'Senior 98.245T']);
  assert.deepEqual(texts('ROMAN. AR Antoninianus. MIR 12; MIRB 34. RIC V 45.'), ['MIR 12', 'MIRB 34', 'RIC V 45']);
  assert.deepEqual(texts('BYZANTINE. Phocas. AE Follis. MIRB 12; SB 640.'), ['MIRB 12', 'SB 640']);
  // Byzantine and Vandal, beside the keys that already read.
  assert.deepEqual(texts('BYZANTINE. Justinian I. AE Follis. Sabatier 6; SB 163.'), ['Sabatier 6', 'SB 163']);
  assert.deepEqual(texts('VANDALS. Gunthamund. AR Siliqua. Wroth 88; MEC 1, 21.'), ['Wroth 88', 'MEC 1, 21']);
  // The Greek keys, two of them cited by plate volume.
  assert.deepEqual(texts('CARIA, Rhodes. AR Drachm. Ashton 209; SNG Keckman 552.'), ['Ashton 209', 'SNG Keckman 552']);
  assert.deepEqual(texts('PAEONIA. Patraos. AR Tetradrachm. Draganov 434; SNG ANS 1035.'), ['Draganov 434', 'SNG ANS 1035']);
  assert.deepEqual(texts('MYSIA, Kyzikos. EL Stater. Von Fritze I, 134; SNG France 12.'), ['Von Fritze I, 134', 'SNG France 12']);
  assert.deepEqual(texts('THRACE, Mesembria. AV Stater. Karayotov I, 45; SNG Cop 12.'), ['Karayotov I, 45', 'SNG Cop 12']);
  assert.deepEqual(texts('PTOLEMAIC. Ptolemy II. AE Drachm. Lorber 12; CPE B123.'), ['Lorber 12', 'CPE B123']);
  // The Celtic names, beside the abbreviations that already read.
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Van Arsdell 1732; ABC 2445.'), ['Van Arsdell 1732', 'ABC 2445']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. Delestrée 240; DT 240.'), ['Delestrée 240', 'DT 240']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. LT XXII 1234; Delestree 240.'), ['LT XXII 1234', 'Delestree 240']);
  // Every one of them is prices only, and the row is the text the dealer wrote.
  assert.deepEqual(only('MAMLUK. AR Dirham. Balog 229.'),
    { text: 'Balog 229', reference: other('Balog 229'), cf: false, variant: false, typed: false });
});

test('an emission tag belongs to the reference, and a co-author does not steal it', () => {
  // Bodenstedt numbers Mytilene by emission, so "Em." is part of the number, not a remark on the book.
  assert.deepEqual(texts('LESBOS, Mytilene. EL Hekte. Bodenstedt Em. 46; SNG Cop 312.'), ['Bodenstedt Em. 46', 'SNG Cop 312']);
  assert.deepEqual(texts('LESBOS, Mytilene. EL Hekte. Bodenstedt Em 46.'), ['Bodenstedt Em 46']);
  assert.deepEqual(texts('LESBOS, Mytilene. EL Hekte. Bodenstedt 46.'), ['Bodenstedt 46']);
  assert.equal(lotLabel(only('LESBOS, Mytilene. EL Hekte. Bodenstedt Em. 46.'), []), 'Bodenstedt Em. 46 · prices only');
  // Göbl's Hunnic emissions read the same way, as they did before.
  assert.deepEqual(texts('HUNNIC. AR Drachm. Gobl Em. 60.'), ['Gobl Em. 60']);
  // "Em" is an infix, never a key of its own, and no ordinary word starting with it becomes one.
  assert.deepEqual(texts('GREEK. AR Stater. Em. 12.'), []);
  assert.deepEqual(texts('ROMAN. AR Denarius. Emission 3, Rome. RIC 12.'), ['RIC 12']);
  assert.deepEqual(texts('EGYPT. Emmett 838 (R2).'), ['Emmett 838']);
  // Cribb is the second author of the Kushan corpus: his key must not take Jongeward's reference away.
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Jongeward & Cribb 123.'), ['Jongeward & Cribb 123']);
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Cribb 12; MACW 3005.'), ['Cribb 12', 'MACW 3005']);
  // The other co-author forms are unchanged.
  assert.deepEqual(texts('SAMARIA. AR Obol. Meshorer & Qedar 12.'), ['Meshorer & Qedar 12']);
  assert.deepEqual(texts('ALEXANDRIA. Tetradrachm. Dattari-Savio Pl. 123, 456.'), ['Dattari-Savio Pl. 123, 456']);
});

test('the names left out are left out, and a scholar’s year is still not a number', () => {
  // A ruler, a find-spot, a dealer and an ordinary English word all read as themselves, so none of them is a key.
  assert.deepEqual(texts('SAXONY. Albert 1485-1500. Groschen. KM# 12.'), ['KM# 12']);
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Found in Kent 1987. ABC 2445.'), ['ABC 2445']);
  assert.deepEqual(texts('SELJUQ. Alp Arslan 1063-1072 AD. AR Dirham. Album 1670.'), ['Album 1670']);
  assert.deepEqual(texts('CELTIC, Britain. AR Unit. Rudd 123. ABC 1567.'), ['ABC 1567']);
  assert.deepEqual(texts('INDIA. AR Drachm. Rajgor 24, lot 112. Senior 12.'), ['Senior 12']);
  assert.deepEqual(texts('ROMAN EMPIRE. Trajan. AR Denarius. Miles 123 were struck at Rome. RIC II 234.'), ['RIC II 234']);
  assert.deepEqual(texts('OSTROGOTHS. AE Nummus. Demo 45 is the Croatian corpus. MEC 1, 132.'), ['MEC 1, 132']);
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Evans 1890. VA 1732.'), ['VA 1732']);
  assert.deepEqual(texts('PONTOS. AR Tetradrachm. Callatay pl. 12, D22. SNG BM 1043.'), ['SNG BM 1043']);
  // A new key is a name like the others: a cue or a verb of argument in its own clause still says "book".
  assert.deepEqual(texts('ROMAN. AE As. Countermark discussed by Howgego 1985. RIC I 543.'), ['RIC I 543']);
  assert.deepEqual(texts('BYZANTINE. AE Follis. Wroth 1908 catalogued this. SB 163.'), ['SB 163']);
  assert.deepEqual(texts('GREEK. AR Drachm. See Ashton 1988, p. 12. SNG Keckman 552.'), ['SNG Keckman 552']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Klat 2002, pl. 3. Album 128.'), ['Album 128']);
  assert.deepEqual(texts('ARAB-BYZANTINE. AE Fals. Goodwin 2005 discusses the mint. Album 3512.'), ['Album 3512']);
  assert.deepEqual(texts('PTOLEMAIC. AE Drachm. Lorber 2018 lists two. CPE B123.'), ['CPE B123']);
  assert.deepEqual(texts('KUSHAN. AV Dinar. Published by Rosenfield 1967. Gobl 57.'), ['Gobl 57']);
  assert.deepEqual(texts('HUNNIC. AR Drachm. Vondrovec 2014, vol. II. SNS II 12.'), ['SNS II 12']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. Delestree 2002, pl. 12. DT 240.'), ['DT 240']);
  // A dynasty's founder, a grading term and a Spanish verb carry no number, so no guard has to refuse them.
  assert.deepEqual(texts('ARTUQID. Artuk bin Eksuk, AH 495-502. AE Dirham. Album 1827.'), ['Album 1827']);
  assert.deepEqual(texts('ARAB-BYZANTINE. AE Fals. Goodwin, VF, RRR. Album 3512.'), ['Album 3512']);
  assert.deepEqual(texts('SPAIN. AR Dirham. Si vives 123 anos. Album 340.'), ['Album 340']);
  // A provenance sentence still takes its own names with it.
  assert.deepEqual(texts('GREEK. AR Stater. From the Lorber estate, 2019. CPE B123.'), ['CPE B123']);
  assert.deepEqual(texts('CELTIC. AR Unit. Ex the Ashton hoard, found at Ashton 1985. ABC 1567.'), ['ABC 1567']);
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Ex Van Arsdell 1989, lot 12. ABC 2445.'), ['ABC 2445']);
  assert.deepEqual(texts('MAMLUK. AR Dirham. Ex the Balog collection, 1980. Album 1000.'), ['Album 1000']);
  assert.deepEqual(texts('ARAB-BYZANTINE. AE Fals. Ex the Goodwin collection. Album 3512.'), ['Album 3512']);
});

test('the separator is glued to the number, never to the reader’s own boundary between references', () => {
  // A comma or a full stop followed by a space ends one reference and starts the next; unseparate must never read that as the house's own separator.
  assert.deepEqual(texts('Gaius (Caligula), with Agrippina Senior, 37-41. Denarius (Silver, 19 mm, 3.68 g, 6 h), Lugdunum, 37-38. RIC I 8.'), ['RIC I 8']);
  assert.deepEqual(texts('Diva Faustina Senior, 138-141. AR Denarius. RIC III 344.'), ['RIC III 344']);
  assert.deepEqual(texts('GREEK. AR Tetradrachm. Newell. 1938. SNG Cop 12.'), ['SNG Cop 12']);
  assert.deepEqual(texts('GREEK. Tetradrachm. Ashton. 209. SNG Keckman 552.'), ['SNG Keckman 552']);
  // The house forms this release exists for are unaffected — all glued straight to the number, none of them followed by ", " or ". ".
  assert.deepEqual(texts('JUDAEA. Prutah. Hendin-1188.'), ['Hendin-1188']);
  assert.deepEqual(texts('MYSIA, Kyzikos. EL Stater. Von Fritze I, 134; SNG France 12.'), ['Von Fritze I, 134', 'SNG France 12']);
  assert.deepEqual(texts('ALEXANDRIA. Tetradrachm. Dattari-Savio Pl. 123, 456.'), ['Dattari-Savio Pl. 123, 456']);
  assert.deepEqual(texts('SASANIAN. Ardashir I. AR Drachm. Paruck.285; SNS I 12.'), ['Paruck.285', 'SNS I 12']);
  // A "not in this reference" dash run followed by a bare number is still "not in", whichever key carries it.
  assert.deepEqual(texts('JUDAEA. Prutah. Hendin--, 1188.'), []);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Klat--, 686.'), []);
  assert.deepEqual(texts('PARTHIAN. Drachm. Shore---, 2044.'), []);
});

test('Price is the one typed key that is also an English word, so a colon before an amount is never a type lookup', () => {
  // "Price:1,200" is a hammer price, not a catalogue number: it still lists as a row, since 0.25 already did, but only as an Other, prices-only one —
  // never a PELLA type lookup — so the real reference beside it is the lot's only typed reference and still opens on its own.
  const withPrice = findReferences('Roman denarius. Price:1,200. RIC 972.').references;
  assert.deepEqual(withPrice.map((entry) => entry.text), ['Price:1,200', 'RIC 972']);
  assert.equal(withPrice[0].reference.catalogue, 'Other');
  assert.deepEqual(withPrice[1].reference, ric('972'));
  assert.equal(findReferences('Attractive dark patina, well centred. Buy it now Price:500.').references[0].reference.catalogue, 'Other');
  // The colon still joins a type's own key to its number — Price is the one exception, not the rule.
  assert.deepEqual(only('ROMAN. Denarius. RIC:972.').reference, ric('972'));
});

test('a countermark corpus is cited about the punch, not the host coin, so it does not end the search for the host’s ruler', () => {
  // A countermark row precedes the ruler's own name, so the RIC row must still borrow it — the row it comes with is prices-only either way.
  const [countermarked, viaPangerl, headingFirst] = [
    'ROMAN IMPERIAL. AE As, countermarked TIB IM (Howgego 123) on an as of Augustus. RIC I 543.',
    'Countermarked as, Pangerl 45, struck under Titus. RIC II 543.',
    'ROMAN IMPERIAL. Augustus. AE As, countermarked. Howgego 123. RIC I 543.',
  ].map(findReferences);
  const ricRow = (lot) => lot.references.find((entry) => entry.text.startsWith('RIC'));
  assert.deepEqual(lotLookup(ricRow(countermarked), countermarked.rulers), { ...ric('543', 'I'), rulers: ['Augustus'] });
  assert.deepEqual(lotLookup(ricRow(viaPangerl), viaPangerl.rulers), { ...ric('543', 'II'), rulers: ['Titus'] });
  // The heading-first order already kept the ruler, and still does.
  assert.deepEqual(lotLookup(ricRow(headingFirst), headingFirst.rulers), { ...ric('543', 'I'), rulers: ['Augustus'] });
});

test('a co-author’s hyphen does not steal the first author’s reference', () => {
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Jongeward-Cribb 123.'), ['Jongeward-Cribb 123']);
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Jongeward &Cribb 123.'), ['Jongeward &Cribb 123']);
  // The canonical spacing, and Cribb cited alone, are unaffected.
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Jongeward & Cribb 123.'), ['Jongeward & Cribb 123']);
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Cribb 12; MACW 3005.'), ['Cribb 12', 'MACW 3005']);
});

test('Prieto y Vives is a different catalogue from Vives, so the row is attributed to the book the dealer named', () => {
  assert.deepEqual(texts('SPAIN, Taifa. AR Fractional Dirham. Prieto y Vives 55; Album 400.'), ['Prieto y Vives 55', 'Album 400']);
  // Vives on its own, and the Spanish verb the plan already cleared, are unaffected.
  assert.deepEqual(texts('SPAIN, Umayyad. AR Dirham. Vives 123; Album 340.'), ['Vives 123', 'Album 340']);
  assert.deepEqual(texts('SPAIN. AR Dirham. Si vives 123 anos. Album 340.'), ['Album 340']);
});

test('a long run of non-space text after a key resolves quickly, not in minutes', () => {
  // BODY's repeated group had no separator requirement between repetitions, so a digit-free run split four ways in O(n^4) backtracking.
  const start = Date.now();
  texts(`ROMAN. RIC ${'.'.repeat(2900)}`);
  assert.ok(Date.now() - start < 2000, 'a 2,900-character non-digit run after a key must not freeze the reader');
});

test('a comma between a RIC volume and its number keeps the reference whole', () => {
  assert.deepEqual(only('Hadrian. RIC II.3, 2345.').reference, ric('2345', 'II, Part 3'));
  assert.deepEqual(only('Trajan denarius. RIC II, 123.').reference, ric('123', 'II'));
  assert.deepEqual(only('Diva Faustina I. RIC III, 394a.').reference, ric('394a', 'III'));
  assert.deepEqual(only('Caracalla. RIC IV.1, 123a.').reference, ric('123a', 'IV, Part 1'));
  assert.deepEqual(only('Vespasian. RIC II², 972.').reference, ric('972', 'II (2nd edition)'));
  assert.deepEqual(texts('Trajan denarius. RIC II, 123; BMC 45.'), ['RIC II, 123', 'BMC 45']);
  // The volume still ends the reference when no number follows it, and a second number after the first is another type.
  assert.deepEqual(texts('Hadrian. RIC II.3, 2345, 2346.'), ['RIC II.3, 2345']);
  // A volume, its part and its number, each parted by a comma. Read as "RIC V 2" this opened Probus 2, a coin the dealer never cited.
  assert.deepEqual(only('Probus. RIC V, 2, 123').reference, { catalogue: 'RIC', volume: 'V, Part 2', section: '', number: '123' });
  assert.deepEqual(only('Trajan. RIC II, 1, 123').reference, { catalogue: 'RIC', volume: 'II, Part 1', section: '', number: '123' });
  // RIC IV is bound in three parts, and a dealer punctuates them with commas as he does V's.
  assert.deepEqual(only('Caracalla. RIC IV, 1, 123a').reference, ric('123a', 'IV, Part 1'));
  assert.deepEqual(only('Gordian III. RIC IV, 3, 12').reference, ric('12', 'IV, Part 3'));
  // Only a part the volume really has, since a comma is also how a dealer lists numbers: "RIC III, 2, 3" is two of RIC III's numbers, and the
  // Reference box must read these the same way, which is to say not at all.
  for (const text of ['RIC II, 2, 123', 'RIC III, 2, 3', 'RIC X, 2, 123', 'RIC IV, 4, 12']) {
    assert.deepEqual(texts(`Trajan. ${text}`), [], text);
    assert.equal(parseReference(text), null, text);
  }
  // A part written with a space is the dealer's number, not a part: "RIC II 1" is volume II number 1, and the 2 after it is another type.
  assert.deepEqual(texts('Trajan. RIC II 1, 2'), ['RIC II 1']);
});

test('rulers are read from the heading alone: not from a legend, not from what the coin pictures', () => {
  const rulers = (text) => findReferences(text).rulers;
  // A legend is the coin's own words: three unpunctuated capitals in a row start it, and the names in it are not the issuer.
  assert.deepEqual(rulers('Trajan. Denarius. IMP CAES NERVA TRAIAN AVG GERM. RIC 12.'), ['Trajan']);
  assert.deepEqual(rulers('Denarius, Rome. IMP CAES NERVA TRAIAN AVG. RIC 12.'), []);
  // Two capitals in a row are a house's classification or a ruler's own name, and a ruler's name in capitals is never a legend however long it is.
  assert.deepEqual(rulers('ROMAN IMPERIAL. Titus. Denarius. RIC 972.'), ['Titus']);
  assert.deepEqual(rulers('SEVERUS ALEXANDER. RIC 12'), ['Severus Alexander']);
  assert.deepEqual(rulers('CLAUDIUS II GOTHICUS AE Antoninianus. RIC 36.'), ['Claudius Gothicus']);
  // Everything from the type description on is what is pictured, not who struck it.
  assert.deepEqual(rulers('Vespasian. Denarius. Head of Titus, laureate, right. RIC 972.'), ['Vespasian']);
  assert.deepEqual(rulers('Denarius. Bust of Titus right. RIC 972.'), []);
  assert.deepEqual(rulers('Denarius. Wolf suckling Romulus and Remus. RIC 1.'), []);
  assert.deepEqual(rulers('Hadrian. Sestertius. Victory standing left, Aurelian behind. RIC 1.'), ['Hadrian']);
  assert.deepEqual(rulers('Hadrian seated. Aurelian. RIC 1.'), ['Hadrian']);
  // A lot's own first sentence is the dealer's headline, and houses set it in capitals: no legend is ever quoted before the coin has been named.
  assert.deepEqual(rulers('ROMAN IMPERIAL COINAGE Trajan AR Denarius. RIC 1'), ['Trajan']);
  assert.deepEqual(rulers('ROMAN EMPIRE AR DENARIUS NERO. RIC 1'), ['Nero']);
  // A legend after that sentence is still a legend, and the mark a dealer ends it with is no part of it.
  assert.deepEqual(rulers('Augustus. Denarius. Rev: C L CAESARES, Gaius and Lucius Caesars standing. RIC 1'), ['Augustus']);
  // The joint and regency headings a dealer really writes keep every ruler in them.
  assert.deepEqual(rulers('Marcus Aurelius and Lucius Verus. RIC 1'), ['Marcus Aurelius', 'Lucius Verus']);
  assert.deepEqual(rulers('Titus, as Caesar, under Vespasian. RIC 1'), ['Titus', 'Vespasian']);
  assert.deepEqual(rulers('Divus Augustus under Tiberius. RIC 1'), ['Augustus', 'Tiberius']);
});

test('a regnal numeral after a name is read in capitals only, so a lower-case letter never hides the ruler', () => {
  const rulers = (text) => findReferences(text).rulers;
  assert.deepEqual(rulers('Gallienus x 3 antoniniani. RIC 1.'), ['Gallienus']);
  assert.deepEqual(rulers('Nero i.e. the emperor. RIC 1.'), ['Nero']);
  assert.deepEqual(rulers('Titus v Vespasian. RIC 1.'), ['Titus', 'Vespasian']);
  // The capital numeral still makes the name someone else's.
  assert.deepEqual(rulers('Constantine II. RIC 1.'), ['Constantine II']);
  assert.deepEqual(rulers('Valerian II. RIC 1.'), ['Valerian II']);
});

// Reading every language's labels turned ordinary words into emperors: a Portuguese "Faustina", an Estonian "Severus", a German "August", a French
// "Sévère", a Spanish "Juan" and a Latin dative "Iovi" all became rulers, and "Sept. Severus. RIC 16" then opened a Severus II follis. Each of these
// is prose, a month, a legend or an abbreviation, and none of them named a ruler before the aliases were widened.
test('a lot\'s ordinary words name no ruler: prose, a month, a legend and an abbreviation stay text', () => {
  for (const text of ['Sept. Severus. Denarius. RIC 16.', 'Diva Faustina Senior, 138-141. AR Denarius. RIC III 344.',
    'Severe scratches and a flan crack. RIC 1', 'Denarius. Rev: Pietas Augusti. RIC 1', 'Struck August 70. RIC 1', 'Jovi Statori. RIC 1',
    'Marc Antony legionary denarius. RIC 1', 'Juan Carlos collection. RIC 1', 'Mario Ratto, 1962. RIC 1', 'Drusus. RIC 1', 'Maximinus. RIC 1',
  ]) assert.deepEqual(findReferences(text).rulers, [], text);
});

// A mint is a place, so its other name is only ever a section: Nomisma titles the concept "Trier" and keeps "Treveri" beside it.
// One clean-up, applied once: a lot row runs it and hands parseReference the result, instead of both of them running the same chain over the same
// text. Either way round the two paths must read the same reference out of the same words.
test('a lot row and the same reference typed into the box read alike', () => {
  for (const text of ['RIC 268 (Elagabalus)', 'RIC 972 var.', 'RIC II 123 corr.', 'RIC.112', 'RIC II.3, 2345', 'RIC 12-13', 'RIC II Trajan 12 (Rome)',
    'RIC 266 (aureus)', 'RIC II², 972', 'RIC IV-1 123']) {
    assert.deepEqual(findReferences(`Denarius. ${text}`).references[0].reference, parseReference(text), text);
  }
});

test('a mint written by the name on the map today is a section, and no ruler at all', () => {
  const lot = findReferences('Constantine I. Follis. RIC VII Trier 12.');
  // The row reads the mint as the section it is, spelled as the dealer spelled it; lookupType reads that name as RIC's own Treveri.
  assert.deepEqual(lot.references[0].reference, { catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' });
  assert.deepEqual(lot.rulers, ['Constantine I']);
  assert.equal(lotLookup(lot.references[0], lot.rulers).section, 'Trier');
});

// RIC VI-IX file their coins by mint, so a heading that names the mint and nobody else has said which section the number lives in. Read as text it
// said nothing, and a numberless "RIC 12" left every mint of four volumes to choose between.
test('a heading that names only a mint is read as that mint\'s RIC section, by RIC\'s spelling or the modern one', () => {
  for (const [text, section] of [['Londinium. RIC 12', 'Londinium'], ['Arles. RIC 12', 'Arelate'], ['Arles mint, RIC 12', 'Arelate'],
    ['Lugdunum mint. RIC 34', 'Lugdunum'], ['Trier. RIC 12', 'Treveri'], ['Sisak. RIC 12', 'Siscia'], ['Roma. RIC 12', 'Rome'],
    ['Marmara Ereğlisi, AE follis. RIC 12', 'Heraclea'],
    // The names Wikidata adds through Nomisma's closeMatch links read the same way in a heading as Nomisma's own.
    ['Sofia. RIC 12', 'Serdica'], ['Roman London. RIC 12', 'Londinium'], ['Ostia Antica. RIC 12', 'Ostia'],
    ['Carthago mint, AE follis. RIC 12', 'Carthage'],
    // And the towns the one statement hop reaches, which are the names a dealer is likeliest of all to write: the Wikidata item Nomisma links each
    // of these mints to is the Roman city, and its P1366, P276 or P131 statement is what names the town standing there now.
    ['London. RIC 12', 'Londinium'], ['London mint, AE follis. RIC 12', 'Londinium'], ['Lyon mint. RIC 12', 'Lugdunum'],
    ['Milan. RIC 12', 'Mediolanum'], ['Milano mint, AE follis. RIC 12', 'Mediolanum'], ['Pavia. RIC 12', 'Ticinum'],
    ['Erdek. RIC 12', 'Cyzicus'], ['İzmit mint. RIC 12', 'Nicomedia']]) {
    const lot = findReferences(text);
    assert.deepEqual(lot.rulers, [], text);
    // The mint rides on the row, never on the rulers: nothing may ask OCRE's portrait facet for a place.
    assert.equal(lotLookup(lot.references[0], lot.rulers).section, section, text);
    assert.ok(lotLabel(lot.references[0], lot.rulers).endsWith(` · ${section}`), text);
  }
  // "Lyons" is published as a name of Lyon in no language kept, so a heading written that way still names no section and the row is looked up as it
  // always was. A nickname names none either: a coin described in prose about the Eternal City is not Rome's by that alone, and the codes and the
  // honorific London's item carries beside its names are refused for exactly that reason.
  for (const text of ['Lyons. RIC 12', 'Augusta. RIC 12', 'LDN. RIC 12', 'The Big Smoke. RIC 12', 'Capitale des Gaules. RIC 12',
    'From the days of the Eternal City. RIC 12', 'Caput Mundi. RIC 12']) {
    const lot = findReferences(text);
    assert.equal(lotLookup(lot.references[0], lot.rulers).section, '', text);
  }
  // The heading that most needs it: a mint named in prose about another city's epithet is still that mint's coin, not the epithet's.
  const trier = findReferences('From the days of the Eternal City. Trier mint. RIC 12');
  assert.equal(lotLookup(trier.references[0], trier.rulers).section, 'Treveri');
  // A heading that names a ruler as well is the ruler's, exactly as it was before: a mint volume's coin is found by the man on it, and a ruler
  // volume's number would otherwise be thrown away for a mint that only says where the coin was struck.
  for (const text of ['Magnus Maximus, 383-388. AE2, Lugdunum. RIC 34.', 'Constantine I. Follis. Trier. RIC 12.']) {
    const lot = findReferences(text);
    assert.equal(lotLookup(lot.references[0], lot.rulers).section ?? '', '', text);
    assert.deepEqual(lotLookup(lot.references[0], lot.rulers).rulers, lot.rulers, text);
  }
});

// A mint section says which of RIC VI-IX a number lives in; it can never say that of a volume it is no section of. "Rome mint" stands in most RIC
// I-V descriptions, and a heading is ruler-less whenever the table does not hold its spelling, so the mint used to throw away the volume the lot had
// stated and search four mint volumes for a number that was never in them.
test('a mint named beside a volume of its own is that section, and one beside any other volume is only where the coin was struck', () => {
  const lookup = (text) => { const lot = findReferences(text); return lotLookup(lot.references[0], lot.rulers); };
  // The volume the lot states stands, and no mint section is put on it: RIC IV, III and X have no Rome or Constantinople section at all.
  for (const [text, volume] of [['Rome mint. RIC IV 460', 'IV'], ['Diva Faustina. AR Denarius, Rome mint. RIC III 360', 'III'],
    ['Constantinople. RIC X 12', 'X'], ['Trier mint. RIC II 972', 'II']]) {
    assert.deepEqual(lookup(text), { catalogue: 'RIC', number: text.match(/(\d+)$/)[1], volume, section: '' }, text);
  }
  // A volume the mint is a section of keeps both, and a citation with no volume at all reads as it did: the mint's section, its volumes to choose from.
  assert.deepEqual(lookup('Trier. RIC VII 12'), { catalogue: 'RIC', number: '12', volume: 'VII', section: 'Treveri', headingMint: true });
  assert.deepEqual(lookup('Londinium. RIC 12'), { catalogue: 'RIC', number: '12', volume: '', section: 'Londinium', headingMint: true });
  // A house whose name is a mint spelling is read as that mint still, where the volume it cites is one of the mint's own (see Known issues).
  assert.deepEqual(lookup('Roma Numismatics E-Sale 100. RIC VI 12'), { catalogue: 'RIC', number: '12', volume: 'VI', section: 'Rome', headingMint: true });
});

test('a heading that names a ruler is looked up by the ruler, whatever volume the lot cites', () => {
  for (const [text, rulers] of [['Magnus Maximus, 383-388. AE2, Lugdunum. RIC 34.', ['Magnus Maximus']],
    ['Constantine I. Follis. Trier. RIC VII 12.', ['Constantine I']], ['Antoninus Pius. Denarius, Rome mint. RIC III 360.', ['Antoninus Pius']],
    ['Nero. Denarius, Rome mint. RIC 460.', ['Nero']]]) {
    const lot = findReferences(text);
    assert.deepEqual(lot.rulers, rulers, text);
    const found = lotLookup(lot.references[0], lot.rulers);
    assert.equal(found.section ?? '', '', text);
    assert.deepEqual(found.rulers, rulers, text);
    assert.equal(found.volume, lot.references[0].reference.volume, text);
  }
});

test('the heading spellings the English and Latin labels really carry resolve, and no others are guessed at', () => {
  const rulers = (text) => findReferences(text).rulers;
  for (const [heading, expected] of [
    // A regnal "I" names the plain person only where the table holds the "II" it is told apart from.
    ['Valerian I', ['Valerian']],
    ['Licinius I', ['Licinius']],
    ['Philippus Arabs', ['Philip the Arab']],
    ['Claudius Gothicus', ['Claudius Gothicus']],
    // RIC's own section names, which need no alias at all.
    ['Philip I', ['Philip I']],
    ['Florian', ['Florian']],
    ['Severina', ['Severina']],
    ['Mariniana', ['Mariniana']],
    // Nomisma's English and Latin labels spell none of these, and a numeral is never invented from the rest: they name nobody rather than somebody.
    ['Maximinus I', []],
    ['Maximinus II', []],
    ['Constantius I', []],
    ['Faustina II', []],
    ['Faustina Junior', []],
    ['Diva Faustina I', []],
    ['Julian II', []],
  ]) assert.deepEqual(rulers(`${heading}. Denarius. RIC 12.`), expected, heading);
});

test('a heading of three thousand characters, and a long run of capitals in it, resolve quickly', () => {
  // The heading is scanned against every spelling Nomisma knows, and its legend runs are walked token by token: both must stay linear in its length.
  const heading = 'Titus, as Caesar, 69-79. Denarius, Rome. Fine style, lovely old cabinet tone, well centred. '.repeat(40).slice(0, 2900);
  for (const text of [`${heading} RIC 1073.`, `${'AAAA '.repeat(600).slice(0, 2900)} RIC 1073.`, `${'NERO '.repeat(600).slice(0, 2900)} RIC 1073.`]) {
    const start = Date.now();
    findReferences(text);
    assert.ok(Date.now() - start < 2000, `a 2,900-character heading must not freeze the reader: ${text.slice(0, 20)}`);
  }
});

// A mint bracketed after a RIC number with no volume ("RIC 40 (Ticinum)") is where the coin was struck, and says nothing about whose coin it is. Read
// as the section, it took the heading's ruler away, and every RIC VI-IX coin with that mint and number opened as the single answer: Probus's RIC 40
// opened Constantine's RIC VII Ticinum 40. The ruler is kept, exactly as it is kept beside a mint volume's section.
test('a mint written beside a RIC number with no volume keeps the heading ruler', () => {
  for (const [text, ruler, section] of [['Probus. Antoninianus. RIC 40 (Ticinum).', 'Probus', 'Ticinum'], ['Nero. AR Denarius. RIC 411 (Rome).', 'Nero', 'Rome'],
    ['Probus. Antoninianus. RIC Ticinum 40.', 'Probus', 'Ticinum'], ['Gallienus. Antoninianus. RIC 12 (Trier).', 'Gallienus', 'Trier']]) {
    const lot = findReferences(text);
    assert.deepEqual(lot.rulers, [ruler], text);
    const found = lotLookup(lot.references[0], lot.rulers);
    assert.deepEqual(found.rulers, [ruler], text);
    assert.equal(found.section, section, text);
    assert.equal(found.volume, '', text);
    assert.ok(lotLabel(lot.references[0], lot.rulers).includes(ruler), text);
  }
  // A bracket naming a ruler's own section is still that section, and the heading's ruler is not asked for on top of it.
  const maesa = findReferences('Julia Maesa, 218-222 AD. Denarius. RIC 268 (Elagabalus).');
  assert.deepEqual(lotLookup(maesa.references[0], maesa.rulers), { catalogue: 'RIC', number: '268', volume: '', section: 'Elagabalus' });
});

// A heading is ruler-less wherever the people table lacks its spelling ("Constantius I", "Julian II", "Sept. Severus"), so a mint named in it is no
// evidence that nobody else is on the coin: "Constantius I. Follis. Trier. RIC VI 1" opened Maximian's RIC VI Treveri 1. The row says the section
// came from the heading's mint, and the lookup offers what it finds there rather than opening it.
test('a section taken from the heading\'s mint is marked as such, and a section the lot cites is not', () => {
  const lookup = (text) => { const lot = findReferences(text); return lotLookup(lot.references[0], lot.rulers); };
  for (const text of ['Constantius I. Follis. Trier. RIC VI 1.', 'Julian II. Siliqua. Arles. RIC VIII 12.', 'Londinium. RIC 12']) {
    assert.equal(lookup(text).headingMint, true, text);
  }
  for (const text of ['Constantine I. Follis. RIC VII Trier 12.', 'Constantine I. Follis. Trier. RIC VII 12.', 'Rome mint. RIC IV 460', 'RIC VII Treveri 12']) {
    assert.equal(lookup(text).headingMint, undefined, text);
  }
});
