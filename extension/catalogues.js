import { RIC_MINTS, RIC_PEOPLE } from './ric-people.js';
import { squash } from './core/validate.js';

// Everything that differs between the six catalogues the Reference box offers: the corpus each is looked up in and the
// name it goes by, how its key is spelled wherever a reference is read or searched, and what the guided fields say about
// it. Plain data, so the table pulls nothing in behind it. prefixPattern strips a typed key from in front of the number
// ("Cr. 44/5"); referencePattern reads a whole plain reference, which only the catalogues carrying neither a volume nor a
// king have; termKeys are the phrases acsearch is asked for and citationKeys the spellings a dealer's own line may carry.
// RIC and Bop need code as well, and it stays in lookup.js and prices.js and reads its spellings from here.
export const CATALOGUES = Object.freeze({
  Price: Object.freeze({ corpus: 'pella', corpusName: 'PELLA', idPrefix: 'price.', label: 'Price number', help: 'Example: Price 23',
    defaultNumber: '23', notFoundHint: 'Check the number.', queryKey: 'Price', termKeys: ['Price'], citationKeys: ['Price'],
    prefixPattern: /^Price\s*(?=\d|$)/i, referencePattern: /^Price\s*(\d\S*)$/i }),
  RIC: Object.freeze({ corpus: 'ocre', corpusName: 'OCRE', idPrefix: 'ric.', label: 'RIC number (including any suffix)',
    help: 'Example: 306 with Nero. Leave the ruler blank and choose Any volume to list every type with that number.',
    defaultNumber: '306', defaultSection: 'Nero', notFoundHint: 'Check the ruler, volume and number.', citationKeys: ['RIC', 'R.I.C'] }),
  RRC: Object.freeze({ corpus: 'crro', corpusName: 'CRRO', idPrefix: 'rrc-', label: 'Crawford number', help: 'Example: 44/5',
    defaultNumber: '44/5', notFoundHint: 'Check the number.', queryKey: 'RRC', termKeys: ['Crawford', 'Cr.', 'RRC'],
    citationKeys: ['Crawford', 'Crawf', 'Craw', 'Cr', 'RRC'],
    prefixPattern: /^(?:RRC|Craw(?:f|ford)?\.?|Cr\.?)\s*(?=\d|$)/i, referencePattern: /^(?:RRC|Craw(?:f|ford)?\.?|Cr\.?)\s*(\d\S*)$/i }),
  // SCO's own titles ("Seleucid Coins (part 1) 1266.2", as a Recent chip stores them) read as SC too, so a chip fills the fields like the others.
  SC: Object.freeze({ corpus: 'sco', corpusName: 'SCO', idPrefix: 'sc.', label: 'Seleucid Coins number', help: 'Example: 1266.2',
    defaultNumber: '1266.2', notFoundHint: 'Check the number.', queryKey: 'SC', termKeys: ['SC', 'Seleucid Coins'], citationKeys: ['SC', 'Seleucid Coins'],
    prefixPattern: /^(?:SC|Seleucid Coins)\s*(?=\d|$)/i, referencePattern: /^(?:SC|Seleucid Coins(?: \(part \d+\))?)\s*(\d\S*)$/i }),
  Bop: Object.freeze({ corpus: 'bigr', corpusName: 'BIGR', idPrefix: 'bigr.', label: 'Bop number',
    help: 'Example: 24A. Leave the king blank to list every king with that number.', defaultNumber: '24A', defaultSection: 'Euthydemus I',
    notFoundHint: 'Check the king and Bop number.', citationKeys: ['Bopearachchi'], prefixPattern: /^(?:Bopearachchi|Bop\.?)[\s-]*(?=\d|$)/i }),
  // Any other reference has no open type database, so no corpus name and no "not found" hint: its card is its own text.
  Other: Object.freeze({ corpus: 'other', label: 'Reference, as the dealer cites it', defaultNumber: 'BCD Boiotia 174b',
    help: 'Example: BCD Boiotia 174b; HGC 4, 1218. No type data, only acsearch prices.' }),
});
// A row by the catalogue a collector chose, or by the corpus a lookup answered about; null for anything else, so untrusted
// text ("constructor") names no catalogue and nothing that merely reads as a name (["RIC"]) is coerced into one.
export const catalogueOf = (name) => (typeof name === 'string' && Object.hasOwn(CATALOGUES, name) ? CATALOGUES[name] : null);
const BY_CORPUS = new Map(Object.values(CATALOGUES).map((entry) => [entry.corpus, entry]));
export const catalogueForCorpus = (corpus) => BY_CORPUS.get(corpus) ?? null;
// The corpora a Recent chip, or the pop-out's window, may reopen.
export const CORPORA = Object.freeze([...BY_CORPUS.keys()]);

// Static pick-lists for the guided fields, bundled with the extension and never fetched at runtime.
// RIC volumes and sections: the nomisma.org SPARQL endpoint (https://nomisma.org/query) on 2026-09-11, query
//   SELECT ?l WHERE { ?t a nmo:TypeSeriesItem ; skos:prefLabel ?l . FILTER(STRSTARTS(STR(?l), "RIC ")) }
// grouped by volume and section with subtype noise removed ("Salonina (2)" is OCRE's second Salonina series, a section): 12 volumes, 196 sections,
// each list in code-unit order.
// Volume values are the form parseReference produces ("I (2nd edition)"); buildQuery turns them into OCRE's title form ("I (second edition)").
// BIGR kings: the 57 distinct kings in BIGR's type titles ("Bactrian and Indo-Greek Coinage {king} {number}") the same day, minus data typos
// ("Hermaues", "Theohpilus II", "Archebios") and subtype noise ("Eucratides I A.1", "Menander I14A"): 48, in code-unit order, so "Heliocles I" and
// "Heliocles II" precede "Heliocles and Laodice". Both are American Numismatic Society data under the Open Database License (ODbL).

export const RIC_VOLUMES = Object.freeze([
  { value: 'I (2nd edition)', label: 'I² (2nd ed.)' },
  { value: 'II', label: 'II' },
  { value: 'II, Part 1 (2nd edition)', label: 'II.1² (2nd ed.)' },
  { value: 'II, Part 3 (2nd edition)', label: 'II.3² (2nd ed.)' },
  { value: 'III', label: 'III' },
  { value: 'IV', label: 'IV' },
  { value: 'V', label: 'V' },
  { value: 'VI', label: 'VI' },
  { value: 'VII', label: 'VII' },
  { value: 'VIII', label: 'VIII' },
  { value: 'IX', label: 'IX' },
  { value: 'X', label: 'X' },
]);

export const RIC_SECTIONS = Object.freeze({
  'I (2nd edition)': Object.freeze([
    'Augustus', 'Civil Wars', 'Claudius', 'Clodius Macer', 'Gaius/Caligula', 'Galba', 'Nero', 'Otho', 'Tiberius', 'Vitellius',
  ]),
  'II': Object.freeze([
    'Anonymous', 'Hadrian', 'Nerva', 'Trajan',
  ]),
  'II, Part 1 (2nd edition)': Object.freeze([
    'Domitian', 'Titus', 'Vespasian',
  ]),
  'II, Part 3 (2nd edition)': Object.freeze([
    'Hadrian',
  ]),
  'III': Object.freeze([
    'Antoninus Pius', 'Commodus', 'Marcus Aurelius',
  ]),
  'IV': Object.freeze([
    'Aemilian', 'Balbinus', 'Caecilia Paulina', 'Caracalla', 'Clodius Albinus', 'Didius Julianus', 'Elagabalus', 'Geta', 'Gordian I', 'Gordian II',
    'Gordian III', 'Gordian III (Caesar)', 'Jotapianus', 'Macrinus', 'Mar. Silbannacus', 'Maximinus Thrax', 'Maximus', 'Pacatianus', 'Pertinax',
    'Pescennius Niger', 'Philip I', 'Pupienus', 'Septimius Severus', 'Severus Alexander', 'Sponsianus', 'Trajan Decius', 'Trebonianus Gallus',
    'Uranius Antoninus', 'Volusian',
  ]),
  'V': Object.freeze([
    'Allectus', 'Amandus', 'Anonymous', 'Aurelian', 'Aurelian and Severina', 'Aureolus', 'Bonosus', 'Carausius',
    'Carausius issuing for Diocletian/Maximian', 'Carus', 'Claudius Gothicus', 'Diocletian', 'Domitianus of Gaul', 'Dryantilla', 'Florian',
    'Gallienus', 'Gallienus (joint reign)', 'Gallienus and Salonina', 'Gallienus and Salonina (2)', 'Gallienus and Saloninus', 'Laelianus',
    'Macrianus Minor', 'Mariniana', 'Marius', 'Postumus', 'Probus', 'Quietus', 'Quintillus', 'Quintus Julius Gallienus', 'Regalianus',
    'Sabinus Julianus', 'Salonina', 'Salonina (2)', 'Saloninus', 'Saturninus', 'Severina', 'Tacitus', 'Tetricus I', 'Vabalathus', 'Valerian', 'Valerian II', 'Valerian and Gallienus',
    'Valerian, Gallienus, Valerian II, and Salonina', 'Victorinus', 'Zenobia',
  ]),
  'VI': Object.freeze([
    'Alexandria', 'Antioch', 'Aquileia', 'Carthage', 'Cyzicus', 'Heraclea', 'Londinium', 'Lugdunum', 'Nicomedia', 'Ostia', 'Rome', 'Serdica',
    'Siscia', 'Thessalonica', 'Ticinum', 'Treveri',
  ]),
  'VII': Object.freeze([
    'Alexandria', 'Antioch', 'Aquileia', 'Arelate', 'Constantinople', 'Cyzicus', 'Heraclea', 'Londinium', 'Lugdunum', 'Nicomedia', 'Rome', 'Serdica',
    'Sirmium', 'Siscia', 'Thessalonica', 'Ticinum', 'Treveri',
  ]),
  'VIII': Object.freeze([
    'Alexandria', 'Amiens', 'Antioch', 'Aquileia', 'Arelate', 'Constantinople', 'Cyzicus', 'Heraclea', 'Lugdunum', 'Mediolanum', 'Nicomedia', 'Rome',
    'Sirmium', 'Siscia', 'Thessalonica', 'Treveri',
  ]),
  'IX': Object.freeze([
    'Alexandria', 'Antioch', 'Aquileia', 'Arelate', 'Constantinople', 'Cyzicus', 'Heraclea', 'Londinium', 'Lugdunum', 'Mediolanum', 'Nicomedia',
    'Rome', 'Sirmium', 'Siscia', 'Thessalonica', 'Treveri',
  ]),
  'X': Object.freeze([
    'Anthemius', 'Arcadius', 'Avitus', 'Basilicus', 'Basiliscus', 'Basiliscus and Marcus', 'Burgundians or Franks', 'Constantine III', 'Glycereius',
    'Honorius', 'Johannes', 'Jovinus', 'Julius Nepos', 'Leo I (East)', 'Leo I (West)', 'Leo II', 'Leo II and Zeno', 'Leontius', 'Libius Severus',
    'Majorian', 'Marcian', 'Maximus of Barcelona', 'Non-Imperial African', 'Odoacar', 'Olybrius', 'Petronius Maximus', 'Priscus Attalus',
    'Romulus Augustulus', 'Suevi', 'Theodosius II (East)', 'Theodosius II (West)', 'Valentinian III', 'Visigoths', 'Zeno', 'Zeno (East)',
    'Zeno (West)',
  ]),
});

export const BIGR_KINGS = Object.freeze([
  'Agathocles', 'Amyntas', 'Antialcidas', 'Antimachus I', 'Antimachus II', 'Antiochus Nicator', 'Apollodotus I', 'Apollodotus II', 'Apollophanes',
  'Archebius', 'Artemidorus', 'Demetrius I', 'Demetrius II', 'Demetrius III', 'Diodotus I or Diodotus II', 'Diomedes', 'Dionysius', 'Epander',
  'Eucratides I', 'Eucratides II', 'Euthydemus I', 'Euthydemus II', 'Heliocles I', 'Heliocles II', 'Heliocles and Laodice', 'Hermaeus',
  'Hermaeus and Calliope', 'Hippostratus', 'Lysias', 'Lysias and Antialcidas', 'Menander I', 'Menander II', 'Nicias', 'Pantaleon', 'Peucolaus',
  'Philoxenus', 'Plato', 'Polyxenus', 'Strato I', 'Strato I and Agathocleia', 'Strato II', 'Strato II and Strato III', 'Telephus', 'Theophilus I',
  'Theophilus II', 'Thrason', 'Zoilus I', 'Zoilus II',
]);

// Every distinct section across the volumes (the rulers, and the mints of VI–IX), in code-unit order: the Ruler suggestions, and the only rulers
// a reference without a volume may name.
export const RIC_RULERS = Object.freeze([...new Set([...Object.values(RIC_SECTIONS).flat(), ...RIC_PEOPLE.map(({ name }) => name)])].sort());

// A blank volume means any: a RIC number is then listed from every volume (that has the ruler, when one is given).
export const ANY_VOLUME = Object.freeze({ value: '', label: 'Any volume' });
export const VOLUME_OPTIONS = Object.freeze([ANY_VOLUME, ...RIC_VOLUMES]);

// A name as the tables compare it: spacing squashed, case folded and diacritics stripped, the way the importer normalises every Nomisma alias, so
// "Filipo el Árabe" in a heading and "filipo el arabe" in the table are the same name. Almost every name asked for is plain ASCII, which has no
// diacritics to strip and no decomposition to do, and this runs once per bundled title.
export function rulerKey(ruler) {
  const text = squash(ruler).toLowerCase();
  return /^[\x20-\x7e]*$/.test(text) ? text : text.normalize('NFD').replace(/\p{M}+/gu, '');
}

// Every name and alias Nomisma files, indexed once: a lot heading is compared against all of them, and a Map has no inherited keys ("constructor").
// A spelling two people share ("Valerianus" is the Latin name of both Valerians) keeps both: the lookup offers a choice, which is the honest answer.
const PEOPLE_BY_NAME = new Map();
const own = (label, person) => {
  if (!PEOPLE_BY_NAME.has(label)) PEOPLE_BY_NAME.set(label, []);
  if (!PEOPLE_BY_NAME.get(label).includes(person)) PEOPLE_BY_NAME.get(label).push(person);
};
for (const person of RIC_PEOPLE) for (const label of new Set([person.name, ...person.aliases].map(rulerKey))) own(label, person);
// A spelling that IS a person's own name — the English prefLabel Nomisma titles him with — is his and nobody else's, whoever else carries it as an
// alias, and the widening below never touches it: a dealer who writes "Germanicus" means Germanicus, not Nero Claudius Drusus Germanicus, and
// "Licinius" is Licinius, not Publius Licinius Egnatius Gallienus.
const OWN_NAME = new Set();
for (const person of RIC_PEOPLE) {
  const label = rulerKey(person.name);
  PEOPLE_BY_NAME.set(label, OWN_NAME.has(label) ? [...PEOPLE_BY_NAME.get(label), person] : [person]);
  OWN_NAME.add(label);
}

// The one Latinisation the table applies: an English name ending in -ian is regularly Latinised by ending it -us (Domitianus,
// Vespasianus, Numerianus), and Nomisma files that form for some rulers and not for others. Without it a heading Nomisma gives
// to nobody else would be unknown, and worse, one it happens to give to somebody else ("Domitianus" is filed only under
// Domitian II and Domitius Domitianus) opens a stranger's coin as the single answer. Sharing the spelling makes the lookup
// offer a choice, which is the honest answer; a spelling that is already somebody's own name stays his alone.
for (const person of RIC_PEOPLE) {
  const label = rulerKey(person.name);
  if (/^[a-z]+ian$/.test(label) && !OWN_NAME.has(`${label}us`)) own(`${label}us`, person);
}

// The people each spelling names outright, before any is widened below: a numeral is read against these, never against a widened one.
const NAMED_PEOPLE = new Map([...PEOPLE_BY_NAME].map(([label, people]) => [label, [...people]]));

const SECTION_NAMES = new Set(Object.values(RIC_SECTIONS).flat().flatMap((name) => [rulerKey(name), rulerKey(name.split(' (')[0])]));
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelsOf = (person) => [person.name, ...person.aliases].map(rulerKey);
// A bare one-word name NOBODY is called is a nomen or a cognomen rather than one man: "Sextus" is a praenomen two emperors carry, "Valerianus" the
// Latin name of both Valerians. Such a spelling means every person carrying it as a whole word in an English or Latin label, or in a RIC section, so
// it is offered and never resolved to one of them. A one-word name that is somebody's own name, or one RIC heads a section with ("Nero", "Salonina"),
// is settled by that and keeps the person it names.
for (const [label, people] of [...PEOPLE_BY_NAME]) {
  if (label.includes(' ') || OWN_NAME.has(label) || SECTION_NAMES.has(label)) continue;
  const word = new RegExp(String.raw`(?<![\p{L}\d])${escaped(label)}(?![\p{L}\d])`, 'u');
  const sharing = RIC_PEOPLE.filter((person) => !people.includes(person) && labelsOf(person).some((text) => word.test(text)));
  const sections = [...SECTION_NAMES].filter((name) => word.test(name)).flatMap((name) => PEOPLE_BY_NAME.get(name) ?? []);
  for (const person of [...sharing, ...sections]) own(label, person);
}
// A regnal "I" tells two people of the same name apart and says nothing else, so it names the plain one only where the table really holds the
// other: "Licinius I" is Licinius because there is a Licinius II. Nothing more is read into a numeral — "Maximinus I" and "Julian II" stay unknown
// unless a label spells them out.
for (const [label, people] of NAMED_PEOPLE) {
  const second = NAMED_PEOPLE.get(`${label} ii`);
  if (!second || PEOPLE_BY_NAME.has(`${label} i`) || second.some((person) => people.includes(person))) continue;
  PEOPLE_BY_NAME.set(`${label} i`, [...people]);
}
export const ricPeople = (name) => [...(PEOPLE_BY_NAME.get(rulerKey(name)) ?? [])];
// Every spelling the table answers to, with the people each one names: a lot heading reads them straight, so a shared spelling and a derived one
// behave in a heading exactly as they do in a typed field.
export const PEOPLE_SPELLINGS = Object.freeze([...PEOPLE_BY_NAME]
  .map(([label, people]) => Object.freeze([label, Object.freeze(people.map(({ name }) => name))])));

export const isRicPerson = (name) => ricPeople(name).length > 0;
export function canonicalRicPerson(name) {
  const people = ricPeople(name);
  return people.length === 1 ? people[0].name : '';
}

// The volumes whose sections include a ruler, ignoring case and spacing; none for a blank or unknown one. A ruler OCRE splits into sections is also
// known by the name before the parenthesis ("Theodosius II" for "Theodosius II (East)" and "(West)"). Indexed once, in RIC volume order, because
// every one of the 52,254 bundled titles is read through it; a Map has no inherited keys, so "constructor" is unknown too.
const VOLUMES_BY_SECTION = new Map();
for (const { value } of RIC_VOLUMES) {
  for (const section of RIC_SECTIONS[value]) {
    for (const key of new Set([rulerKey(section), rulerKey(section.split(' (')[0])])) {
      if (!VOLUMES_BY_SECTION.has(key)) VOLUMES_BY_SECTION.set(key, []);
      if (!VOLUMES_BY_SECTION.get(key).includes(value)) VOLUMES_BY_SECTION.get(key).push(value);
    }
  }
}
// The RIC section a mint's other English name stands for ("Trier" is RIC's Treveri), from Nomisma's own labels. A mint is a place, so this name
// is only ever read as a section: it never names a ruler.
const MINT_BY_ALIAS = new Map();
for (const { section, aliases } of RIC_MINTS) for (const alias of aliases) MINT_BY_ALIAS.set(rulerKey(alias), section);
export const ricMintSection = (name) => MINT_BY_ALIAS.get(rulerKey(name)) ?? '';
for (const [alias, section] of MINT_BY_ALIAS) {
  if (!VOLUMES_BY_SECTION.has(alias)) VOLUMES_BY_SECTION.set(alias, [...(VOLUMES_BY_SECTION.get(rulerKey(section)) ?? [])]);
}
// Every spelling that names a mint: the sections RIC VI–IX are filed by, and the modern names Nomisma gives them, each with the section it stands
// for. A lot heading is read against these as it is read against the ruler spellings, and a mint stays out of that table: the one-word widening
// above shares a nomen between the people who carry it, which is right for a man and wrong for a place, and a place is never offered as a ruler.
const MINT_SECTIONS = new Map(['VI', 'VII', 'VIII', 'IX'].flatMap((volume) => RIC_SECTIONS[volume]).map((section) => [rulerKey(section), section]));
export const MINT_SPELLINGS = Object.freeze([...MINT_SECTIONS, ...MINT_BY_ALIAS].map((entry) => Object.freeze(entry)));
export const volumesOf = (ruler) => [...(VOLUMES_BY_SECTION.get(rulerKey(ruler)) ?? [])];
// A section that is a mint and nothing else: filed in RIC VI–IX only, and no person's name. It says where a coin was struck, never whose coin it is,
// so a lot citing no volume keeps the ruler its heading names beside it ("Probus. RIC 40 (Ticinum)").
export const isMintOnly = (name) => {
  const volumes = volumesOf(name);
  return volumes.length > 0 && volumes.every((volume) => ['VI', 'VII', 'VIII', 'IX'].includes(volume)) && !isRicPerson(name);
};

// The volume a ruler implies: the current one when it has the ruler (or the ruler is unknown), else the ruler's only volume (Titus: II.1²),
// else Any volume (Hadrian is in II and II.3², Antioch in VI–IX).
export function volumeFor(ruler, current) {
  if (current && ['VI', 'VII', 'VIII', 'IX'].includes(current) && isRicPerson(ruler)) return current;
  const volumes = volumesOf(ruler);
  if (volumes.length === 0 || volumes.includes(current)) return current;
  return volumes.length === 1 ? volumes[0] : ANY_VOLUME.value;
}

export function sectionMismatch(name, volume) {
  if (['VI', 'VII', 'VIII', 'IX'].includes(volume) && isRicPerson(name)) return false;
  const volumes = volumesOf(name);
  return RIC_VOLUMES.some((option) => option.value === volume) && volumes.length > 0 && !volumes.includes(volume);
}

// The options a select shows for a value: the list, plus the value itself, last, when it is not listed, so a parsed "IV, Part 1" or a stored volume
// is shown and used exactly as it came. A blank value adds nothing.
export function selectOptions(entries, value) {
  const wanted = String(value ?? '');
  return wanted && !entries.some((option) => option.value === wanted) ? [...entries, { value: wanted, label: wanted }] : entries;
}
