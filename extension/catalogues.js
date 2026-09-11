// Static pick-lists for the guided fields, bundled with the extension and never fetched at runtime.
// RIC volumes and sections: the nomisma.org SPARQL endpoint (https://nomisma.org/query) on 2026-09-11, query
//   SELECT ?l WHERE { ?t a nmo:TypeSeriesItem ; skos:prefLabel ?l . FILTER(STRSTARTS(STR(?l), "RIC ")) }
// grouped by volume and section with subtype noise removed: 12 volumes, 194 sections, each list in code-unit order.
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
    'Gallienus', 'Gallienus (joint reign)', 'Gallienus and Salonina', 'Gallienus and Saloninus', 'Laelianus', 'Macrianus Minor', 'Mariniana',
    'Marius', 'Postumus', 'Probus', 'Quietus', 'Quintillus', 'Quintus Julius Gallienus', 'Regalianus', 'Sabinus Julianus', 'Salonina', 'Saloninus',
    'Saturninus', 'Severina', 'Tacitus', 'Tetricus I', 'Vabalathus', 'Valerian', 'Valerian II', 'Valerian and Gallienus',
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

// The king-less pick-list stays reachable from the guided fields: an empty king lists every king with the typed number.
export const ANY_KING = Object.freeze({ value: '', label: 'Any king (list every king with that number)' });
export const BOP_KINGS = Object.freeze([ANY_KING, ...BIGR_KINGS]);

// The sections of a volume; none for a volume outside the list (a parsed "IV, Part 1") or an inherited key.
export const sectionsOf = (volume) => (Object.hasOwn(RIC_SECTIONS, volume) ? RIC_SECTIONS[volume] : []);

// The options a select shows for a value: the list (strings become { value, label }), plus the value itself, last, when it is not listed,
// so a typed "Euthydemos", a parsed "IV, Part 1" or a stored section is shown and used exactly as it came. A blank value adds nothing.
export function selectOptions(entries, value) {
  const options = entries.map((entry) => (typeof entry === 'string' ? { value: entry, label: entry } : entry));
  const wanted = String(value ?? '');
  return wanted && !options.some((option) => option.value === wanted) ? [...options, { value: wanted, label: wanted }] : options;
}
