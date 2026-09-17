import test from 'node:test';
import assert from 'node:assert/strict';
import { RIC_VOLUMES, RIC_SECTIONS, RIC_RULERS, ANY_VOLUME, VOLUME_OPTIONS, BIGR_KINGS, canonicalRicPerson, isRicPerson, ricMintSection, ricPeople, sectionMismatch, volumesOf, volumeFor, selectOptions } from '../extension/catalogues.js';
import { buildQuery, parseReference } from '../extension/lookup.js';

test('the twelve RIC volumes are in RIC order, and every volume and section round-trips through parseReference and buildQuery', () => {
  assert.deepEqual(RIC_VOLUMES.map((volume) => volume.value), [
    'I (2nd edition)', 'II', 'II, Part 1 (2nd edition)', 'II, Part 3 (2nd edition)', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  ]);
  assert.deepEqual(RIC_VOLUMES.map((volume) => volume.label), ['I² (2nd ed.)', 'II', 'II.1² (2nd ed.)', 'II.3² (2nd ed.)', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
  assert.deepEqual(Object.keys(RIC_SECTIONS), RIC_VOLUMES.map((volume) => volume.value));
  assert.equal(Object.values(RIC_SECTIONS).reduce((count, list) => count + list.length, 0), 196);
  assert.ok(Object.isFrozen(RIC_VOLUMES) && Object.isFrozen(RIC_SECTIONS) && Object.values(RIC_SECTIONS).every(Object.isFrozen));
  for (const [value, sections] of Object.entries(RIC_SECTIONS)) {
    assert.deepEqual(sections, [...sections].sort(), value);
    assert.equal(new Set(sections).size, sections.length, value);
    const ocre = value.replace('2nd edition', 'second edition');
    for (const section of sections) {
      const title = `RIC ${ocre} ${section} 1`;
      assert.deepEqual(parseReference(title), { catalogue: 'RIC', volume: value, section, number: '1' }, title);
      assert.equal(buildQuery({ catalogue: 'RIC', volume: value, section, number: '1' }).query, title);
    }
  }
  assert.deepEqual(RIC_SECTIONS['II, Part 1 (2nd edition)'], ['Domitian', 'Titus', 'Vespasian']);
  assert.ok(RIC_SECTIONS['I (2nd edition)'].includes('Nero'));
  assert.ok(RIC_SECTIONS.V.includes('Valerian, Gallienus, Valerian II, and Salonina'));
  assert.ok(RIC_SECTIONS.V.includes('Carausius issuing for Diocletian/Maximian'));
  // OCRE's second series of Salonina types is a real section, not subtype noise.
  for (const section of ['Salonina (2)', 'Gallienus and Salonina (2)']) assert.ok(RIC_SECTIONS.V.includes(section), section);
});

test('RIC_RULERS holds every ruler and mint section of every volume once, in code-unit order', () => {
  assert.equal(RIC_RULERS.length, new Set([...Object.values(RIC_SECTIONS).flat(), ...RIC_RULERS]).size);
  assert.ok(Object.isFrozen(RIC_RULERS));
  assert.deepEqual([...RIC_RULERS], [...RIC_RULERS].sort());
  assert.equal(new Set(RIC_RULERS).size, RIC_RULERS.length);
  assert.ok(Object.values(RIC_SECTIONS).flat().every((section) => RIC_RULERS.includes(section)));
  for (const ruler of ['Titus', 'Antioch', 'Hadrian', 'Nero', 'Zeno (East)', 'Gaius/Caligula']) assert.ok(RIC_RULERS.includes(ruler), ruler);
});

test('VOLUME_OPTIONS offers Any volume before the twelve volumes', () => {
  assert.deepEqual(ANY_VOLUME, { value: '', label: 'Any volume' });
  assert.ok(Object.isFrozen(ANY_VOLUME) && Object.isFrozen(VOLUME_OPTIONS));
  assert.equal(VOLUME_OPTIONS.length, 13);
  assert.equal(VOLUME_OPTIONS[0], ANY_VOLUME);
  assert.deepEqual(VOLUME_OPTIONS.slice(1), [...RIC_VOLUMES]);
});

const I2 = 'I (2nd edition)';
const II1 = 'II, Part 1 (2nd edition)';
const II3 = 'II, Part 3 (2nd edition)';

test('volumesOf lists the volumes that have a ruler, ignoring case and spacing, and none for anything else', () => {
  assert.deepEqual(volumesOf('Titus'), [II1]);
  assert.deepEqual(volumesOf(' hadrian '), ['II', II3]);
  assert.deepEqual(volumesOf('ANTIOCH'), ['VI', 'VII', 'VIII', 'IX']);
  assert.deepEqual(volumesOf('Zeno   (East)'), ['X']);
  // A ruler OCRE splits into sections is also known by the name before the parenthesis ("Theodosius II (East)" and "(West)").
  assert.deepEqual(volumesOf('Theodosius II'), ['X']);
  assert.deepEqual(volumesOf('leo i'), ['X']);
  assert.deepEqual(volumesOf('Gallienus'), ['V']);
  assert.deepEqual(volumesOf('salonina (2)'), ['V']);
  for (const nothing of ['', '  ', 'hello', 'Tit', 'Leo', 'Theodosius', 'Salonina (3)', 'constructor', '__proto__', 'toString', undefined, null]) assert.deepEqual(volumesOf(nothing), [], String(nothing));
});

test('volumeFor keeps a volume that has the ruler, else takes its only volume, else Any volume; an unknown ruler changes nothing', () => {
  assert.equal(volumeFor('Titus', I2), II1);
  assert.equal(volumeFor('titus', ''), II1);
  assert.equal(volumeFor('Nero', I2), I2);
  assert.equal(volumeFor('Hadrian', I2), '');
  assert.equal(volumeFor('Hadrian', 'II'), 'II');
  assert.equal(volumeFor('Hadrian', II3), II3);
  assert.equal(volumeFor('Antioch', ''), '');
  assert.equal(volumeFor('Antioch', 'III'), '');
  assert.equal(volumeFor('Antioch', 'VIII'), 'VIII');
  assert.equal(volumeFor('Theodosius II', I2), 'X');
  for (const unknown of ['', 'hello', 'Tit', 'constructor', '__proto__']) assert.equal(volumeFor(unknown, 'IV'), 'IV', unknown);
  assert.equal(volumeFor('Hermaeus', ''), '');
});

test('mint-volume people are suggested and canonicalised without changing section volume semantics', () => {
  assert.ok(RIC_RULERS.includes('Constantine II'));
  assert.equal(isRicPerson('Constantinus II'), true);
  assert.equal(canonicalRicPerson('Constantinus II'), 'Constantine II');
  assert.deepEqual(volumesOf('Constantine II'), []);
  assert.equal(volumeFor('Constantine II', 'VII'), 'VII');
  assert.equal(volumeFor('Constantine III', 'VII'), 'VII');
  assert.equal(sectionMismatch('Constantine III', 'VII'), false);
  assert.equal(sectionMismatch('Titus', 'I (2nd edition)'), true);
});

test('the 48 BIGR kings are in code-unit order without the data typos', () => {
  assert.equal(BIGR_KINGS.length, 48);
  assert.deepEqual([...BIGR_KINGS], [...BIGR_KINGS].sort());
  assert.equal(new Set(BIGR_KINGS).size, 48);
  assert.ok(Object.isFrozen(BIGR_KINGS));
  for (const king of ['Euthydemus I', 'Hermaeus', 'Diodotus I or Diodotus II', 'Menander I', 'Archebius', 'Theophilus II', 'Zoilus II']) assert.ok(BIGR_KINGS.includes(king), king);
  for (const bad of ['Hermaues', 'Archebios', 'Theohpilus II', 'Menander I14A', 'Menander I14A ', 'Eucratides I A', 'Eucratides I A.1']) assert.ok(!BIGR_KINGS.includes(bad), bad);
  assert.ok(BIGR_KINGS.every((king) => king === king.trim() && !/\d/.test(king)));
  assert.equal(BIGR_KINGS.indexOf('Heliocles and Laodice'), BIGR_KINGS.indexOf('Heliocles II') + 1);
});

test('selectOptions lists the entries and appends an unlisted, non-blank value as its own option', () => {
  assert.deepEqual(selectOptions(RIC_VOLUMES, 'IV, Part 1').at(-1), { value: 'IV, Part 1', label: 'IV, Part 1' });
  assert.deepEqual(selectOptions(VOLUME_OPTIONS, '<b>x</b>').at(-1), { value: '<b>x</b>', label: '<b>x</b>' });
  assert.equal(selectOptions(VOLUME_OPTIONS, undefined).length, 13);
  assert.equal(selectOptions(RIC_VOLUMES, 'II, Part 1 (2nd edition)').length, 12);
  assert.equal(selectOptions(VOLUME_OPTIONS, '').length, 13);
  assert.equal(selectOptions(VOLUME_OPTIONS, 'IV, Part 1').length, 14);
});

// Nomisma files a ruler's name in every language it has; only the English and Latin spellings are ones a dealer writes, and the importer folds
// those onto each person, so a heading reaches the person however it is punctuated or accented.
test('a person is found by the English and Latin spellings Nomisma files, folded and without diacritics', () => {
  assert.equal(canonicalRicPerson('Claudius Gothicus'), 'Claudius II Gothicus');
  assert.equal(canonicalRicPerson('  ALEXANDER   SEVERUS '), 'Severus Alexander');
  assert.equal(canonicalRicPerson('Philippus Arabs'), 'Philip the Arab');
  assert.equal(isRicPerson('Sabinus Julianus'), true);
  // A spelling two people share stays on both of them, so the lookup offers the two: dropping it lost the name, and picking one opened a stranger's
  // coin. A diacritic never hides it — every alias is compared folded, as the importer stored it.
  assert.deepEqual(ricPeople('Valerianus').map(({ id }) => id), ['valerian', 'valerian_ii']);
  assert.deepEqual(ricPeople('Valeriánus').map(({ id }) => id), ['valerian', 'valerian_ii']);
  assert.deepEqual(ricPeople('Domitianus').map(({ id }) => id), ['domitian_ii', 'domitius_domitianus']);
  assert.equal(canonicalRicPerson('Valerianus'), '');
  // A one-word name that stands inside other people's names is every one of them, never one alone: "Sextus" is a praenomen two emperors carry.
  assert.deepEqual(ricPeople('Sextus').map(({ name }) => name), ['Saturninus', 'Martinianus']);
  assert.equal(canonicalRicPerson('Sextus'), '');
  assert.equal(canonicalRicPerson('Nero'), 'Nero');
  assert.equal(canonicalRicPerson('Titus'), 'Titus');
  // A regnal "I" only tells the plain name from a "II" the table also holds.
  assert.equal(canonicalRicPerson('Licinius I'), 'Licinius');
  assert.deepEqual(ricPeople('Valerian I').map(({ id }) => id), ['valerian']);
  for (const unknown of ['', '  ', 'hello', 'Tit', 'Leo', 'Theodosius', 'Croesus', 'constructor', '__proto__', 'toString', undefined, null,
    'Maximinus I', 'Julian II', 'Faustina Junior', 'Faustina II', 'Severus', 'Philip I']) {
    assert.deepEqual(ricPeople(unknown), [], String(unknown));
  }
  // Aliases never make a name a volume's section: the volume lists are RIC's own.
  assert.deepEqual(volumesOf('Valerian I'), []);
  assert.deepEqual(volumesOf('Valerian'), ['V']);
});

// A name Nomisma titles a person with is that man's own spelling, and a dealer who writes it means him. Widened to everyone whose Latin label
// carries the word, "Germanicus" reached Nero Claudius Drusus Germanicus and answered thirteen of Drusus's numbers with a Drusus coin, and
// "Licinius" stopped answering at all because Publius Licinius Egnatius Gallienus joined it.
test("a spelling that is a person's own name names him alone and is never widened", () => {
  for (const [spelling, person] of [['Germanicus', 'Germanicus'], ['Licinius', 'Licinius'], ['Valens', 'Valens'], ['Romulus', 'Romulus'],
    ['Maximus', 'Maximus'], ['Gallienus', 'Gallienus'], ['Titus', 'Titus']]) {
    assert.deepEqual(ricPeople(spelling).map(({ name }) => name), [person], spelling);
    assert.equal(canonicalRicPerson(spelling), person, spelling);
  }
  // The regnal numeral still reads against those names, so "Licinius I" is the Licinius the table holds a "Licinius II" beside, and it answers
  // exactly as the bare name does.
  assert.deepEqual(ricPeople('Licinius I'), ricPeople('Licinius'));
  assert.equal(canonicalRicPerson('Licinius I'), 'Licinius');
  // A spelling nobody is named outright is still every person it stands in, so it is offered and never opened.
  assert.deepEqual(ricPeople('Domitianus').map(({ id }) => id), ['domitian_ii', 'domitius_domitianus']);
  assert.deepEqual(ricPeople('Valerianus').map(({ id }) => id), ['valerian', 'valerian_ii']);
  assert.equal(canonicalRicPerson('Domitianus'), '');
});

// Nomisma titles a mint concept by its modern name and keeps the ancient one beside it, so RIC's Latin section is reachable by the name on the map.
test('a RIC mint section is found by the other English name Nomisma gives it, and never as a ruler', () => {
  assert.equal(ricMintSection('Trier'), 'Treveri');
  assert.equal(ricMintSection('  ISTANBUL '), 'Constantinople');
  assert.deepEqual(volumesOf('Trier'), volumesOf('Treveri'));
  assert.deepEqual(ricPeople('Trier'), []);
  // Nomisma gives these no English name but the one RIC files them under, and none is invented: their modern names live only in its French and
  // German labels.
  for (const mint of ['London', 'Lyon', 'Lyons', 'Arles', 'Milan', 'Pavia']) {
    assert.equal(ricMintSection(mint), '', mint);
    assert.deepEqual(volumesOf(mint), [], mint);
  }
});
