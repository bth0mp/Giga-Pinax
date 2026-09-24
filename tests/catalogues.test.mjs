import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUES, EXTRA_SPELLINGS, RIC_VOLUMES, RIC_SECTIONS, RIC_RULERS, ANY_VOLUME, VOLUME_OPTIONS, BIGR_KINGS, canonicalRicPerson, catalogueForCorpus, catalogueOf, isRicPerson, ricMintSection, ricPeople, sectionMismatch, volumesOf, volumeFor, selectOptions } from '../extension/catalogues.js';
import { buildQuery, parseReference } from '../extension/lookup.js';
import { RIC_PEOPLE } from '../extension/ric-people.js';

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

// The catalogue a collector chose arrives from stored preferences and from a captured page, so it is whatever JSON held: the accessors read a string
// key of their own table and nothing else, and never coerce a wrapper into one ("['RIC']" is not RIC).
test('catalogueOf and catalogueForCorpus answer for a string key of the table only', () => {
  for (const name of Object.keys(CATALOGUES)) assert.equal(catalogueOf(name), CATALOGUES[name]);
  for (const name of [['RIC'], null, undefined, 23, { toString: () => 'RIC' }, 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'price', '']) {
    assert.equal(catalogueOf(name), null, JSON.stringify(name) ?? String(name));
  }
  for (const corpus of ['pella', 'ocre', 'crro', 'sco', 'bigr', 'other']) assert.equal(catalogueForCorpus(corpus)?.corpus, corpus);
  for (const corpus of [['pella'], null, undefined, 23, { toString: () => 'pella' }, 'constructor', '__proto__', 'toString', 'PELLA', '']) {
    assert.equal(catalogueForCorpus(corpus), null, JSON.stringify(corpus) ?? String(corpus));
  }
  // A lookup for an unknown catalogue is Price's, as it always was: a wrapped name must not reach RIC's row.
  assert.deepEqual(buildQuery({ catalogue: ['RIC'], number: '23' }), { corpus: 'pella', query: 'Price 23' });
  assert.deepEqual(buildQuery({ catalogue: 'constructor', number: '23' }), { corpus: 'pella', query: 'Price 23' });
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
  assert.deepEqual(ricPeople('Domitianus').map(({ id }) => id), ['domitian_ii', 'domitian', 'domitius_domitianus']);
  assert.equal(canonicalRicPerson('Valerianus'), '');
  // A one-word name that stands inside other people's names is every one of them, never one alone: "Sextus" is a praenomen two emperors carry.
  assert.deepEqual(ricPeople('Sextus').map(({ name }) => name), ['Saturninus', 'Martinianus']);
  assert.equal(canonicalRicPerson('Sextus'), '');
  assert.equal(canonicalRicPerson('Nero'), 'Nero');
  assert.equal(canonicalRicPerson('Titus'), 'Titus');
  // A regnal "I" only tells the plain name from a "II" the table also holds.
  assert.equal(canonicalRicPerson('Licinius I'), 'Licinius');
  assert.deepEqual(ricPeople('Valerian I').map(({ id }) => id), ['valerian']);
  // "Maximinus I", "Julian II" and "Faustina II" are the dealers' spellings of people the table holds, and EXTRA_SPELLINGS says so (loop N6, below);
  // "Philip I" is RIC's section name, which no person answers to.
  for (const unknown of ['', '  ', 'hello', 'Tit', 'Leo', 'Theodosius', 'Croesus', 'constructor', '__proto__', 'toString', undefined, null,
    'Severus', 'Philip I', 'Faustina', 'Julianus', 'Maximinus', 'Constantinus']) {
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
  assert.deepEqual(ricPeople('Domitianus').map(({ id }) => id), ['domitian_ii', 'domitian', 'domitius_domitianus']);
  assert.deepEqual(ricPeople('Valerianus').map(({ id }) => id), ['valerian', 'valerian_ii']);
  assert.equal(canonicalRicPerson('Domitianus'), '');
});

// An English -ian name is regularly Latinised -ianus, and Nomisma files that form for some rulers and not for others. Where it files it for
// somebody else and not for him, the heading a dealer writes over his coins opened a stranger's: "Domitianus, 81-96. RIC 1" was answered with a
// coin of Domitianus of Gaul, and five more numbers with Domitius Domitianus's.
test('an English -ian name is also reached by its regular Latin -ianus form, without taking it from anyone', () => {
  // The name Nomisma leaves Latinless joins the two it does file, so the heading offers the three and settles on none.
  assert.deepEqual(ricPeople('Domitianus').map(({ id }) => id), ['domitian_ii', 'domitian', 'domitius_domitianus']);
  assert.equal(canonicalRicPerson('Domitianus'), '');
  // Nobody else carries these, so the Latin form is simply the man.
  for (const [spelling, person] of [['Vespasianus', 'Vespasian'], ['Octavianus', 'Octavian'], ['Majorianus', 'Majorian'],
    ['Nigrinianus', 'Nigrinian']]) {
    assert.equal(canonicalRicPerson(spelling), person, spelling);
  }
  // Every Latin form Nomisma already files answers exactly as it did: the rule adds a spelling, it never moves one.
  assert.equal(canonicalRicPerson('Hadrianus'), 'Hadrian');
  assert.equal(canonicalRicPerson('Aurelianus'), 'Aurelian');
  assert.equal(canonicalRicPerson('Maximianus'), 'Maximian');
  assert.equal(canonicalRicPerson('Diocletianus'), 'Diocletian');
  assert.equal(canonicalRicPerson('Gratianus'), 'Gratian');
  assert.equal(canonicalRicPerson('Numerianus'), 'Numerian');
  assert.deepEqual(ricPeople('Valerianus').map(({ id }) => id), ['valerian', 'valerian_ii']);
  // Only the English -ian names are Latinised, and only by this one ending: nothing is invented for a name shaped otherwise.
  for (const unknown of ['Titusus', 'Neroius', 'Constantinus', 'Trajanianus', 'Titiano']) assert.deepEqual(ricPeople(unknown), [], unknown);
});

// Loop N6: a Künker heading writes "Traianus, 98-117", a Spanish one "Nerón", an Italian one "Traiano", a French one "Hadrien", and none of them
// was read, so "RIC 347" listed thirty-four types from every volume. The -ian rule reaches the Romance endings, a -jan name its Latin ones, and a
// small closed table the rest: every entry is a spelling of one person the table already holds, never a new person.
test('the Latin, German, French, Italian and Spanish spellings of the RIC I–V rulers name the one person each', () => {
  for (const [spelling, person] of [['Traianus', 'Trajan'], ['Trajanus', 'Trajan'], ['Traiano', 'Trajan'], ['Trajano', 'Trajan'],
    ['Adriano', 'Hadrian'], ['Hadrien', 'Hadrian'], ['Vespasiano', 'Vespasian'], ['Vespasien', 'Vespasian'], ['Aureliano', 'Aurelian'],
    ['Aurélien', 'Aurelian'], ['Dioclétien', 'Diocletian'], ['Nerón', 'Nero'], ['Néron', 'Nero'], ['Nerone', 'Nero'],
    ['Philippus I', 'Philip the Arab'], ['Philipp I', 'Philip the Arab'], ['Valerianus I', 'Valerian'], ['Elagabal', 'Elagabalus'],
    ['Heliogabalus', 'Elagabalus'], ['Faustina II', 'Faustina the Younger'], ['Faustina Minor', 'Faustina the Younger'],
    ['Faustina Iunior', 'Faustina the Younger'], ['Faustina Junior', 'Faustina the Younger'], ['Faustina I', 'Faustina the Elder'],
    ['Faustina Maior', 'Faustina the Elder'], ['Faustina Major', 'Faustina the Elder'], ['Constantius I', 'Constantius Chlorus'],
    ['Maximinus I', 'Maximinus Thrax'], ['Maximinus II', 'Maximinus Daia'], ['Julian II', 'Julian the Apostate'], ['Iulianus II', 'Julian the Apostate'],
    ['Jovian', 'Jovianus'], ['Constantine the Great', 'Constantine I'], ['Konstantin I', 'Constantine I'], ['Costantino I', 'Constantine I'],
    ['Constantin Ier', 'Constantine I'], ['Traianus Decius', 'Trajan Decius']]) {
    assert.equal(canonicalRicPerson(spelling), person, spelling);
  }
  // The table names people, not spellings of its own: each entry's person is there, and no entry was already a spelling of anybody, a section's
  // name or a mint's, so none of them takes a name from someone else.
  const byId = new Map(RIC_PEOPLE.map((person) => [person.id, person]));
  const fold = (text) => text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  const labels = new Set(RIC_PEOPLE.flatMap((person) => [person.name, ...person.aliases]).map(fold));
  const sections = new Set(Object.values(RIC_SECTIONS).flat().map((name) => fold(name.split(' (')[0])));
  for (const [spelling, id] of EXTRA_SPELLINGS) {
    assert.ok(byId.has(id), `${spelling}: ${id}`);
    assert.ok(!labels.has(spelling) && !sections.has(spelling) && !ricMintSection(spelling), spelling);
    assert.deepEqual(ricPeople(spelling).map((person) => person.id), [id], spelling);
    assert.deepEqual(volumesOf(spelling), [], spelling);
  }
  // A numeral the spelling does not carry is someone else, as it always was: the second Faustina is not the first, nor Maximinus II the first.
  assert.deepEqual(ricPeople('Faustina III'), []);
  assert.deepEqual(ricPeople('Constantius III').map((person) => person.id), ['constantius_iii']);
  assert.deepEqual(ricPeople('Costantino II'), []);
});

// Nomisma titles a mint concept by its modern name and keeps the ancient one beside it, so RIC's Latin section is reachable by the name on the map.
// The name is taken from three kinds of label — the mint's own country, English, and the exonym several of English, French, German, Italian and
// Spanish share — so a section is reached by the name the mint goes by today wherever Nomisma publishes one.
test('a RIC mint section is found by the modern names Nomisma gives it, and never as a ruler', () => {
  for (const [written, section] of [['Trier', 'Treveri'], ['  ISTANBUL ', 'Constantinople'], ['Arles', 'Arelate'], ['Sisak', 'Siscia'],
    ['Roma', 'Rome'], ['Antakya', 'Antioch'], ['Konstantinopolis', 'Constantinople'], ['Sirmio', 'Sirmium'], ['Marmara Ereğlisi', 'Heraclea']]) {
    assert.equal(ricMintSection(written), section, written);
    assert.deepEqual(volumesOf(written), volumesOf(section), written);
    // A mint is a place: it answers for a section and never for a ruler, whatever the one-word widening does with a ruler's own spellings.
    assert.deepEqual(ricPeople(written), [], written);
  }
});

// Nomisma's mint concepts carry skos:closeMatch links to the same place in Wikidata, and Wikidata's labels and aliases go through the same three
// rules. Bulgaria's capital is the clearest gain: Nomisma writes "Sofia" in Cyrillic alone, which is no script a ticket is typed in, and Wikidata
// writes it in English and in every exonym language.
test('a RIC mint section is found by the names Wikidata adds through Nomisma\'s own closeMatch links', () => {
  for (const [written, section] of [['Sofia', 'Serdica'], ['Sredets', 'Serdica'], ['Carthago', 'Carthage'], ['Ostia Antica', 'Ostia'],
    ['Roman London', 'Londinium'], ['Triers', 'Treveri'], ['Augusta Treverorum', 'Treveri'], ['Nikomedya', 'Nicomedia'],
    ['Antioch on the Orontes', 'Antioch'], ['Lugudunum', 'Lugdunum'], ['Samarobriva', 'Amiens']]) {
    assert.equal(ricMintSection(written), section, written);
    assert.deepEqual(volumesOf(written), volumesOf(section), written);
    assert.deepEqual(ricPeople(written), [], written);
  }
  // Wikidata lists a city's nicknames beside its names, and a heading naming no ruler is read for the earliest mint spelling in it — so a Trier
  // coin described in prose about the Eternal City would have been filed under Rome. A nickname is not a name and none of them is in the table.
  for (const nickname of ['Eternal City', 'The Eternal City', 'Caput Mundi', 'Città Eterna', 'Urbe', 'RM', 'City of Seven Hills',
    'Pearl of the Mediterranean', 'The City of the World\'s Desire', 'Longpré-lès-Amiens', 'History of Pavia']) {
    assert.equal(ricMintSection(nickname), '', nickname);
  }
});

// The Wikidata items Nomisma links Londinium, Lugdunum, Mediolanum and Ticinum to are the Roman city — Q927198, Q665, Q729978, Q28215083 — and every
// language kept titles those by the Latin name, so the town standing there now is in no label of them. Each of those items does publish a statement
// naming that town, and the importer follows one: the first of P1366 (replaced by), P276 (location) and P131 (located in the administrative
// territorial entity) the item carries, and only when what it reaches is a populated place. That is where these names come from and nowhere else.
test('a RIC mint section is found by the modern town the linked Wikidata item points at', () => {
  for (const [written, section] of [['London', 'Londinium'], ['LONDON, UK', 'Londinium'], ['Londres', 'Londinium'], ['Lyon', 'Lugdunum'],
    [' lyon ', 'Lugdunum'], ['Milan', 'Mediolanum'], ['Milano', 'Mediolanum'], ['Mailand', 'Mediolanum'], ['Pavia', 'Ticinum'],
    ['İzmit', 'Nicomedia'], ['Erdek', 'Cyzicus'], ['Trier', 'Treveri']]) {
    assert.equal(ricMintSection(written), section, written);
    assert.deepEqual(volumesOf(written), volumesOf(section), written);
    // A mint is a place here too: a town reached by a statement answers for a section and never for a ruler.
    assert.deepEqual(ricPeople(written), [], written);
  }
  // "Lyons" is the one name of the five the mint volumes were asked for that is still unreachable: Wikidata publishes it as a name of Lyon in no
  // language kept, and nothing is invented to answer for it.
  assert.equal(ricMintSection('Lyons'), '');
  assert.deepEqual(volumesOf('Lyons'), []);
  // London's item lists these beside its names, and not one of them may read a mint out of a heading: "Augusta" is an honorific several cities and
  // several empresses carry, "Lon", "Lond" and "LDN" are codes short enough to fall out of ordinary words, and the Smoke is a nickname. Lyon's
  // "capitale des Gaules" is the same kind of thing in the language of its own country.
  for (const refused of ['Augusta', 'Lon', 'Lond.', 'LDN', 'Big Smoke', 'The Big Smoke', 'Capitale des Gaules', 'Greater London']) {
    assert.equal(ricMintSection(refused), '', refused);
  }
  // What the hop reaches is not always a town, and what is not a town names no mint: Carthage's item leads to the Exarchate of Africa, a Byzantine
  // province, and Ostia's to the Lido di Ostia, a frazione and a seaside resort. Both were fetched, and both were refused by their own P31.
  for (const refused of ['Exarchate of Africa', 'Esarcato di Cartagine', 'Lido di Ostia', 'Ostia Lido', 'Ostia Beach']) {
    assert.equal(ricMintSection(refused), '', refused);
  }
});
