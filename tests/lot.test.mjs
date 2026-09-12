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
  // An edition between the key and the number leaves only the ordinal, which is no reference.
  assert.deepEqual(texts('Judaea. Prutah. Hendin 6th ed. 1243. Fine.'), []);
  assert.deepEqual(texts('Album 3rd ed. 1234.'), []);
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
