import test from 'node:test';
import assert from 'node:assert/strict';
import { anyCase, looksLikeLot, findReferences, isLot, lotLabel, lotLookup, oneLine, readProvenance } from '../extension/lot.js';
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
  // The heading names Rome beside Titus: each row carries it as where the coin was struck (loop N6 review).
  assert.deepEqual(one[0], { text: 'RIC 972', reference: ric('972'), cf: false, variant: false, typed: true, struckAt: ['Rome'] });
  assert.deepEqual(one[1], { text: 'Cohen 17', reference: other('Cohen 17'), cf: false, variant: false, typed: false, struckAt: ['Rome'] });
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
  assert.deepEqual(rulers, [['Titus'], ['Titus'], ['Julia Maesa'], ['Faustina the Elder'], ['Nero'], [], [], [], [], ['Titus'], [], ['Gallienus']]);
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
    catalogue: 'RIC', volume: 'VII', section: '', number: '287', rulers: ['Constantine II'], id: 'ric.7.lon.287', struckAt: ['Londinium'],
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

// Loop N6: the European houses head a lot with the ruler in their own language, and a heading nobody could read left "RIC 347" to every volume's
// thirty-four types, or sent a Spanish Nero to the Rome mint's folles.
test('a heading names its ruler in Latin, German, French, Italian or Spanish', () => {
  const rulers = (text) => findReferences(text).rulers;
  for (const [text, person] of [
    ['Traianus, 98-117. Aureus, 114/117, Rom; 7,29 g. BMC 549; Calicó 1035; Coh. 276; RIC 347; Woytek 571f. Fast Stempelglanz.', 'Trajan'],
    ['TRAJANUS, 98-117. Denar. RIC 347.', 'Trajan'], ['Traiano (98-117). Aureo, Roma. RIC 347; C 276.', 'Trajan'],
    ['Trajano. Denario. Roma. RIC 347.', 'Trajan'], ['Nerón. Denario. 65-66 d.C. Roma. RIC 53; RSC 119. Ag 3,42 g. Pátina. EBC-.', 'Nero'],
    ['Néron (54-68). Denier, 65-66, Rome. RIC.53 - RSC.119.', 'Nero'], ['Nerone (54-68). Denario, Roma, 65-66. RIC 53; C 119.', 'Nero'],
    ['Adriano. Denario. Roma. RIC 241.', 'Hadrian'], ['Hadrien (117-138). Denier. RIC 241.', 'Hadrian'],
    ['Vespasiano. Denario. RIC 356.', 'Vespasian'], ['Vespasien (69-79). Denier. RIC 356.', 'Vespasian'],
    ['Philippus I. Arabs, 244-249. Antoninian. RIC 27b.', 'Philip the Arab'], ['Valerianus I., 253-260. Antoninian. RIC 106.', 'Valerian'],
    ['Elagabal, 218-222. Denar. RIC 88.', 'Elagabalus'], ['Heliogabalus. Denarius. RIC 88.', 'Elagabalus'],
    ['Faustina II., 147-176. Denar. RIC 677.', 'Faustina the Younger'],
    ['Faustina Minor. Denarius. RIC 677.', 'Faustina the Younger'], ['Faustina Maior. Denar. RIC 344.', 'Faustina the Elder'],
    ['Constantius I., 293-306. Follis. RIC 170a.', 'Constantius Chlorus'], ['Maximinus II. Daia, 305-313. Follis. RIC 845.', 'Maximinus Daia'],
    ['Julian II. AD 360-363. Siliqua. RIC 212.', 'Julian the Apostate'], ['Jovian. AD 363-364. Solidus. RIC 175.', 'Jovianus'],
    ['Constantine the Great. Follis. RIC 105.', 'Constantine I'], ['Konstantin I., 306-337. Follis. RIC 105.', 'Constantine I'],
    ['Costantino I (306-337). Follis. RIC 105.', 'Constantine I'], ['Traianus Decius, 249-251. Antoninian. RIC 21b.', 'Trajan Decius']]) {
    assert.deepEqual(rulers(text), [person], text);
  }
  // A heading the table read already reads as it did, and a spelling with another numeral behind it is someone else.
  assert.deepEqual(rulers('Faustina II. Denar. RIC 677. Faustina I'), ['Faustina the Younger']);
  assert.deepEqual(rulers('Constantius II. AE3. RIC 123.'), ['Constantius II']);
  // No new spelling reads an ordinary word or the start of one: an adjective, the sea, a style, the god of Emesa whose stone the coins show.
  for (const prose of ['Neronian style. Denarius. RIC 53.', 'Adriatic hoard. Denarius. RIC 241.', 'A jovian eagle. RIC 175.',
    'Traianeum at Pergamon. RIC 347.', 'Emesa. Aureus. The sacred stone of Elagabal in a quadriga. RIC 2.', 'Emesa. Stein des Elagabal. RIC 2.']) {
    assert.deepEqual(rulers(prose), [], prose);
  }
  assert.deepEqual(rulers('Uranius Antoninus. Aureus, Emesa. The baetyl of Elagabal in a quadriga. RIC 2.'), ['Uranius Antoninus']);
  // Loop N6 review: the god in three more phrasings, with a word between the noun and the god's name.
  for (const god of ['Uranius Antoninus. Aureus. Sol Elagabal. RIC 2.', 'Uranius Antoninus. Aureus. Der heilige Stein des Gottes Elagabal. RIC 2.',
    'Uranius Antoninus. Áureo. Piedra sagrada de Elagabal. RIC 2.']) {
    assert.deepEqual(rulers(god), ['Uranius Antoninus'], god);
  }
  // "Elagabal in quadriga" stays the emperor: he rides one on his own coins as often as the stone does.
  assert.deepEqual(rulers('Elagabal in Quadriga. Aureus. RIC 2.'), ['Elagabalus']);
  // A joint heading in German, French, Italian or Spanish reads both people, as its English form does.
  for (const [text, people] of [['Philipp I. und Philipp II. Antoninian. RIC 1.', ['Philip the Arab', 'Philip II']],
    ['Philippe Ier et Philippe II. RIC 1.', ['Philip the Arab', 'Philip II']], ['Filippo I e Filippo II. RIC 1.', ['Philip the Arab', 'Philip II']],
    ['Konstantin I. für Konstantin II. Follis. RIC 1.', ['Constantine I', 'Constantine II']],
    ['Costantino I per Costantino II. RIC 1.', ['Constantine I', 'Constantine II']],
    ['Valerianus I. für Valerianus II. Antoninian. RIC 1.', ['Valerian', 'Valerian II']]]) {
    assert.deepEqual(rulers(text), people, text);
  }
  // "Jovian" is also an English adjective: at the start of a sentence, before a lower-case noun, it is the adjective.
  assert.deepEqual(rulers('Jovian eagle. RIC 175.'), []);
  assert.deepEqual(rulers('Jovian, 363-364. AE3. RIC 175.'), ['Jovianus']);
  assert.deepEqual(rulers('Jovian AV Solidus. RIC 175.'), ['Jovianus']);
  // The Künker heading reads the ruler, so the row borrows him rather than every volume's RIC 347.
  const kunker = findReferences('Traianus, 98-117. Aureus, 114/117, Rom; 7,29 g. RIC 347; Woytek 571f.');
  assert.deepEqual(lotLookup(kunker.references[0], kunker.rulers), { catalogue: 'RIC', number: '347', volume: '', section: '', rulers: ['Trajan'] });
  // The Spanish Nero no longer falls through to the heading's mint.
  const aureo = findReferences('Nerón. Denario. 65-66 d.C. Roma. RIC 53; RSC 119.');
  assert.equal(lotLookup(aureo.references[0], aureo.rulers).section, '');
  assert.deepEqual(lotLookup(aureo.references[0], aureo.rulers).rulers, ['Nero']);
});

test('a lot row looks up its parsed reference, with the rulers only on a RIC reference without a section, and says so', () => {
  const [lot, maesa] = [LOTS[0], LOTS[2]].map(findReferences);
  assert.deepEqual(lotLookup(lot.references[0], lot.rulers), { ...ric('972'), rulers: ['Titus'], struckAt: ['Rome'] });
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
  for (const text of ['RIC XI Nero 1', 'RIC 2 Titus', 'RIC Nerro 306', 'RIC I2 Nero 306', 'RIC 972', 'Titus 123', 'Craw. 44/5', 'SC 1266.2',
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

// Loop N8: CNG cites the co-authored Pre-Kushana Coins in Pakistan beside Bopearachchi's own book, and CGB and Elsen put "Série" before the number.
// The first is another book and only its prices are searched; the second is the Bop number with no king.
test('a Bopearachchi citation with a co-author is prices only, and the French series word is no king', () => {
  const lot = findReferences('BAKTRIA, Greco-Baktrian Kingdom. Eukratides I Megas. Circa 170-145 BC. AR Tetradrachm (33mm, 16.95 g, 12h). '
    + 'Bopearachchi 6C; Bopearachchi & Rahman 268; SNG ANS 464-5; HGC 12, 131. EF, lightly toned.');
  assert.deepEqual(lot.references.map((found) => [found.text, found.reference.catalogue, found.reference.section ?? '']), [
    ['Bopearachchi 6C', 'Bop', ''], ['Bopearachchi & Rahman 268', 'Other', ''], ['SNG ANS 464-5', 'Other', ''], ['HGC 12, 131', 'Other', '']]);
  assert.equal(lotLabel(lot.references[1], lot.rulers), 'Bopearachchi & Rahman 268 · prices only');
  assert.equal(defaultTerm(lot.references[1].reference), '"Bopearachchi & Rahman 268"');
  for (const text of ['Bopearachchi and Rahman 268.', 'Bopearachchi-Rahman 268.']) {
    assert.equal(only(text).reference.catalogue, 'Other', text);
    assert.equal(only(text).typed, false, text);
  }
  const french = only('Royaume de Bactriane. Eucratide Ier (v. 171-145). Tétradrachme. Bopearachchi Série 6C. Superbe.');
  assert.deepEqual(french.reference, { catalogue: 'Bop', number: '6C', volume: '', section: '' });
  assert.equal(defaultTerm(french.reference), '("Bopearachchi 6C" "Bop 6C" "Bopearachchi Série 6C")');
  // A Bop number with its king still reads as it did.
  assert.deepEqual(only('Euthydemos II. Bopearachchi 1C.').reference, { catalogue: 'Bop', number: '1C', volume: '', section: '' });
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
  // "Diva Faustina Senior" is Faustina the Elder (loop N6); the Portuguese word alone is still nobody.
  for (const text of ['Sept. Severus. Denarius. RIC 16.', 'Diva Faustina, 138-141. AR Denarius. RIC III 344.',
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
    // Nomisma's English and Latin labels spell none of these, and a numeral is never invented from the rest: the closed table of dealers' spellings
    // (catalogues.js EXTRA_SPELLINGS, loop N6) names each one person, and without it they would name nobody rather than somebody.
    ['Maximinus I', ['Maximinus Thrax']],
    ['Maximinus II', ['Maximinus Daia']],
    ['Constantius I', ['Constantius Chlorus']],
    ['Faustina II', ['Faustina the Younger']],
    ['Faustina Junior', ['Faustina the Younger']],
    ['Diva Faustina I', ['Faustina the Elder']],
    ['Julian II', ['Julian the Apostate']],
    ['Maximinus III', []],
    ['Faustina', []],
    ['Julianus', []],
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
  for (const text of ['Sept. Severus. Follis. Trier. RIC VI 1.', 'Usurper. Siliqua. Arles. RIC VIII 12.', 'Londinium. RIC 12']) {
    assert.equal(lookup(text).headingMint, true, text);
  }
  // Those two headings of the first rounds now name their rulers (loop N6), and the ruler is asked for instead of the mint.
  assert.deepEqual(lookup('Constantius I. Follis. Trier. RIC VI 1.').rulers, ['Constantius Chlorus']);
  assert.deepEqual(lookup('Julian II. Siliqua. Arles. RIC VIII 12.').rulers, ['Julian the Apostate']);
  for (const text of ['Constantine I. Follis. RIC VII Trier 12.', 'Constantine I. Follis. Trier. RIC VII 12.', 'Rome mint. RIC IV 460', 'RIC VII Treveri 12']) {
    assert.equal(lookup(text).headingMint, undefined, text);
  }
});

// PELLA titles 302 of Price's types P or L before the number (Philip III, Lysimachus): "Price P1" is one of them, not a typo, and a lot citing one
// looks it up rather than only pricing it.
test('a Price number lettered P or L is a Price type, typed or in a lot', () => {
  assert.equal(isLot('Price P1'), false);
  assert.deepEqual(parseReference('Price P1'), { catalogue: 'Price', number: 'P1', volume: '', section: '' });
  const found = only('Kings of Macedon. Philip III Arrhidaios. AR Tetradrachm. Babylon. Price P181.');
  assert.deepEqual(found.reference, { catalogue: 'Price', number: 'P181', volume: '', section: '' });
  assert.equal(found.typed, true);
});

// A section name standing for one of several rulers in a heading is only half of what the heading says: "Aurelian and Severina" named Severina's
// section and opened RIC V Severina 2 for a joint coin. With more than one ruler the heading's people are asked for together.
test('a joint heading keeps every ruler it names instead of one ruler\'s section', () => {
  const lookup = (text) => { const lot = findReferences(text); return lotLookup(lot.references[0], lot.rulers); };
  for (const text of ['Aurelian and Severina. Antoninianus. RIC 2.', 'Aurelian & Severina. RIC 2.', 'Aurelian, with Severina. RIC 2.']) {
    assert.deepEqual(lookup(text), { catalogue: 'RIC', number: '2', volume: '', section: '', rulers: ['Aurelian', 'Severina'] }, text);
  }
  // One ruler whose name is RIC's section is still that section.
  assert.deepEqual(lookup('Severina. Antoninianus. RIC 2.'), { catalogue: 'RIC', number: '2', volume: 'V', section: 'Severina' });
});

// Keys dealers really write that no row was read for: RIC spelled with stops ("R.I.C. 128"), Seleucid Coins in full, and a typed key with a full
// stop after it ("RIC. 60", "Pr. 3949"), which RSC's "RSC. 119" beside it has always kept.
test('R.I.C., Seleucid Coins and a typed key followed by a full stop are read as their catalogues', () => {
  const rows = (text) => findReferences(text).references.map(({ text: written, reference, typed }) => ({ written, reference, typed }));
  assert.deepEqual(rows('Trajan. R.I.C. 128; C. 74.')[0], { written: 'RIC 128', reference: ric('128'), typed: true });
  assert.deepEqual(rows('Nero. R.I.C. I² 60; BMC 74.')[0].reference, ric('60', 'I (2nd edition)'));
  assert.deepEqual(rows('Antiochos III. Tetradrachm. Seleucid Coins 1266.2; HGC 9, 12.')[0],
    { written: 'Seleucid Coins 1266.2', reference: { catalogue: 'SC', number: '1266.2', volume: '', section: '' }, typed: true });
  assert.deepEqual(rows('Nero. Denarius. RIC. 60; RSC. 119.').map(({ reference }) => reference), [ric('60'), other('RSC. 119')]);
  assert.deepEqual(texts('Nero. Denarius. RIC. 60; RSC. 119.'), ['RIC 60', 'RSC. 119']);
  assert.deepEqual(rows('Alexander III. Drachm. Pr. 3949; Müller 12.')[0].reference, { catalogue: 'Price', number: '3949', volume: '', section: '' });
  // "Price." stays unread as "Price:" does: it is the English word a dealer puts before a sale amount ("Price. 1200 EUR"), and read as the key it
  // would open the PELLA type with that number.
  assert.deepEqual(texts('Alexander III. Drachm. Price. 1200 EUR.'), []);
  // A pasted lot citing R.I.C. is lot text, not one Other reference.
  assert.equal(isLot('Trajan. R.I.C. 128; C. 74.'), true);
});

// "Pr." is Price's abbreviation and also a price's: a number with a currency straight after it ("Pr. 1200 EUR", "Pr 1,200 €") is a sale amount, as it
// is after "Price", and reading it as the key would add a second Price row with that amount's number. "Pr. 3949" alone still reads.
test('Price or Pr followed by an amount in a currency is a sale price, never a Price row', () => {
  assert.deepEqual(texts('Alexander III. Price 3949. Pr. 1200 EUR.'), ['Price 3949']);
  for (const written of ['Pr 1200 EUR', 'Pr. 1,200 €', 'Pr. 1.200 CHF', 'Price 1200 EUR', 'Price 1,200 USD', 'Pr. 450 GBP', 'Pr. 450$', 'Pr. 450 £']) {
    assert.deepEqual(texts(`Alexander III. Drachm. Price 3949. ${written}.`), ['Price 3949'], written);
  }
  assert.deepEqual(texts('Alexander III. Drachm. Pr. 3949.'), ['Pr 3949']);
  assert.deepEqual(texts('Alexander III. Drachm. Pr 3949; Müller 12.'), ['Pr 3949', 'Müller 12']);
  // A currency further on, in the next sentence, says nothing about the number.
  assert.deepEqual(texts('Alexander III. Drachm. Price 3949. EUR 1200.'), ['Price 3949']);
});

// The one anyCase the lot reader and the grade reader share (prices.js imports it): a letter is either case, a space any run of spaces, and a letter
// whose other case is not one letter ("ß", whose capital is "SS") is matched as written, never as a class that would take a bare "S".
test('anyCase reads a word whatever its capitals, and a letter with no one-letter other case as written', () => {
  const reads = (word, text) => new RegExp(`^(?:${anyCase(word)})$`, 'u').test(text);
  assert.ok(reads('Good VF', 'good  vf'));
  assert.ok(reads('Straße', 'STRAßE'));
  assert.ok(!reads('ß', 'S'));
  assert.ok(!reads('ß', 'SS'));
  assert.ok(reads('a.b', 'A.B'));
  assert.ok(!reads('a.b', 'AxB'));
});

test('a lone Svoronos row promises no "prices only", since PCO may file it under a CPE type; other forms still do', () => {
  const label = (text) => { const lot = findReferences(text); return lot.references.map((found) => lotLabel(found, lot.rulers)); };
  assert.deepEqual(label('Ptolemy II. AR Tetradrachm. Svoronos 487.'), ['Svoronos 487']);
  assert.deepEqual(label('Ptolemy II. AR Tetradrachm. Svoronos 662a var.'), ['Svoronos 662a · var.']);
  assert.deepEqual(label('Ptolemaic. Svoronos 1600, pl. 20; SNG Cop 123.'), ['Svoronos 1600', 'SNG Cop 123 · prices only']);
  assert.deepEqual(label('Kroll 15.'), ['Kroll 15 · prices only']);
});

// 0.34 (W2a): the provenance a lot text carries, read into ordered entries from what is written - a house is never named from an abbreviation, a
// year is a year only where the entry writes one, and each entry keeps its own words for the collector to check.
test('the provenance reader splits the cut text into ordered entries, each keeping its original words', () => {
  assert.deepEqual(readProvenance("Ex Leu 7 (1973), lot 123; Ex Hunt collection, Sotheby's 1991"), [
    { text: 'Ex Leu 7 (1973), lot 123', source: 'Leu 7', year: 1973, lot: '123' },
    { text: "Ex Hunt collection, Sotheby's 1991", source: "Hunt collection, Sotheby's", year: 1991 },
  ]);
  // Read from a whole lot text: only the provenance sentences, in the order written, and the references after them stay out.
  assert.deepEqual(readProvenance('Nero. AR Denarius. Ex Leu 4, 25 May 1972, lot 123. RIC 972; Cohen 17. Ex CNG 105, lot 45a.'), [
    { text: 'Ex Leu 4, 25 May 1972, lot 123', source: 'Leu 4', year: 1972, lot: '123' },
    { text: 'Ex CNG 105, lot 45a', source: 'CNG 105', lot: '45a' },
  ]);
  assert.deepEqual(readProvenance('Provenance: Gorny & Mosch 250.'), [{ text: 'Gorny & Mosch 250', source: 'Gorny & Mosch 250' }]);
  assert.deepEqual(readProvenance('From the Sunrise Collection.\nEx Dr. Sear collection, 1975.'), [
    { text: 'From the Sunrise Collection', source: 'the Sunrise Collection' },
    { text: 'Ex Dr. Sear collection, 1975', source: 'Dr. Sear collection', year: 1975 },
  ]);
  // A second "ex" inside one sentence is a second owner.
  assert.deepEqual(readProvenance('Ex NAC 50, lot 4, ex Hess 1958.').map(({ source, year }) => [source, year]), [['NAC 50', undefined], ['Hess', 1958]]);
});

test('the provenance reader guesses nothing: no house from an abbreviation, no year from a lot or sale number', () => {
  // "CNG" stays "CNG", and a four-digit lot is a lot, not a year.
  assert.deepEqual(readProvenance('Ex CNG e-auction 250, lot 1975.'), [{ text: 'Ex CNG e-auction 250, lot 1975', source: 'CNG e-auction 250', lot: '1975' }]);
  assert.deepEqual(readProvenance('Ex Leu sale 1850, lot 7.'), [{ text: 'Ex Leu sale 1850, lot 7', source: 'Leu sale 1850', lot: '7' }]);
  // No provenance at all, or only its marker, reads as nothing.
  assert.deepEqual(readProvenance('Nero. AR Denarius. RIC 306.'), []);
  assert.deepEqual(readProvenance('Ex.'), []);
  for (const empty of [undefined, null, 42, {}]) assert.deepEqual(readProvenance(empty), []);
});

test('hostile provenance text stays linear: long runs, nested brackets and no year', () => {
  for (const text of [
    `Ex ${'('.repeat(20000)}Leu 7 1973${')'.repeat(20000)}`,
    `Ex ${'Leu '.repeat(20000)}`,
    `Ex ${'1973 '.repeat(20000)}`,
    `Ex ${' '.repeat(20000)}Leu;${' ; '.repeat(20000)}`,
    `${'Ex. '.repeat(20000)}`,
    `${'\n'.repeat(20000)}Ex Leu`,
    `Ex Leu, lot ${'1'.repeat(20000)}`,
    `Ex ${'May '.repeat(20000)}1973`,
  ]) {
    const start = Date.now();
    const entries = readProvenance(text);
    assert.ok(Date.now() - start < 2000, `hostile provenance must not freeze the reader: ${JSON.stringify(text.slice(0, 20))}`);
    assert.ok(entries.length <= 10);
    for (const entry of entries) assert.ok(entry.text.length <= 300 && (entry.source ?? '').length <= 120 && (entry.lot ?? '').length <= 20);
  }
});

// 0.34 review (W2a, Minor 2): a day written with a full stop before its month, and "no." before a number, are inside the provenance sentence, not
// its end - so the entry is offered whole, and the references after it are still read.
test('a provenance sentence runs past a dated day and a "no." to its real end', () => {
  assert.deepEqual(readProvenance('Ex Leu 7, 25. Mai 1973, Los 123.'), [{ text: 'Ex Leu 7, 25. Mai 1973, Los 123', source: 'Leu 7', year: 1973, lot: '123' }]);
  // "no." after the sale's own clause is its lot (loop N9), and never a year.
  assert.deepEqual(readProvenance('Ex Leu 7, no. 1973.'), [{ text: 'Ex Leu 7, no. 1973', source: 'Leu 7', lot: '1973' }]);
  assert.deepEqual(readProvenance('Ex Hess, Nr. 12. Ex Leu 4, 3. Dez. 1990.').map(({ text }) => text), ['Ex Hess, Nr. 12', 'Ex Leu 4, 3. Dez. 1990']);
  assert.deepEqual(texts('Ex Leu 7, 25. Mai 1973, Los 123. RIC 972; Cohen 17.'), ['RIC 972', 'Cohen 17']);
  assert.deepEqual(texts('Ex Leu 7, no. 1973. RIC 972.'), ['RIC 972']);
  // A number closing a sentence before a word that is no month still ends it.
  assert.deepEqual(texts('Ex CNG 105, lot 12. Marble-like patina. RIC 972.'), ['RIC 972']);
});

// Loop N9: half the European market writes provenance in German, Italian, Spanish or French, and the reader cut "Ex Slg." at its full stop, took no
// lot from "Nr. 1234", no year from "Zürich 2000," and did not see "Exemplar der Auktion", "Aus Sammlung", "Erworben", "Provenienz:", "lotto",
// "lote", "n°" or "Provient de" at all.
test('the provenance reader reads German, Italian, Spanish and French provenance', () => {
  for (const [text, entries] of [
    ['Ex Slg. Dr. X, erworben 1988 bei Lanz.', [{ text: 'Ex Slg. Dr. X, erworben 1988 bei Lanz', source: 'Slg. Dr. X, erworben bei Lanz', year: 1988 }]],
    ['Ex Lanz 145, 5. Januar 2009, Nr. 1234.', [{ text: 'Ex Lanz 145, 5. Januar 2009, Nr. 1234', source: 'Lanz 145', year: 2009, lot: '1234' }]],
    ['Ex Auktion Leu 79, Zürich 2000, Nr. 12.', [{ text: 'Ex Auktion Leu 79, Zürich 2000, Nr. 12', source: 'Auktion Leu 79, Zürich', year: 2000, lot: '12' }]],
    ['Exemplar der Auktion NAC 78, Zürich 2014, Nr. 1234.',
      [{ text: 'Exemplar der Auktion NAC 78, Zürich 2014, Nr. 1234', source: 'Auktion NAC 78, Zürich', year: 2014, lot: '1234' }]],
    ['Aus Sammlung Dr. X. Erworben 1998 bei Münzen und Medaillen AG Basel.', [
      { text: 'Aus Sammlung Dr. X', source: 'Sammlung Dr. X' },
      { text: 'Erworben 1998 bei Münzen und Medaillen AG Basel', source: 'Erworben bei Münzen und Medaillen AG Basel', year: 1998 }]],
    ['Provenienz: Sammlung X, Auktion Gorny & Mosch 250, 2017, Los 456.',
      [{ text: 'Sammlung X, Auktion Gorny & Mosch 250, 2017, Los 456', source: 'Sammlung X, Auktion Gorny & Mosch 250', year: 2017, lot: '456' }]],
    ['Ex asta Nomisma 50, 2014, lotto 123.', [{ text: 'Ex asta Nomisma 50, 2014, lotto 123', source: 'asta Nomisma 50', year: 2014, lot: '123' }]],
    ['Proviene da asta Varesi 60, 12 maggio 2012, lotto 45.',
      [{ text: 'Proviene da asta Varesi 60, 12 maggio 2012, lotto 45', source: 'asta Varesi 60', year: 2012, lot: '45' }]],
    ['Provient de la vente Vinchon, 24 avril 1985, n° 123.',
      [{ text: 'Provient de la vente Vinchon, 24 avril 1985, n° 123', source: 'la vente Vinchon', year: 1985, lot: '123' }]],
    ['Ex Áureo & Calicó 300, 7 marzo 2018, lote 1234.',
      [{ text: 'Ex Áureo & Calicó 300, 7 marzo 2018, lote 1234', source: 'Áureo & Calicó 300', year: 2018, lot: '1234' }]],
    ['Ex Áureo & Calicó 300, 7 de marzo de 2018, lote 1234.',
      [{ text: 'Ex Áureo & Calicó 300, 7 de marzo de 2018, lote 1234', source: 'Áureo & Calicó 300', year: 2018, lot: '1234' }]],
  ]) assert.deepEqual(readProvenance(text), entries, text);
  // A Künker lot's references are read and its provenance sentences stay out of them, the collection one as much as the auction one.
  const kunker = 'Traianus, 98-117. Aureus. RIC 347; Woytek 571f. Fast Stempelglanz. Exemplar der Sammlung Dr. X. Ex Auktion Leu 79, Zürich 2000, Nr. 12.';
  assert.deepEqual(texts(kunker), ['RIC 347', 'Woytek 571f']);
  assert.deepEqual(readProvenance(kunker).map(({ text }) => text), ['Exemplar der Sammlung Dr. X', 'Ex Auktion Leu 79, Zürich 2000, Nr. 12']);
  // A sale number is never the lot, the lot word the dealer wrote wins over a "no." before it, and a year still needs four digits of its own.
  assert.deepEqual(readProvenance('Ex Leu Auction no. 45, lot 12.'), [{ text: 'Ex Leu Auction no. 45, lot 12', source: 'Leu Auction no. 45', lot: '12' }]);
  assert.deepEqual(readProvenance('Ex Leu 7, 1973,5.'), [{ text: 'Ex Leu 7, 1973,5', source: 'Leu 7, 1973,5' }]);
  // "Nr." with no comma before it is the sale's number, not the lot.
  assert.deepEqual(readProvenance('Ex Künker Auktion Nr. 145.'), [{ text: 'Ex Künker Auktion Nr. 145', source: 'Künker Auktion Nr. 145' }]);
  // Ordinary words are no marker: "aus" inside a sentence, "Erworben" in the middle of one, and "Exemplar" without "der".
  assert.deepEqual(readProvenance('Vorzügliches Exemplar mit feiner Tönung. RIC 347.'), []);
  assert.deepEqual(readProvenance('Nero. Denar aus der Zeit um 65. RIC 53.'), []);
});

// Loop N9 review (Important 1): a provenance sentence the new markers open and an initial keeps running ("Sammlung Dr. W. R.") swallowed the
// references after it, and the lot offered nothing. A full stop with a catalogue key behind it ends the sentence, initial or not.
test('a provenance sentence ends at the full stop a catalogue key follows, even behind an initial', () => {
  for (const [text, expected] of [['Aus Sammlung H. W. RIC 53.', ['RIC 53']], ['Exemplar der Sammlung Dr. W. R. RIC 53.', ['RIC 53']],
    ['Provenienz: Slg. Dr. H. RIC 53.', ['RIC 53']], ['Ex Slg. Dr. X. RIC 53.', ['RIC 53']], ['Nero. Denar. Erworben bei M. RIC 53.', ['RIC 53']],
    ['Nero. Denar. Aus Slg. X. RIC 53. Cohen 17.', ['RIC 53', 'Cohen 17']], ['Ex Dr. Sear collection. Price 3949.', ['Price 3949']]]) {
    assert.deepEqual(texts(text), expected, text);
  }
  assert.deepEqual(readProvenance('Aus Sammlung H. W. RIC 53.'), [{ text: 'Aus Sammlung H. W', source: 'Sammlung H. W' }]);
  // Loop N9 re-review: whatever may stand between a key and its number ends the sentence too — a volume, its part or edition, a ruler or mint, a
  // bracketed section, Price's P or L, a Bop king — and any catalogue key the reader knows, not only the typed ones.
  for (const [text, expected] of [['Aus Sammlung H. W. RIC I Nero 53.', ['RIC I Nero 53']], ['Aus Sammlung H. W. RIC I² Nero 53.', ['RIC I² Nero 53']],
    ['Aus Sammlung H. W. RIC II Hadrian 241.', ['RIC II Hadrian 241']], ['Aus Sammlung H. W. RIC VII Trier 12.', ['RIC VII Trier 12']],
    ['Aus Sammlung H. W. RIC VII (Trier) 12.', ['RIC VII (Trier) 12']], ['Aus Sammlung H. W. RIC IV Caracalla 266.', ['RIC IV Caracalla 266']],
    ['Aus Sammlung H. W. RIC² 12.', ['RIC² 12']], ['Aus Sammlung H. W. RIC IV.1 266.', ['RIC IV.1 266']],
    ['Aus Sammlung H. W. Price P12.', ['Price P12']], ['Aus Sammlung H. W. Bop Euthydemus I 24A.', ['Bop Euthydemus I 24A']],
    ['Aus Sammlung H. W. SNG Cop 123.', ['SNG Cop 123']], ['Aus Sammlung H. W. SNG ANS 464.', ['SNG ANS 464']],
    ['Aus Sammlung H. W. MIR 36, 123.', ['MIR 36, 123']], ['Aus Sammlung H. W. Göbl 123.', ['Göbl 123']],
    ['Aus Sammlung H. W. Kampmann 12.3.', ['Kampmann 12.3']], ['Aus Sammlung H. W. Price 3949.', ['Price 3949']]]) {
    assert.deepEqual(texts(text), expected, text);
  }
  // A "cf." before the key belongs to the citation: the sentence ends in front of it and the row keeps its mark.
  const compared = only('Aus Sammlung H. W. Cf. RIC 53.');
  assert.deepEqual([compared.text, compared.cf], ['RIC 53', true]);
  // A capitalised word with a number is no citation unless it is a key, and a key's bare year is a year: these stay in the provenance.
  for (const text of ['Ex Slg. Dr. W. Müller 1985, Nr. 12.', 'Ex Slg. Dr. W. Hess 12, Nr. 5.', 'Aus Sammlung H. W. Leu 79, 2000.',
    'Ex Dr. A. Weber 1920, lot 3.', 'Aus Sammlung Dr. W. R. Zürich 2000, Nr. 12.']) {
    assert.deepEqual(texts(text), [], text);
    assert.equal(readProvenance(text).length, 1, text);
  }
  // Loop N9 review: the ordinal indicator the Spanish and French keyboards type (nº, n.º), the Italian "n." and "lotto n.", and no space left
  // before a comma where the year came out.
  for (const [text, lot] of [['Ex Áureo 300, 7 marzo 2018, nº 1234.', '1234'], ['Ex Áureo 300, 2018, n.º 1234.', '1234'],
    ['Ex asta Varesi 60, 2012, n. 45.', '45'], ['Ex asta Varesi 60, 2012, lotto n. 45.', '45'], ['Provient de la vente X, 1985, lot nº 12.', '12']]) {
    assert.equal(readProvenance(text)[0].lot, lot, text);
  }
  assert.deepEqual(readProvenance('Ex Auktion Hirsch, München 1998, Nr. 5.'), [
    { text: 'Ex Auktion Hirsch, München 1998, Nr. 5', source: 'Auktion Hirsch, München', year: 1998, lot: '5' }]);
  assert.equal(readProvenance('Ex Auktion Hirsch, München 1998, Wien.')[0].source, 'Auktion Hirsch, München, Wien');
  // The initial still keeps a sentence whole where no key follows it.
  assert.deepEqual(readProvenance('Ex Dr. Sear collection, 1975.').map(({ text }) => text), ['Ex Dr. Sear collection, 1975']);
  assert.deepEqual(readProvenance('Aus Sammlung Dr. W. R. Erworben 1998.').map(({ text }) => text), ['Aus Sammlung Dr. W. R', 'Erworben 1998']);
});

// Loop Q-07: Leu, Nomos, NAC, NGSA, Roma, Naville, Gorny & Mosch, Hess-Divo and Sotheby's close an entry with the lot and no lot word ("Ex Leu Web
// Auction 12, 30 May 2020, 234."), which was glued into the source as a sale called "Leu Web Auction 12, 234"; "and ex" joined two owners into one;
// and CNG's "Acquired from" / "Purchased from" was no provenance at all.
test('the provenance reader takes a bare lot number behind the date, splits at "and ex", and reads the purchase markers', () => {
  for (const [text, source, year, lot] of [
    ['Ex Leu Web Auction 12, 30 May 2020, 234.', 'Leu Web Auction 12', 2020, '234'], ['Ex Nomos 21, 21 November 2020, 123.', 'Nomos 21', 2020, '123'],
    ['Ex NAC 78, 26 May 2014, 1234.', 'NAC 78', 2014, '1234'], ['Ex Roma XX, 29 October 2020, 336.', 'Roma XX', 2020, '336'],
    ['Ex Naville Numismatics 53, 2019, 145.', 'Naville Numismatics 53', 2019, '145'], ['Ex Gorny & Mosch 265, 2019, 145.', 'Gorny & Mosch 265', 2019, '145'],
    ["From the Hunt collection, Sotheby's New York, 19 June 1990, 12.", "the Hunt collection, Sotheby's New York", 1990, '12'],
    ['Ex Leu 7 (1973), 123a.', 'Leu 7', 1973, '123a'], ['Ex NAC 78, 26 May 2014, 1987.', 'NAC 78', 2014, '1987'],
    ['Ex Lanz 145, 5 January 2009, lot 1234 (there described as EF).', 'Lanz 145', 2009, '1234'],
    ['Ex Lanz 145, 5 January 2009, 1234 (where described as "Good VF").', 'Lanz 145', 2009, '1234'],
  ]) {
    const [entry] = readProvenance(text);
    assert.deepEqual([entry.source, entry.year, entry.lot], [source, year, lot], text);
    assert.equal(entry.text, text.slice(0, -1), text);
  }
  assert.deepEqual(readProvenance('Ex Hess-Divo 333, 2017, 55 and ex Sternberg XXIII, 1989, 178.').map(({ source, year, lot }) => [source, year, lot]),
    [['Hess-Divo 333', 2017, '55'], ['Sternberg XXIII', 1989, '178']]);
  assert.deepEqual(readProvenance('Ex Leu 86, 5 May 2003, 645; ex Bank Leu 25, 23 April 1980, 210.').map(({ source, lot }) => [source, lot]),
    [['Leu 86', '645'], ['Bank Leu 25', '210']]);
  // Only after a year: a number behind anything else, a decimal-looking pair, a sale or auction number, and a list are not the lot.
  for (const [text, source] of [['Ex Leu 7, 1973,5.', 'Leu 7, 1973,5'], ['Ex Leu 86, 645.', 'Leu 86, 645'], ['Ex Leu sale 1850, 7.', 'Leu sale 1850, 7'],
    ['Ex Künker Auction 2019, 145.', 'Künker Auction 2019, 145'], ['Ex Leu 86, 2003, 645-646.', 'Leu 86, 645-646'], ['Ex Leu 86, 2003, 12, 15.', 'Leu 86, 12, 15']]) {
    const [entry] = readProvenance(text);
    assert.equal(entry.source, source, text);
    assert.equal(entry.lot, undefined, text);
  }
  // "and" joins two owners only in front of another "ex": a firm's own "and" stays in its name.
  for (const text of ['Ex Spink and Son, 1998.', 'Ex Bank Leu and Münzen und Medaillen 25, 1980, 12.', 'Ex Baldwin and Exeter collection, 2001.']) {
    assert.equal(readProvenance(text).length, 1, text);
  }
  assert.deepEqual(readProvenance('Acquired from Spink, 1998.'), [{ text: 'Acquired from Spink, 1998', source: 'Acquired from Spink', year: 1998 }]);
  assert.deepEqual(readProvenance('Nero. Denarius. RIC 53. Purchased from Harlan J. Berk, 2005. Privately purchased from Frank Kovacs, 1999.')
    .map(({ source, year }) => [source, year]), [['Purchased from Harlan J. Berk', 2005], ['Privately purchased from Frank Kovacs', 1999]]);
  assert.deepEqual(readProvenance('Bought from Seaby, 1965.').map(({ year }) => year), [1965]);
  assert.deepEqual(texts('Purchased from CNG, 2005. RIC 53.'), ['RIC 53']);
  // Only at the start of a sentence and with its capital, as "Ex" is: the verb in the middle of prose is no marker.
  for (const text of ['Nero. The coin was acquired in 1998. RIC 53.', 'Nero. Denarius, purchased 1998. RIC 53.', 'Nero. acquired from Spink, 1998.']) {
    assert.deepEqual(readProvenance(text), [], text);
  }
});

// Loop Q-08: Naville and NAC head Augustus's coins "Octavian as Augustus"; the heading reads Octavian, whom RIC I² heads no section with and under
// whose name no bundled type is filed, so the lookup offered every RIC 207 from Augustus to Hadrian. RIC files every Octavian coin under Augustus: a
// heading naming Octavian names Augustus beside him, and no other name gets that rule.
test('a heading naming Octavian names Augustus beside him, as RIC files his coins', () => {
  assert.deepEqual(findReferences('Octavian as Augustus, 27 BC – 14 AD. Denarius. RIC 207.').rulers, ['Octavian', 'Augustus']);
  assert.deepEqual(findReferences('Octavian, 44-27 BC. Denarius, 29-27 BC. RIC 267.').rulers, ['Octavian', 'Augustus']);
  assert.deepEqual(findReferences('Octavian and Agrippa. Nemausus. As. RIC 155.').rulers, ['Octavian', 'Augustus', 'Agrippa']);
  // Augustus named as well is still named once, and a heading naming only Augustus, or neither, is read as before.
  assert.deepEqual(findReferences('Octavian, later Augustus. Augustus. Denarius. RIC 207.').rulers, ['Octavian', 'Augustus']);
  assert.deepEqual(findReferences('Augustus, 27 BC – 14 AD. Denarius. RIC 207.').rulers, ['Augustus']);
  assert.deepEqual(findReferences('Octavia. Cistophorus. RIC 409.').rulers.includes('Augustus'), false);
  // A legend or a provenance naming him is no heading.
  assert.deepEqual(findReferences('Nero. Denarius. Ex Octavian collection, 1990. RIC 53.').rulers, ['Nero']);
});

// Loop Q-17: Áureo writes Calicó "Cal-1015", which was no key at all, and CGB and Jean Elsen space RIC's type letter off the number ("RIC 27 b"),
// which read as RIC 27: another coin.
test('Cal. is Calicó, spelled out in the row, and a single spaced letter behind a RIC number is its type letter', () => {
  for (const [text, row] of [['RIC-118; Cal-1015; RSC-462a.', 'Calicó 1015'], ['Cal. 1015.', 'Calicó 1015'], ['Cal 1015; RSC 462a.', 'Calicó 1015'],
    ['Felipe II. 8 reales. Cal-123. MBC.', 'Calicó 123']]) {
    const found = findReferences(text).references.find(({ reference }) => /^Calic/.test(reference.number));
    assert.deepEqual(found?.reference, other(row), text);
  }
  assert.deepEqual(texts('Trajano. Denario. RIC-118; Cal-1015; RSC-462a. MBC+/EBC-.'), ['RIC-118', 'Calicó 1015', 'RSC-462a']);
  // Only a capitalised "Cal" with its number straight behind it: the word, California and a lower-case "cal" are no key.
  for (const text of ['Denarius. Calendar reform issue. RIC 118.', 'Found in Cal. 1998 hoard? RIC 118.', 'Denarius, cal 1015. RIC 118.', 'Cal. RIC 118.']) {
    assert.deepEqual(texts(text).filter((row) => /^Cal/.test(row)), [], text);
  }
  for (const [text, number] of [['Philip I. Antoninianus. RIC 27 b;', '27b'], ['Philip I. RIC IV 27 b; C. 9.', '27b'], ['Philip I. RIC 27 b (Rome).', '27b'],
    ['Philip I. RIC 27 b', '27b'], ['Philip I. RIC 27 b var.', '27b']]) {
    assert.equal(findReferences(text).references[0].reference.number, number, text);
  }
  // A capital is Cohen's C or another key, a letter with more behind it is a word, and a date's "a.C." is no letter.
  for (const [text, number] of [['Philip I. RIC 27 C. 9.', '27'], ['Philip I. RIC 27 a rare variety.', '27'], ['Philip I. RIC 27; C. 9.', '27'],
    ['Filippo I, 244-249 d.C. RIC 27 a.C.', '27']]) {
    assert.equal(findReferences(text).references[0].reference.number, number, text);
  }
});

// Loop P2 review, Important 1 and 2: the spaced letter was glued on wherever a lone lower-case letter closed the first chunk, so the German "335 f."
// (and following) opened RIC 335f, and "s.", "u.", "v.", "n.", "p." lost the coin main found. It is decided from the raw text now: RIC's own
// alphabet (a–l), never a letter with a full stop behind it, and CGB's own " - " separator, "=" and a line break close it.
test('a spaced RIC letter is read only from the RIC alphabet, never with a full stop behind it, and CGB dash closes it', () => {
  for (const [text, number] of [['Gallienus. Antoninian. RIC 335 f.', '335'], ['Nero. Denar. RIC 306 s.', '306'], ['Nero. Denar. RIC 306 v. Chr.', '306'],
    ['Pescennius Niger. Denar. RIC 3 f.', '3'], ['Nero. Denar. RIC 306 ff.', '306'], ['Nero. Denar. RIC 306 f. Göbl 12.', '306'], ['Nero. RIC 306 m;', '306'],
    ['Nero. RIC 306 a. Chr.', '306'], ['Philip I. RIC 27 f; C. 9.', '27f'], ['Philippe Ier. Antoninien. RIC.27 b - C.9 - RSC.9.', '27b'],
    ['Philip I. RIC 27 b = C. 9.', '27b'], ['Philip I. RIC 27 b – C. 9.', '27b'], ['Philip I. RIC 27 b\nCohen 9.', '27b'], ['Philip I. RIC 27 b, C. 9.', '27b']]) {
    assert.equal(findReferences(text).references[0].reference.number, number, text);
  }
  assert.deepEqual(texts('Nero. Denar. RIC 306 u. Cohen 12.'), ['RIC 306', 'Cohen 12']);
});

// Loop P2 review, Minor Q-07: a purchase sentence ends at a ";" or "," a citation follows, as it ends at a full stop; and a sale's bracketed date and
// lot ("Triton VIII (2005, 1132)") give the lot.
test('a purchase sentence gives up the citation behind it, and a bracketed year and lot give the lot', () => {
  for (const text of ['Acquired from Spink, 1998; RIC 53; BMC 12.', 'Acquired from Spink, 1998, RIC 53.', 'Bought from Seaby; RIC 53.']) {
    assert.equal(texts(text)[0], 'RIC 53', text);
    assert.equal(readProvenance(text).length, 1, text);
  }
  assert.deepEqual(readProvenance('Acquired from Spink, 1998; RIC 53.'), [{ text: 'Acquired from Spink, 1998', source: 'Acquired from Spink', year: 1998 }]);
  // "Ex" keeps its own rule, as it always has.
  assert.deepEqual(texts('Ex Spink, 1998; RIC 53.'), []);
  assert.deepEqual(readProvenance('Ex Triton VIII (2005, 1132).'), [{ text: 'Ex Triton VIII (2005, 1132)', source: 'Triton VIII', year: 2005, lot: '1132' }]);
  for (const text of ['Ex Leu 7 (1973).', 'Ex Leu 7 (sale 1850, 12).', 'Ex Leu 7 (12, 1132).']) assert.equal(readProvenance(text)[0].lot, undefined, text);
});

// Loop P2 review, Minor Q-17 (a): Áureo writes the edition year of Calicó in front of the number ("Cal. 2008, 1015", "Cal-2019-123").
test('the edition year of Calicó is not joined to the number', () => {
  for (const [text, row] of [['Cal. 2008, 1015.', 'Calicó 1015'], ['Cal-2019-123.', 'Calicó 123'], ['Cal. 1015, 1016.', 'Calicó 1015, 1016'], ['Cal. 1015.', 'Calicó 1015']]) {
    assert.equal(findReferences(`Felipe II. 8 reales. ${text} MBC.`).references[0]?.text, row, text);
  }
});

// Loop P2 fix round 2: "RIC 27 b." is ambiguous — the type letter b, or an abbreviation with its full stop — so the row carries the letter as a
// dotted one, and the lookup offers both readings and opens neither. Only a letter of RIC's alphabet with a full stop and a space or the end
// behind it; every other shape reads as before.
test('a dotted RIC letter behind the number is carried on the row as ambiguous, and nothing else is', () => {
  const dotted = (text) => findReferences(text).references[0].reference.dottedLetter;
  for (const [text, letter] of [['Philip I. RIC 27 b.', 'b'], ['Gallienus. RIC 335 f.', 'f'], ['Philip I. RIC IV 27 b. C. 9.', 'b']]) {
    assert.equal(dotted(text), letter, text);
    assert.equal(findReferences(text).references[0].reference.number, text.match(/(\d+) [a-l]\./)[1], text);
  }
  for (const text of ['Nero. RIC 306 s.', 'Nero. RIC 306 ff.', 'Nero. RIC 306 v. Chr.', 'Filippo I. RIC 27 a.C.', 'Philip I. RIC 27 b;', 'Philip I. RIC 27b.',
    'Nero. RIC 306.', 'Nero. RIC 306 m.', 'Nero. Cohen 306 f.', 'Nero. RIC 306 a rare coin.',
    'Nero. RIC 306 a. Chr.', 'Nero. RIC 306 n. Chr.', 'Nero. RIC 306 c. 300 AD.']) {
    assert.equal(dotted(text), undefined, text);
  }
  const lot = findReferences('Philip I. Antoninian. RIC IV 27 b.');
  assert.equal(lotLookup(lot.references[0], lot.rulers).dottedLetter, 'b');
});

// Loop P2 fix round 3 (re-review Minor 1 and 3): a dotted letter is the one straight behind the row's own number, never one behind a later figure a
// unit or a die axis carries; a spaced abbreviation or grade behind it ("a. VF", "g. VF", "f. vz.", "d. h.", "i. e.", the Italian "a. C.") is no
// letter; and the row keeps the letter as the dealer wrote it, so the lot line says why two types are offered.
test('a dotted letter is read only straight behind the row\'s number, never before a spaced abbreviation or grade, and the row shows it', () => {
  const dotted = (text) => findReferences(text).references[0]?.reference.dottedLetter;
  for (const text of ['Nero. RIC 12. 12 h.', 'As. RIC 12. 12 g.', 'Nero. RIC 3. 3 g.', 'Nero. RIC 306 a. VF.', 'Nero. RIC 306 g. VF.', 'Nero. RIC 306 c. VF.',
    'Nero. RIC 306 e. EF.', 'Nero. RIC 306 f. vz.', 'Nero. RIC 306 d. h. selten.', 'Nero. RIC 306 i. e. rare.', 'Filippo I. RIC 27 a. C.', 'Nero. RIC 306 a. a. O.']) {
    assert.equal(dotted(text), undefined, text);
  }
  for (const [text, letter] of [['Philip I. RIC 27 b.', 'b'], ['Philip I. RIC IV 27 b. C. 9.', 'b'], ['Philip I. RIC 27 b. Sehr schön.', 'b'], ['Philip I. RIC IV/3 27 b.', 'b']]) {
    assert.equal(dotted(text), letter, text);
  }
  const lot = findReferences('Philip I. Antoninian. RIC IV 27 b.');
  assert.equal(lot.references[0].text, 'RIC IV 27 b.');
  assert.equal(lotLabel(lot.references[0], lot.rulers), 'RIC IV 27 b. · Philip I');
  assert.equal(lot.references[0].reference.number, '27');
});

// Loop P2 fix round 3 (re-review Minor 4): the three purchase shapes that still took the citation with them.
test('a purchase sentence gives up a citation behind a spaced dash, a bracket or a bare space', () => {
  for (const text of ['Purchased from Spink, 1998 - RIC 53.', 'Purchased from Seaby, 1965 (RIC 53).', 'Acquired from Spink 1998 RIC 53']) {
    assert.equal(texts(text)[0], 'RIC 53', text);
    assert.equal(readProvenance(text).length, 1, text);
  }
  assert.deepEqual(readProvenance('Purchased from Seaby, 1965 (RIC 53).').map(({ source, year }) => [source, year]), [['Purchased from Seaby', 1965]]);
  // "Ex" keeps its own rule, and a purchase sentence without a citation behind it is whole.
  assert.deepEqual(texts('Ex Spink, 1998 - RIC 53.'), []);
  assert.deepEqual(readProvenance('Purchased from Spink - London, 1998.').map(({ text }) => text), ['Purchased from Spink - London, 1998']);
});

// Loop V-03: Tauler & Fau's lot reads its RIC row with the volume, so the heading's ruler finds the card offline.
test('a Tauler & Fau lot reads "(Ric-II 118)" as RIC II 118', () => {
  const lot = findReferences('Trajan. Denarius. 103-111 AD. Rome. (Ric-II 118). (Bmcre-284). (Rsc-74). Ag. 3,32 g. Choice VF. Est...100.');
  assert.deepEqual(lot.references[0].reference, ric('118', 'II'));
  assert.equal(lot.references[0].text, 'Ric-II 118');
  assert.deepEqual(lot.rulers, ['Trajan']);
  assert.deepEqual(findReferences('Nero. As. 62-68 AD. Rome. (Ric-I 306). (Wcn-275).').references[0].reference, ric('306', 'I'));
  assert.deepEqual(findReferences('Antoninus Pius. Sestertius. 145-161 AD. Rome. (Ric-III 772). (Bmcre-1655).').references[0].reference, ric('772', 'III'));
});

// Loop V-07: Soler y Llach, Áureo and Tauler & Fau head their lots with the Spanish name, in capitals ("AUGUSTO. Denario. … Lugdunum. (RIC 207;
// RSC 43)"). Ten of RIC's emperors were read by nobody, so the mint alone was the section and an Augustus denarius was offered as RIC VI–VIII
// Lugdunum 207. Each spelling names its one person, with its accent or without, in capitals or in title case, never in lower case.
test('a Spanish heading names its emperor, and a lower-case word or another numeral names nobody', () => {
  const rulers = (text) => findReferences(text).rulers;
  for (const [heading, expected] of [
    ['AUGUSTO', ['Augustus']], ['Augusto', ['Augustus']], ['TIBERIO', ['Tiberius']], ['CLAUDIO', ['Claudius']], ['TITO', ['Titus']],
    ['DOMICIANO', ['Domitian']], ['ANTONINO PÍO', ['Antoninus Pius']], ['ANTONINO PIO', ['Antoninus Pius']], ['Antonino Pío', ['Antoninus Pius']],
    ['MARCO AURELIO', ['Marcus Aurelius']], ['CÓMODO', ['Commodus']], ['COMODO', ['Commodus']], ['Cómodo', ['Commodus']],
    ['SEPTIMIO SEVERO', ['Septimius Severus']], ['JULIANO II', ['Julian the Apostate']],
  ]) assert.deepEqual(rulers(`${heading}. Denario. (Ar. 3,73g/19mm). Roma. (RIC 12; RSC 43).`), expected, heading);
  assert.deepEqual(rulers('AUGUSTO. Denario. (Ar. 3,73g/19mm). 2 a.C.-4 d.C. Lugdunum. (RIC 207; RSC 43). Anv: Cabeza laureada de Augusto a derecha.'),
    ['Augustus']);
  // Another emperor's numeral makes him someone else, a lower-case word is the adjective, and the title he holds is no second ruler.
  assert.deepEqual(rulers('CLAUDIO II. Antoniniano. RIC 12.'), ['Claudius II Gothicus']);
  assert.deepEqual(rulers('JULIANO. Denario. RIC 12.'), []);
  assert.deepEqual(rulers('Retrato augusto. Denario. RIC 12.'), []);
  for (const spelling of ['augusto', 'tiberio', 'claudio', 'tito', 'domiciano', 'antonino pio', 'marco aurelio', 'comodo', 'septimio severo', 'juliano ii']) {
    assert.deepEqual(rulers(`Denario, ${spelling}. RIC 12.`), [], spelling);
  }
  assert.deepEqual(rulers('CONSTANTINO I como Augusto. Follis. RIC VII 12.'), ['Constantine I']);
  assert.deepEqual(rulers('Constantino II como César. Follis. RIC VII 12.'), ['Constantine II']);
  assert.deepEqual(rulers('Tiberio come Augusto. Asse. RIC 12.'), ['Tiberius']);
});

// Loop V-09: three provenance shapes the audit found. Sincona's hammer bracket after the lot was glued into the source; the Italian houses' "Provenienza:
// Asta Artemide XLV, 2016, lotto 234" read as nothing; and "acquired from X in 1988" kept the verb and the "in" inside the source.
test('provenance drops a trailing remark bracket, reads the Italian houses, and reads "acquired from X in YEAR" as X', () => {
  assert.deepEqual(readProvenance('Ex Sincona 40, 23 October 2017, lot 1023 (hammer CHF 3,200).'),
    [{ text: 'Ex Sincona 40, 23 October 2017, lot 1023 (hammer CHF 3,200)', source: 'Sincona 40', year: 2017, lot: '1023' }]);
  assert.deepEqual(readProvenance('Ex NAC 27, 2004, lot 312 (realised 1,200 CHF).').map(({ source }) => source), ['NAC 27']);
  assert.deepEqual(readProvenance('Provenienza: Asta Artemide XLV, 2016, lotto 234; ex NAC 27, 2004, 312.'), [
    { text: 'Asta Artemide XLV, 2016, lotto 234', source: 'Asta Artemide XLV', year: 2016, lot: '234' },
    { text: 'ex NAC 27, 2004, 312', source: 'NAC 27', year: 2004, lot: '312' },
  ]);
  assert.deepEqual(readProvenance('Asta Bertolami 12, 2015, lotto 45.'), [{ text: 'Asta Bertolami 12, 2015, lotto 45', source: 'Asta Bertolami 12', year: 2015, lot: '45' }]);
  assert.deepEqual(readProvenance('From the collection of a Swiss lawyer, acquired from Münzen & Medaillen AG Basel in 1988.'), [
    { text: 'From the collection of a Swiss lawyer', source: 'the collection of a Swiss lawyer' },
    { text: 'acquired from Münzen & Medaillen AG Basel in 1988', source: 'Münzen & Medaillen AG Basel', year: 1988 },
  ]);
  // What was read before still is: a bracket inside the source, a place in brackets, the comma-year purchase sentence, a German purchase.
  assert.deepEqual(readProvenance("Ex Hunt collection (part II), Sotheby's 1991.").map(({ source }) => source), ["Hunt collection (part II), Sotheby's"]);
  assert.deepEqual(readProvenance('Ex NAC 27 (Zurich), 2004.').map(({ source }) => source), ['NAC 27 (Zurich)']);
  assert.deepEqual(readProvenance('Acquired from Spink, 1998.'), [{ text: 'Acquired from Spink, 1998', source: 'Acquired from Spink', year: 1998 }]);
  assert.deepEqual(readProvenance('Erworben 1998 bei Lanz.'), [{ text: 'Erworben 1998 bei Lanz', source: 'Erworben bei Lanz', year: 1998 }]);
  // "Asta" is also the spear a type is described with: only a house's name behind it at the start of a sentence makes it a sale.
  assert.deepEqual(readProvenance('Minerva stante con asta e scudo. Asta e scudo. RIC 12.'), []);
  assert.deepEqual(findReferences('Minerva con asta. Asta e scudo. RIC 12.').references.map(({ text }) => text), ['RIC 12']);
  // An Italian provenance is no reference: its sale's number is never read as one.
  assert.deepEqual(findReferences('Traiano. Denario. RIC 118. Provenienza: Asta Artemide XLV, 2016, lotto 234.').references.map(({ text }) => text), ['RIC 118']);
});

// Loop V-12: Rauch's German edition remark is no part of the number.
test('a lot row drops "(2. Aufl.)" behind the number', () => {
  const lot = findReferences('RÖMISCHE KAISERZEIT. Nero 54-68. As, Rom, 62-68. 10,80g. RIC 306 (2. Aufl.), WCN 275. ss/vz');
  assert.deepEqual(lot.references[0].reference, ric('306'));
  assert.equal(lot.references[0].text, 'RIC 306');
  assert.deepEqual(findReferences('Nero. As. RIC 306 (2e éd.); WCN 275.').references[0].reference, ric('306'));
  assert.deepEqual(findReferences('Nero. As. RIC 306 2. Aufl., WCN 275.').references.map(({ reference }) => reference), [ric('306')]);
  // The first edition's numbers are not the bundle's: that remark stays on the number, and nothing is opened on it.
  assert.notDeepEqual(findReferences('Nero. As. RIC 306 (1. Aufl.), WCN 275.').references[0].reference, ric('306'));
  assert.notDeepEqual(findReferences('Nero. As. RIC 306 1. Aufl., WCN 275.').references[0].reference, ric('306'));
});

// Loop S1 review, Important 2 and Minor 4: "Claudio" is Claudius, so a Spanish or Italian heading naming Claudius Gothicus by his epithet
// ("CLAUDIO GÓTICO", "Claudio il Gotico") opened Claudius I's as of AD 41 for an antoninianus of 268, and "Marco Aurelio" swallowed the emperors whose
// full names open with it (Probus, Carus, Numerian, Carinus). The long forms name their own man, the epithets of the other emperors RIC files under
// one (the Apostate, the Arab, the Thracian, the Great) are read the same way, and "Marco Aurelio" with a further name is nobody it can be sure of.
test('a Spanish or Italian heading naming an emperor by his epithet or his full name names him', () => {
  const rulers = (text) => findReferences(`${text}. Antoniniano. Roma. (RIC 12).`).rulers;
  for (const [heading, expected] of [
    ['CLAUDIO GÓTICO', 'Claudius II Gothicus'], ['Claudio Gótico, 268-270', 'Claudius II Gothicus'], ['Claudio el Gótico', 'Claudius II Gothicus'],
    ['Claudio il Gotico', 'Claudius II Gothicus'], ['CLAUDIO II', 'Claudius II Gothicus'], ['CLAUDIO II EL GÓTICO', 'Claudius II Gothicus'], ['Claudio II il Gotico', 'Claudius II Gothicus'],
    ['JULIANO EL APÓSTATA', 'Julian the Apostate'], ['Juliano Apóstata', 'Julian the Apostate'], ["Giuliano l'Apostata", 'Julian the Apostate'],
    ['Giuliano l’Apostata', 'Julian the Apostate'], ['GIULIANO II', 'Julian the Apostate'],
    ['FILIPO EL ÁRABE', 'Philip the Arab'], ["Filippo l'Arabo", 'Philip the Arab'], ['Filippo l’Arabo', 'Philip the Arab'],
    ['MAXIMINO EL TRACIO', 'Maximinus Thrax'], ['Massimino il Trace', 'Maximinus Thrax'],
    ['CONSTANTINO EL GRANDE', 'Constantine I'], ['Costantino il Grande', 'Constantine I'], ['Costantino Magno', 'Constantine I'],
    ['TEODOSIO EL GRANDE', 'Theodosius I'], ['Teodosio il Grande', 'Theodosius I'], ['Teodosio I', 'Theodosius I'],
    ['MARCO AURELIO PROBO', 'Probus'], ['Marco Aurelio Caro', 'Carus'], ['Marco Aurelio Numeriano', 'Numerian'], ['MARCO AURELIO CARINO', 'Carinus'],
    ['DOMICIO DOMICIANO', 'Domitius Domitianus'],
  ]) assert.deepEqual(rulers(heading), [expected], heading);
  // Claudius himself is still Claudius, and Marcus Aurelius himself still Marcus Aurelius; with a further name "Marco Aurelio" is nobody.
  assert.deepEqual(rulers('CLAUDIO'), ['Claudius']);
  assert.deepEqual(rulers('MARCO AURELIO'), ['Marcus Aurelius']);
  assert.ok(rulers('Marco Aurelio y Lucio Vero').includes('Marcus Aurelius'));
  assert.deepEqual(rulers('MARCO AURELIO ANTONINO'), []);
  assert.deepEqual(rulers('Marco Aurelio César'), []);
  assert.deepEqual(rulers('Teodosio II'), []);
});
