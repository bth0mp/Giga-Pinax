import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeLot, findReferences, isLot, lotLabel, lotLookup, oneLine } from '../extension/lot.js';

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
  // "SG" inside a word, and Sear Greek Imperial, are no SG key.
  assert.deepEqual(texts('MASGUT 12. ASG 5. SGI 123.'), []);
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
  assert.deepEqual(rulers, [['Titus'], ['Titus'], [], [], ['Nero'], [], [], [], [], ['Titus'], [], ['Gallienus']]);
  assert.deepEqual(findReferences('Claudius with Nero, as Caesar. RIC 107').rulers, ['Claudius', 'Nero']);
  assert.deepEqual(findReferences('Divus Vespasian. Struck under Titus. RIC 357').rulers, ['Vespasian', 'Titus']);
  // A mint is a RIC section too, but not a person; a name after the first reference is not the lot's ruler.
  assert.deepEqual(findReferences('Rome. Denarius. RIC 972 (Titus); Hadrian').rulers, []);
  assert.deepEqual(findReferences('SEVERUS ALEXANDER. RIC 12').rulers, ['Severus Alexander']);
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
  assert.deepEqual(variant.reference, ric('34a', 'IV'));
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
  assert.deepEqual(texts('Trajan, 98-117. Denarius, Rome, 103-111. BMC 316. RIC 128. Woytek 290b.'), ['BMC 316', 'RIC 128']);
  assert.deepEqual(findReferences('Trajan. BMC 316. RIC 128. Woytek 290b.').references[1].reference, ric('128'));
  assert.deepEqual(texts('Crawford 344/1a. BMCRR Rome 2320.'), ['Crawford 344/1a']);
  assert.deepEqual(texts('Crawford 344/1a, RBW 1353'), ['Crawford 344/1a']);
  assert.deepEqual(texts('RIC II.1 1073 (Vespasian), Hunter 12'), ['RIC II.1 1073 (Vespasian)']);
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
  assert.deepEqual(rulers('Magnus Maximus, 383-388. AE2, Lugdunum. RIC 34.'), []);
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
