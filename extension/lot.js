import { CORRECTION, EDITION, INVISIBLE, kmNumber, parseReference, readable, realVolumePart, REMARKS, sectionBracket, sgNumber, VARIANT, withRange } from './lookup.js';
import { isMintOnly, isRicPerson, MINT_SPELLINGS, PEOPLE_SPELLINGS, RIC_SECTIONS, rulerKey, volumeFor, volumesOf } from './catalogues.js';

// A whole lot description, pasted or right-clicked: every catalogue reference in it, and the RIC rulers its heading names.
export const MAX_LOT = 3000;
const TYPED = Object.freeze(['RIC', 'RRC', 'SC', 'Price', 'Bop', 'CPE', 'Newell']);

// A run of references starts only at one of these keys. The single letters C (Cohen) and S (Sear) are matched upper case only and kept only in a run
// that also has a longer key, so "c. 386-338 BC" and the legend "S - C" stay text while "C.309 - RIC.112" is two references. Keys inside a bracket are
// skipped ("(= BMC 7)", a sale's "(2005, 1132)"), unless the bracket opens on a key: then each key after a separator in it counts ("(Cohen 17; RIC 972)").
// A key that is an ordinary word or a plain surname counts only with its number straight after it ("Hunter 12", never "Hunter Coin Cabinet").
// One or two short words may stand between a key and its number, but only ones a dealer really writes there. An edition or a volume word is no part of
// the reference and is read past it ("Hendin 6th ed. 1243" is Hendin 1243, "Hunter, vol. III, 45" is Hunter III, 45); a plate, a language or series tag,
// the rest of a corpus title or a co-author belongs to the reference as it was written ("Svoronos pl. 20", "Varbanov (Eng.) 1234", "Senior ISCH 123",
// "Morrisson BnF 5/Cp/AV/12", "Recueil general 123", "Jongeward & Cribb 123", "Lindgren-Kovacs 123"). Any word at all would undo the sale guard
// ("Price realized 1,200"), so both lists are closed.
const DROPPED = String.raw`(?:\d+(?:st|nd|rd|th)|[Ee]ds?|[Vv]ols?|[Pp]arts?|[Pp]t)`;
// An emission tag is part of the reference as a plate is: Bodenstedt numbers Mytilene by emission, so "Bodenstedt Em. 46" and "Bodenstedt 46" are
// different coins in that book.
const KEPT = String.raw`(?:[&-]\s*\p{Lu}\p{L}+|\(?(?:[Pp]ls?|Eng|Engl|ISCH|BnF|Sidon|Em|[Gg][ée]n[ée]rale?)\.?\)?)`;
const INFIX = String.raw`(?:${DROPPED}\.?|${KEPT})`;
// The separator between a key and its number is the house's own, not the catalogue's: a space at CNG, a hyphen glued on at Stephen Album
// ("Pieper-2753", "Hendin-1188"), a hash with spaces round it at the Indian houses ("Emmett # 874"), a dot at the museums ("Paruck.285") and a colon
// at a few ("SNAT-XIVc:336"). None of them is part of the number, and none of them makes a reference on its own.
const SEPARATOR = String.raw`[\s.,:#-]`;
const GAP = String.raw`(?:${SEPARATOR}*${INFIX}){0,2}${SEPARATOR}*`;
// A number may carry one or two short letter tokens glued in front of it ("Diler Ab-123", "Fueg I.A.1"); a word and a space is no number ("Albert II. 2").
const NUMBER = String.raw`(?:\p{Lu}\p{L}?[.-]){0,2}\d`;
// A volume word carries a numeral of its own, as a plate key's does ("Hunter, vol. III, 45"); without one, a word key still needs its digit.
const VOLUME = String.raw`(?:${SEPARATOR}*${DROPPED}\.?){1,2}${SEPARATOR}*[IVXL]+${SEPARATOR}+`;
const word = (key) => String.raw`${key}(?=(?:${GAP}|${VOLUME})${NUMBER})`;
// A plain surname is a key only when its number is the whole reference: what usually follows a scholar's name in lot prose is the year of their book
// ("Butcher 2004 notes 3 obverse dies"), not a catalogue number.
const SURNAMES = new Set();
const surname = (key) => { SURNAMES.add(key.toLowerCase()); return word(key); };
// La Tour is cited by plate volume, so a numeral may stand between the key and the number ("LT XXII 1234").
const plate = (key) => String.raw`${key}(?=${GAP}(?:[IVXL]+${SEPARATOR}+)?${NUMBER})`;
// A surname whose catalogue is cited by volume ("Lindgren III 456", "Varbanov I 1234") is guarded the same way, its numeral part of the number.
const plateName = (key) => { SURNAMES.add(key.toLowerCase()); return plate(key); };
// Two catalogues carry an auction house's name as well; the house's own first name in front of it is never the book. The same lookbehind keeps a
// second author from stealing the first author's reference ("Jongeward & Cribb 123" is Jongeward's, not Cribb's).
const notHouse = (first, key) => String.raw`(?<!${first}\s)${key}`;
// Longest first wherever one key opens another ("BMCRR" before "BMC", "MIBEC" before "MIB", "Sellwood" before "Sell."), and the single letters last.
const KEYS = [
  // Roman: the British Museum's three, the Republic's Crawford line, Sear's Imperators, the Hunter cabinet, the late bronze and the Gallic hoards.
  'BMC/RE', 'BMCRE', 'BMCRR', 'BMC', 'Bopearachchi', String.raw`Bop\.?`, 'Calicó', 'Calico', 'Cohen', String.raw`Coh\.?`, 'Crawford',
  String.raw`Craw\.?`, String.raw`Cr\.?`, 'RIC', String.raw`R\.I\.C\.?`, 'RBW', 'RRCH', 'RRC', 'RSC', 'RPC', 'RCV', 'HCRI', 'CRI', surname('Hunter'), surname('Woytek'), 'LRBC',
  surname('Cunetio'), surname('Elmer'), surname('Normanby'), surname('Mairat'), surname('Bastien'), surname('Giard'), surname('Depeyrot'),
  surname('Estiot'), surname('Szaivert'), surname('Gnecchi'), surname('Babelon'), surname('Bahrfeldt'), surname('Banti'), 'CNR',
  'AGK', surname('Kampmann'), surname('Van Meter'), surname('Vagi'), surname('Foss'), surname('Mazzini'), surname('Biaggi'), surname('Seaby'), 'DCA',
  // Roman provincial and the Levant, then Alexandria.
  surname('Prieur'), surname('McAlee'), plateName('Varbanov'), 'AMNG', plateName('Lindgren'), 'GIC', 'SGI', surname('Moushmov'), 'H&J',
  surname('Bellinger'), surname('Butcher'), surname('Spijkerman'), surname('Rosenberger'), surname('Kadman'), surname('Sofaer'), surname('Ziegler'),
  surname('Klose'), plateName('Recueil'), surname('Emmett'), surname('Milne'), surname('Dattari-Savio'), surname('Dattari'), surname('Geissen'), 'K&G',
  surname('Curtis'), surname('Köln'), surname('Koeln'), surname('Koln'), surname('Christiansen'), surname('Howgego'), surname('Pangerl'),
  // Judaea, then the Greek world, its collections and its hoard inventories.
  surname('Hendin'), surname('Meshorer'), 'TJC', 'AJC', 'GBC', surname('Mildenberg'), 'HN Italy', surname('Vlasto'), surname('Fischer-Bossert'),
  surname('Böhringer'), surname('Boehringer'), surname('Bohringer'), surname('Noe'), surname('Jenkins'), surname('Weber'), surname('Forrer'),
  surname('Pozzi'), surname('Jameson'),
  // Newell's Demetrius Poliorcetes is AGCO's book, and the one Newell a reference names by title: it goes before the bare surname, which stays prices only.
  surname('Gulbenkian'), plateName('Traité'), plateName('Traite'), surname('Thompson'), surname('Troxell'),
  String.raw`Newell(?:,\s*|\s+)Demetrius(?:\s+Poliorcetes)?`, surname('Newell'), surname('Le Rider'),
  'ACGC', surname('Kraay'), surname('Grose'), 'ACIP', 'CNH', surname('Betlyon'), surname('Rouvier'), surname('Klein'), surname('Asyut'), 'IGCH',
  surname('Carradice'), surname('Bodenstedt'), surname('Ashton'), surname('Draganov'), plateName('Von Fritze'), plateName('Karayotov'),
  // Seleucid and Ptolemaic, then the East: Parthia, the Sasanians, Bactria and their collections.
  'WSM', 'CSE', 'CPE', 'SMA', surname('Weiser'), surname('Sellwood'), String.raw`Sell\.?`, surname('Shore'), 'Göbl', 'Goebl', 'Gobl', 'SNS',
  word('Sunrise'), surname('Senior'), surname('Alram'), surname('Nercessian'), surname('Jongeward'), surname('Lorber'), plateName('Schindel'),
  // Cribb is Jongeward's co-author ("Jongeward & Cribb 123", "Jongeward-Cribb 123"); either join must leave the reference whole, as Jongeward's.
  surname('Saeedi'), surname('Paruck'), surname('Vondrovec'), 'MACW', String.raw`(?<![&-]\s*)${surname('Cribb')}`, surname('Rosenfield'),
  // Byzantium and after, then the Celts and the Islamic world.
  'MIBEC', 'MIBE', 'MIB', notHouse('Rodolfo', surname('Ratto')), surname('Sommer'), surname('Füeg'), surname('Fueg'), surname('Morrisson'),
  surname('Grierson'), surname('Hahn'), surname('Tolstoi'), surname('Bendall'), 'MEC', word('COI'), surname('Metlich'), surname('Malloy'),
  surname('Metcalf'), surname('Hobbs'), surname('Scheers'), word('OTA'), surname('Mack'), surname('Dembski'), surname('Kostial'), surname('Sills'),
  'SCBI', plate('LT'), word('DT'), word('ABC'), word('VA'), notHouse('Stephen', surname('Album')), 'SICA', surname('Walker'), surname('Nicol'),
  surname('Bernardi'), surname('Lavoix'), surname('Diler'), 'MIRB', surname('Sabatier'), surname('Wroth'), surname('Van Arsdell'),
  surname('Delestrée'), surname('Delestree'), 'SNAT', surname('Klat'), surname('Balog'), surname('Goodwin'), surname('Artuk'),
  // Prieto y Vives (Los Reyes de Taifas) is a different book from Vives y Escudero, and dealers cite it in full: it must come first so its own number is
  // attributed to it, not folded into a bare "Vives" row.
  surname('Prieto y Vives'), surname('Vives'),
  // World and modern, beside the existing KM.
  surname('Friedberg'), surname('Davenport'), String.raw`Dav\.?`, surname('Bitkin'), 'Y#',
  // The rest of the older keys, the single letters last of all.
  // A sale's "Price realized 1,200" is plain English, never the Alexander corpus.
  'SNG', 'HGC', 'BCD', 'Sear', 'SBCV', 'SB', 'SGCV', 'GCV', 'SG', 'Scholten', 'Seleucid Coins', 'SC', String.raw`Price(?!\s+reali[sz]ed)`, 'Pr', 'Mitchiner', 'MIG',
  'DOC', 'MIR', 'Sydenham',
  String.raw`Syd\.?`, 'Müller', 'Muller', 'KM', 'Kroll', 'Svoronos', 'McClean', 'Benner', 'CBN', 'BN', 'GRPC', 'ESMS', 'ESM', 'C', 'S'];
// Only "Y#" ends in a separator, and Krause glues its number to it ("Y#31a"), so the boundary after a "#" is the "#" itself.
const KEY = new RegExp(String.raw`(?<![\p{L}\d])(?:Ref(?:erences?|s)?\.?\s*:\s*)?(cf\.?\s*)?(${KEYS.join('|')})(?:(?<=#)|(?![\p{L}\d]))`, 'giu');
// Dealers capitalise a catalogue key, so a lower-case word ("hammer price 500", "see doc 12") is never one.
const keyAt = (match) => /^\p{Lu}/u.test(match[2]);
// Where references are separated: ";", ", ", ". ", " - ", "=" or a line break (a comma or dot inside a number, "HGC 12, 72" aside, never splits).
const SEP = /\s*(?:;|,(?=\s)|\.(?=\s)|=|\n)\s*|\s+-\s+/y;
// What follows a key: up to four words ("ANS", "IV.1", "(Antoninus Pius)"), the last token holding a digit, then brackets, "var." or "passim". The
// first token may sit straight after the key, but each later one must cost a space: two adjacent tokens with nothing between them is one token, not
// two, and leaving that ambiguous is what let a long digit-free run (a rule of dots, an underscore run) split four ways in O(n^4) backtracking.
const BODY = /^(?:\s*(?:[^\s()]+|\([^()]*\))){0,1}(?:\s+(?:[^\s()]+|\([^()]*\))){0,3}\s*[^\s()]*\d[^\s()]*(?:\s*\([^()]*\)|\s+(?:var\.?|passim)(?![\p{L}\d]))*/u;
const WORDS = /^(?:\s*[^\s\d()]+){0,3}\s*$/u;
// A weight, size, die axis or date after the references ("3.21g", "8 h", "AD 69-79") is not a number that carries one on.
const MEASURE = /^\d[\d.,]*\s*(?:g|gr|mm|h)$|\b(?:AD|BC|BCE|CE)\b|^(?:circa|ca?\.)\s/i;
const PROVENANCE = /(?:^|[.!?]\s+|\n\s*)((?:Ex|From|Provenance)\b)/;
// A provenance is one sentence, not the rest of the lot: the houses that write it first ("Ex Leu 4, 25 May 1972, lot 123. RIC 972; Cohen 17.") still
// have their references read. It ends at a full stop, a line break or the end of the text, and a lot may carry several.
const withoutProvenance = (text) => {
  let out = text;
  for (let cut = out.match(PROVENANCE); cut; cut = out.match(PROVENANCE)) {
    const start = cut.index + cut[0].length - cut[1].length;
    const rest = out.slice(start);
    // Not at the full stop of an initial or an abbreviation inside it ("Ex Dr. Sear collection, 1975."), whose tail would be left behind as a reference.
    const end = rest.search(/(?<!\b\p{L})(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec))\.(?=\s)|\n|$/u);
    out = out.slice(0, start) + rest.slice(end + 1);
  }
  return out;
};
const unpunctuate = (value) => value.trim().replace(/\s*[.,;:]+$/, '');
// A surname's number is the whole of its reference, and a bare year with prose after it ("Sommer 1994 bei Muenzhandlung Ritter") is a date. A plate
// volume belongs to the number ("Lindgren III 456"), and the remark or variety a dealer hangs on it is dropped before it is read ("Emmett 838 (R2)").
const NUMBER_ONLY = new RegExp(String.raw`^\s*(?:${KEPT}${SEPARATOR}*)?(?:[IVXL]+${SEPARATOR}+)?${NUMBER}[^\s()]*(?:,\s*\d[^\s()]*)*$`, 'u');
const numberOnly = (body) => NUMBER_ONLY.test(unpunctuate(body.replace(REMARKS, '').replace(EDITION, '').replace(VARIANT, '')));
// The house's separator is read as the space it stands for, so what a guard weighs is the number alone: "Klat-2002" is as much a year as "Klat 2002".
// A hyphen carrying a co-author is not a separator but the rest of the name ("Lindgren-Kovacs 123"), so a capital after it keeps it. A comma or a full
// stop followed by a space is never a house's separator, though — SEP treats that same run as the boundary BETWEEN references, and "Agrippina Senior,
// 37-41" or "Newell. 1938" would otherwise read as "Senior, 37-41" or "Newell 1938" the moment the run in front of them is stripped.
const unseparate = (body) => body.replace(/^(?![.,]\s)[\s.:#-]+(?!\p{Lu})/u, ' ');
const YEAR = /^\s*(?:1[5-9]\d\d|20\d\d|2100)$/;
// A bare 1500-2100 number after a key may be the year of a book rather than a type number, and only evidence decides which. First, a typed catalogue
// whose numbers never reach it cannot mean the type: Crawford's Republic ends in the 500s, a Bopearachchi series is one or two digits, Lorber's CPE I
// ends at 965 and B560 and Newell's Demetrius at 182, so a number this big is a year whatever else the line says. Otherwise the clause must say so: a citation cue in front of the year, or a page, plate, note,
// edition, bracketed year or verb of argument behind it. With neither, the reference is kept - Price runs past 3900 and Sear, Hendin, Svoronos and SNG
// Copenhagen all have real numbers in that range, and losing one of those costs the collector more than a stray prices-only row does.
const OVER_RANGE = /^(?:RRC|Craw(?:f|ford)?\.?|Cr\.?|Bopearachchi|Bop\.?|CPE|Newell(?:,\s*|\s+)Demetrius(?:\s+Poliorcetes)?)$/i;
// The cue stands in the reference's own sentence: across a full stop "As." is the Roman denomination, not the cue of "as Price 1991 argues".
const CUE = /\b(?:see|cf|per|following|compare|contra|after|from|published|discussed|cited|dated|attributed)(?:\s+(?:by|in|as))?\s*$/i;
// Only what is said of an author: "reads", "gives", "places" and "attributes" are what a dealer says of the coin, and a reference is no book because
// a sentence about the coin follows it.
const ARGUES = String.raw`notes?|argues|suggests|dates|publishes|lists|discusses|records|catalogues|covers|remains|revised`;
// A plate or volume hung on the number with a comma is part of the citation ("Svoronos 1600, pl. 20"); only a bibliography's spelling, with no comma
// before it, is evidence of a book. A bare pair of numbers joined by a hyphen is left out: a reign or striking date is written that way far more often
// than a page range, and the "p." branch already carries the page.
const CITED = new RegExp(String.raw`^[\s,]*pp?\.|^\s*(?:pl|vol|no|fig|n|ed|ff|op|cit)\.|^\s*\(\d{4}\)|^\s+(?:${ARGUES})\b`);
const publicationYear = (key, body, before, span) => YEAR.test(unpunctuate(body))
  && (OVER_RANGE.test(key) || CUE.test(before) || CITED.test(span.replace(/^\D*\d{4}/, '')));
// A sale is not a catalogue: what follows a house's number is its lot ("Album 46, lot 1234", "Sear 25, lot 12"), never a second catalogue number. Only
// the keys that are houses too are read that way, since a catalogue number followed by a lot number is still the catalogue ("RIC 972, lot 123").
const SALE = new RegExp(String.raw`^${SEPARATOR}*\d[^\s;]*\s*,\s*lot\s+\d`, 'iu');
const HOUSE_KEY = /^(?:Album|Sear|Calic[oó]|Seaby|Ratto)$/i;
// A key that is also a person or a firm is that name, not a catalogue, when a forename's initial ("David R. Sear certificate no. 12345") or a partner
// ("Aureo & Calico 300", "Freeman & Sear 15") stands in front of it. Both are read here rather than inside KEY, whose i flag folds a capital into any
// letter: lower case in front of a key is a die axis or a weight ("17.21 g, 8 h. Sear 2537"), never an initial. The Roman numerals are left out so a
// regnal or volume numeral is no initial ("Philip I. RIC 12", "RPC I. Sear 12"), and only a firm's own keys take the partner rule, so a run of
// catalogues still reads as itself ("Sydenham and Crawford 443/1").
const PERSON_KEY = /^(?:Sear|Calic[oó])$/i;
// A countermark corpus is cited about the punch, not the host coin, so the host's ruler routinely stands AFTER it ("countermarked TIB IM (Howgego
// 123) on an as of Augustus"). It alone must not end the search for that ruler, the way every other row's key does.
const COUNTERMARK = /^(?:Howgego|Pangerl)$/i;
const INITIAL = /(?<!\p{L})[ABEFGHJKNOPQRSTUWYZ]\.\s$/u;
const PARTNER = /\p{L}\p{L}+\s(?:&|and)\s$/u;
const personal = (key, before) => (PERSON_KEY.test(key) && INITIAL.test(before)) || (HOUSE_KEY.test(key) && PARTNER.test(before));
// An edition with no number after it leaves only the ordinal ("Hendin 6th ed." reads "Hendin 6th"), which is no reference.
const ORDINAL_ONLY = /^\D*\d+(?:st|nd|rd|th)\D*$/i;
// A key with only space between it and the key before is part of that reference ("Sear GIC 1234", "SNG Klein 123"), never a second catalogue.
// The key before is the last one kept: one already dropped as a run-on is part of that same reference, so it never suppresses the next key too.
const runOn = (text, matches) => {
  let before = null;
  return matches.filter((match) => {
    const keep = !before || /\S/.test(text.slice(before.index + before[0].length, match.index));
    if (keep) before = match;
    return keep;
  });
};
// The bracket depth before each UTF-16 index, as matchAll counts them, and where the outermost bracket around it opened (-1 outside one).
const depths = (text) => {
  let level = 0, open = -1;
  return text.split('').map((ch, at) => {
    if (ch === ')') level = Math.max(0, level - 1);
    const before = { level, open: level > 0 ? open : -1 };
    if (ch === '(' && level++ === 0) open = at;
    return before;
  });
};

// Invisible characters out, en and em dashes as "-", spaces squashed with the line breaks kept, at most 3,000 characters.
const clean = (text) => Array.from(String(text ?? '').replace(INVISIBLE, '').replace(/[\u2013\u2014]/g, '-').replace(/[^\S\n]+/g, ' ')
  .replace(/ ?\n\s*/g, '\n').trim()).slice(0, MAX_LOT).join('');

// A label matched in any case, letter by letter, because the pattern below carries no "i" flag: with one the regnal numeral in its lookahead would
// fold too, and a lower-case "i", "v" or "x" behind a name ("Gallienus x 3", "Nero i.e.") would read as a numeral and hide the ruler. A letter whose
// other case is not one letter ("ß", whose capital is "SS") is matched as written rather than as a class that would take a bare "S", and a space is
// any run of them. prices.js reads its grade words with this one too.
export const anyCase = (value) => String(value).replace(/\s+/g, ' ').split('').map((character) => {
  if (character === ' ') return String.raw`\s+`;
  const [upper, lower] = [character.toUpperCase(), character.toLowerCase()];
  return upper === lower || upper.length !== 1 || lower.length !== 1
    ? character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : `[${upper}${lower}]`;
}).join('');
// A heading is folded the way the importer folded every alias: its diacritics stripped, so "Filipo el Árabe" is compared as the table holds it.
// Stripping only ever shortens the text, so the names are still found in the order they stand in. Almost every heading is plain ASCII and skips it.
const fold = (text) => (/[^\x20-\x7e\n]/.test(text) ? text.normalize('NFD').replace(/\p{M}+/gu, '') : text);
const NON_PERSON_SECTION =/^(?:Anonymous|Civil Wars|Burgundians or Franks|Non-Imperial African|Suevi|Visigoths)$|\band\b|,| issuing /;
const SECTION_SPELLINGS = Object.freeze({ 'Claudius Gothicus': ['Claudius II', 'Claudius II Gothicus'] });
const sectionPeople = [...new Set(Object.entries(RIC_SECTIONS).filter(([volume]) => !['VI', 'VII', 'VIII', 'IX'].includes(volume))
  .flatMap(([, sections]) => sections.map((section) => section.split(' (')[0])).filter((name) => !NON_PERSON_SECTION.test(name)))];
// Every spelling the people table answers to, then RIC's own section names over the top: a spelling RIC heads a section with is that section's
// ruler and nobody else, since RIC's titles are what the lookup has to match.
const labelGroups = new Map(PEOPLE_SPELLINGS.map(([label, names]) => [label, [...names]]));
const fromSection = new Set();
for (const name of sectionPeople) {
  for (const spelling of [...name.split('/'), ...(SECTION_SPELLINGS[name] ?? [])]) {
    const label = rulerKey(spelling);
    if (!fromSection.has(label)) { labelGroups.set(label, []); fromSection.add(label); }
    if (!labelGroups.get(label).includes(name)) labelGroups.get(label).push(name);
  }
}
const RULERS = Object.freeze([...labelGroups.entries()]
  .map(([label, names]) => [names, label, new RegExp(`(?<!\\p{L})(?:${anyCase(label)})(?!\\p{L})(?!\\s+[IVX]+\\b)`, 'gu'), label.split(' ')[0]])
  .sort((a, b) => b[1].length - a[1].length));
const LABELS = new Set(labelGroups.keys());

// The mints a heading may name, longest spelling first, each with the RIC section it stands for. A spelling the people table already answers to is
// left out: a man's name is his, and the ruler path has always had it. The mints are kept out of LABELS above as well, so what counts as a legend is
// exactly what counted before — a heading that opens "ROMA AETERNA" is read as the coin's words, not as the mint's name.
const MINTS = Object.freeze(MINT_SPELLINGS.filter(([label]) => !LABELS.has(label))
  .map(([label, section]) => Object.freeze([section, new RegExp(`(?<!\\p{L})(?:${anyCase(label)})(?!\\p{L})`, 'u'), label.split(' ')[0]]))
  .sort((a, b) => b[1].source.length - a[1].source.length));
// The mint a heading names, or none: the earliest one in the text, since a heading names the mint once. Read exactly as the rulers are, with the
// same cheap substring test in front of each pattern and the same fold, so a heading written "Trèves" is compared as the table holds it.
function headingMint(text) {
  const rest = fold(text);
  const lower = rest.toLowerCase();
  let best = null;
  for (const [section, pattern, probe] of MINTS) {
    if (!lower.includes(probe)) continue;
    const found = pattern.exec(rest);
    if (found && (!best || found.index < best.index)) best = { index: found.index, section };
  }
  return best?.section ?? '';
}

// The longest names first, each blanked once found, so "Claudius Gothicus" is not also Claudius; several are kept in text order ("Claudius with Nero").
// A regnal numeral the name doesn't carry makes it someone else ("Claudius II" is not Claudius), and titles name no one: "as Caesar", "as Augustus",
// a lower-case "augustus", "Divus", and the Maximus in "Magnus Maximus" (a RIC IX person with no section here).
function rulersIn(text) {
  let rest = fold(text).replace(/\bDiv(?:us|a)\b|\bas\s+(?:Caesar|Augustus)\b/gi, '').replace(/\baugust(?:us|a)\b/g, '');
  // Nomisma knows two thousand spellings, more than any heading can hold: a name whose first word is nowhere in the text cannot match, and that one
  // substring test costs a fraction of running its pattern. Blanking only ever removes text, so the test is safe against the original.
  const lower = rest.toLowerCase();
  const found = [];
  for (const [names, , pattern, probe] of RULERS) {
    if (!lower.includes(probe)) continue;
    rest = rest.replace(pattern, (match, offset) => { for (const name of names) found.push([offset, name]); return ' '.repeat(match.length); });
  }
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, name]) => name))];
}

// Where a lot's heading ends. The rulers are read from it alone: a legend is the coin's own words ("IMP CAES NERVA TRAIAN AVG"), and from the type
// description on the text says what is pictured, not who struck it.
const DESCRIBES = /\b(?:head of|bust of|suckling|standing|seated)\b/i;
// A legend is three unpunctuated capitals in a row. Two are a house's classification or a ruler's own name ("ROMAN IMPERIAL", "SEVERUS ALEXANDER",
// "PLON AE"), and a ruler named in capitals is no legend however many words it takes ("CLAUDIUS II GOTHICUS"), so a run that opens on one of RIC's own
// names is counted from after it. The tokens are walked in JavaScript rather than matched by one pattern, so no run of capitals can make it backtrack.
function legendAt(text) {
  const tokens = [...text.matchAll(/\S+/g)];
  let run = [];
  for (const token of [...tokens, null]) {
    // The mark a dealer ends a legend with is no part of it ("Rev: C L CAESARES, Gaius and Lucius Caesars standing"), so a punctuated capital
    // closes the run it belongs to instead of breaking it. One capital word with a comma after it is still nobody's legend ("TITUS, AD 69-79").
    const capitals = token && /^\p{Lu}+([.,;:]?)$/u.exec(token[0]);
    if (capitals && !capitals[1]) { run.push(token); continue; }
    if (capitals) run.push(token);
    for (let start = 0; start + 3 <= run.length; start += 1) {
      const named = [4, 3, 2, 1].find((words) => start + words <= run.length
        && LABELS.has(run.slice(start, start + words).map((word) => word[0]).join(' ').toLowerCase()));
      if (!named) return run[start].index;
      start += named - 1;
    }
    run = [];
  }
  return -1;
}
// A legend is quoted from the coin, and no dealer quotes one before naming the lot: the headline sentence is the house's own and is routinely set
// in capitals ("ROMAN IMPERIAL COINAGE Trajan AR Denarius", "ROMAN EMPIRE AR DENARIUS NERO"), so a legend is only looked for after it.
const SENTENCE = /[.!?](?=\s)|\n/;
const heading = (text) => {
  const sentence = text.search(SENTENCE);
  const after = sentence < 0 ? text.length : sentence + 1;
  const legend = legendAt(text.slice(after));
  const cuts = [text.search(DESCRIBES), legend >= 0 ? after + legend : -1].filter((at) => at >= 0);
  return cuts.length > 0 ? text.slice(0, Math.min(...cuts)) : text;
};

// Split what follows a key at its top-level separators; a ")" it never opened ends it.
function chunks(span) {
  const parts = [];
  let depth = 0, start = 0, sep = '';
  for (let at = 0; at < span.length; at += 1) {
    const ch = span[at];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    else if (ch === ')') return { parts: [...parts, { sep, text: span.slice(start, at) }], stopped: true };
    else if (depth === 0) {
      SEP.lastIndex = at;
      const found = SEP.exec(span);
      if (found) { parts.push({ sep, text: span.slice(start, at) }); sep = found[0]; start = at + found[0].length; at = start - 1; }
    }
  }
  return { parts: [...parts, { sep, text: span.slice(start) }], stopped: false };
}

// The keys of the catalogues with type data. Their reference is its first chunk: "Price 3949, 3950" cites two types, so 3950 ends Price 3949.
const TYPED_KEY_WORD = /^(?:RIC|R\.I\.C\.?|RRC|Crawford|Craw\.?|Cr\.?|SC|Seleucid Coins|Price|Pr|Bopearachchi|Bop\.?|CPE|Newell(?:,\s*|\s+)Demetrius(?:\s+Poliorcetes)?)$/i;
// A full stop a dealer puts after a typed key ("RIC. 60", "Pr. 3949") is the key's own, as "RSC. 119" has always been read. Only the keys that are no
// English word take it: "Price." is left alone for the reason readable leaves "Price:" alone, and "SC." ends many a legend ("large SC. 12 h").
const DOTTED_KEY = /^(?:RIC|RRC|Pr)$/;
// "Price" and "Pr." are also what a dealer writes before a sale amount, and a number with a currency straight after it ("Pr. 1200 EUR", "Price 1,200 €")
// is that amount, never a type: the key keeps no number, as "Price:" and "Price." keep none. One fixed run, so the test is linear.
const AMOUNT_KEY = /^(?:Price|Pr)$/i;
const AMOUNT = /^[\s.:]*\d+(?:[.,']\d+)*\s*(?:[$€£]|(?:EUR|USD|CHF|GBP)(?!\p{L}))/u;
// RIC spelled with stops is RIC.
const RIC_STOPS = /^R\.I\.C\.?\s*/;

// The reference after one key: its first chunk (read up to its last number), then, for a catalogue without type data, every chunk that starts with a
// number ("HGC 12, 72", "Svoronos pl. 20"). A chunk starting with a word is never part of it: a reference without a key ("Thirion 123", "Woytek 290b",
// "Lot 23312", "Rome 79") ends it but not the run, so a later C or S still counts; other text ("NGC Choice VF 5/5", "Good VF", "AD 69-79") ends the run
// too, which broken says.
const GAP_HEAD = new RegExp(String.raw`^(?:${SEPARATOR}*${DROPPED}\.?){1,2}${SEPARATOR}*(?=(?:[IVXL]+${SEPARATOR}+)?${NUMBER})`, 'u');
// A RIC volume is not the reference's number, however many digits it carries: "RIC II.3, 2345" and "RIC II², 972" are one reference each, the comma
// standing where a space could, while "Price 3949, 3950" is still two. The numeral, an optional part and an optional second-edition mark, and nothing
// else: each group matches one fixed run, so the test is linear.
// A part is only a part when a mark says so ("II.3", "II, 3", "II part 3"); a plain space carries the dealer's number instead, so "RIC II 1, 2" is
// volume II number 1 and the 2 after it is another type.
const VOLUME_ONLY = /^\s*(?:vol\.?\s*)?[IVX]+(?:\s*[./,]\s*(?:part\s*)?\d|\s+part\s*\d)?\s*(?:²|\(2\)|\(2nd ed(?:ition|\.)?\)|2nd ed(?:ition|\.)?|\(second edition\))?\s*$/i;
// A volume and a part written as two chunks ("RIC V, 2, 123"): the number is the chunk after them. The part is real or the row is not a reference,
// by the one table the Reference box reads it by (realVolumePart), so a lot row and the box never disagree about the same words.
const VOLUME_PART = /^\s*(?:vol\.?\s*)?([IVX]+)\s*,\s*(\d)\s*$/i;
function pieceAfter(raw, typed = false) {
  // An allowed word between the key and its number is not part of the reference ("Hendin 6th ed. 1243" is Hendin 1243), so the number is read past it.
  const span = raw.split(/\s+OCRE\b/i)[0].replace(GAP_HEAD, ' ');
  const { parts, stopped } = chunks(span);
  const [first, ...more] = parts;
  const read = first.text.match(BODY)?.[0] ?? (WORDS.test(first.text) ? first.text : '');
  let body = read, ended = typed && !VOLUME_ONLY.test(read), broken = stopped || first.text.slice(read.length).trim() !== '';
  for (const { sep, text } of broken ? [] : more) {
    const piece = unpunctuate(text);
    if (!piece) continue;
    if (!/^(?:\d|\p{Lu}\p{L}*\s+\d)/u.test(piece) || piece.match(BODY)?.[0] !== piece || MEASURE.test(piece)) { broken = true; break; }
    // A typed key takes one number after its volume, and no more: the second is another type. A volume whose part is a chunk of its own waits for
    // one chunk longer, and only for a part that volume really has — otherwise the whole reference is unread rather than half read.
    if (/^\d/.test(piece) && !ended) {
      const joined = `${body}${sep}${piece}`;
      const part = VOLUME_PART.exec(joined);
      if (part && !realVolumePart(part[1], part[2])) return { body: '', broken: true };
      body = joined;
      ended = typed && !part;
    } else ended = true;
  }
  return { body, broken };
}

function normalise(stopped, spelled, cf) {
  const written = stopped.replace(RIC_STOPS, 'RIC ');
  const key = RIC_STOPS.test(spelled) ? 'RIC' : spelled;
  const variant = VARIANT.test(written);
  let text = unpunctuate(written.replace(VARIANT, '').replace(REMARKS, '').replace(EDITION, '').replace(CORRECTION, ''));
  // A Sear Greek reference is SG's spelling, prices only; a "v" on its number ("SG 6829v") is a variety, flagged and shown as "var." is.
  const sg = sgNumber(`${text}${variant ? ' var.' : ''}`);
  if (sg) return { text: text.replace(/(?<=\d)v(?:ar)?$/i, ''), reference: { catalogue: 'Other', number: sg, volume: '', section: '' }, cf, variant: sg.endsWith(' var.'), typed: false };
  // A Krause reference is KM's spelling, prices only. Only the key's own text is read, so the country in a lot's heading ("Netherlands. 2½ Gulden
  // 1898. KM# 123") never joins it: a heading is not part of a reference.
  const km = kmNumber(text);
  if (km) return { text, reference: { catalogue: 'Other', number: km, volume: '', section: '' }, cf, variant, typed: false };
  // A bracket naming a RIC section is that section ("RIC 268 (Elagabalus)"), put before the number; on another catalogue it is a remark.
  const section = sectionBracket(text);
  const ric = /^RIC/i.test(key);
  if (section && !ric) text = unpunctuate(text.replace(section[0], ''));
  // The row's own text has had its remarks, edition, variety and correction taken off already, so the reference is read from it with the shared
  // clean-up switched off: each row is cleaned once, not once here and again inside parseReference.
  const parsed = withRange(parseReference(readable(text), false), () => parseReference(readable(text, false), false));
  // Only a RIC key reads as RIC: "Kroll Titus 5" is never a RIC ruler and number.
  const type = parsed && parsed.catalogue !== 'Other' && (parsed.catalogue !== 'RIC' || ric);
  // A RIC key cites RIC whatever follows it, so its row is a RIC row even where the words are no reference this extension can place ("RIC 1,2" is two
  // of a dealer's numbers under one key, "RIC XI" a volume RIC has not got): the lookup then reports a clean miss. Built as an Other row it was prices
  // only, and its own text went to the sale sites as the phrase to median.
  const unread = ric ? { catalogue: 'RIC', number: text.slice(key.length).replace(/^[\s.:#-]+/, '').trim(), volume: '', section: '' } : null;
  const reference = type ? parsed : unread ?? { catalogue: 'Other', number: text, volume: '', section: '' };
  return { text, reference, cf, variant, typed: TYPED.includes(reference.catalogue) };
}

// Every catalogue reference in a lot description, in text order without duplicates, and the RIC rulers named before the first of them.
export function findReferences(input) {
  const text = withoutProvenance(clean(input));
  const hintPattern = /\bOCRE\s+(ric\.[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?(?:\.[A-Za-z0-9_*()-]+){2,})(?![A-Za-z0-9_*().\/-])/g;
  const hints = [...text.matchAll(hintPattern)].map((match) => match[1]);
  const hint = new Set(hints).size === 1 ? hints[0] : '';
  const depth = depths(text);
  const all = runOn(text, [...text.matchAll(KEY)].filter(keyAt));
  const listed = ({ index }) => {
    const { level, open } = depth[index];
    return level === 0 || (level === 1 && (text[index - 1] === '(' || (all.some((key) => key.index === open + 1) && /(?:[;,.=]\s*|\s-\s+)$/.test(text.slice(open, index)))));
  };
  const keys = all.filter(listed);
  let run = 0;
  const pieces = keys.map((match, index) => {
    const keyStart = match.index + match[0].length - match[2].length;
    const end = keys[index + 1]?.index ?? text.length;
    // A bracket that opens on the next key is that key's: its "(" stays out of this reference ("HGC 9, 12 (SG 6829)" keeps ", 12") and still ends the run.
    const opens = Boolean(keys[index + 1]) && text[end - 1] === '(';
    const after = text.slice(match.index + match[0].length, opens ? end - 1 : end);
    const span = DOTTED_KEY.test(match[2]) ? after.replace(/^\.(?=\s+\d)/, '') : after;
    const { body, broken } = pieceAfter(span, TYPED_KEY_WORD.test(match[2]));
    // A key whose number is neither its own, a book's year nor a sale's number keeps no number, so nothing is listed for it.
    const before = text.slice(0, match.index);
    const number = unseparate(body);
    const own = (!SURNAMES.has(match[2].toLowerCase()) || (numberOnly(number) && !(broken && YEAR.test(number))))
      && !publicationYear(match[2], number, before, span) && !(HOUSE_KEY.test(match[2]) && SALE.test(span)) && !personal(match[2], before) && !(AMOUNT_KEY.test(match[2]) && AMOUNT.test(after));
    const piece = { start: match.index, key: match[2], cf: Boolean(match[1]), run,
      written: `${text.slice(keyStart, match.index + match[0].length)}${own ? body : ''}` };
    if (broken || opens) run += 1;
    return piece;
  });
  const longer = new Set(pieces.filter((piece) => piece.key.length > 1).map((piece) => piece.run));
  const kept = pieces.filter((piece) => /\d/.test(piece.written) && !ORDINAL_ONLY.test(piece.written) && (piece.key.length > 1 || longer.has(piece.run)));
  const seen = new Set();
  const normalised = kept.map((piece) => normalise(piece.written, piece.key, piece.cf));
  if (hint && normalised.filter(({ reference }) => reference.catalogue === 'RIC').length === 1) {
    const found = normalised.find(({ reference }) => reference.catalogue === 'RIC');
    found.reference = { ...found.reference, id: hint };
  }
  const references = normalised.filter(({ reference: { catalogue, volume, section, number } }) => {
    const id = `${catalogue}|${volume}|${section}|${number}`.toLowerCase();
    return !seen.has(id) && seen.add(id);
  });
  const headline = heading(text.slice(0, kept.find((piece) => !COUNTERMARK.test(piece.key))?.start ?? text.length));
  const rulers = rulersIn(headline);
  // The mint travels on the rows rather than in the rulers: it is a place, so nothing may ask OCRE's portrait facet for it, and a heading that names
  // a ruler as well is the ruler's, as it always was ("Magnus Maximus, 383-388. AE2, Lugdunum. RIC 34." still searches for the man).
  const mint = rulers.length === 0 ? headingMint(headline) : '';
  return { references: mint ? references.map((found) => ({ ...found, mint })) : references, rulers };
}

// Lot text rather than one reference: longer than a reference box holds, or naming two catalogues ("RIC 972; Cohen 17").
export function looksLikeLot(input) {
  const text = clean(input).replace(/\s+/g, ' ');
  return Array.from(text).length > 120 || runOn(text, [...text.matchAll(KEY)].filter(keyAt)).filter((match) => match[2].length > 1).length >= 2;
}

// Lot text is long or names two catalogues; a short heading with one reference in it ("Diva Faustina I … RIC III (Antoninus Pius) 394a", "SELEUCID
// KINGDOM. … SC 2069") is one too, since parseReference can't read it whole. Text that starts with a type catalogue's key and still can't be read is a
// typo ("RIC XI Nero 1", "RIC 2 Titus", "Price Q1") and stays an error; a corpus title ("Seleucid", BIGR's) is no key.
const TYPED_KEY = /^(?:(?:RIC|RRC|SC|SCO|Cr)(?![a-z])|Craw|Price|Bop)/i;
export const isLot = (text) => looksLikeLot(text)
  || (!parseReference(text) && !TYPED_KEY.test(String(text ?? '').replace(INVISIBLE, '').trim()) && findReferences(text).references.length > 0);

// A lot row looks up its parsed reference, never the row itself. Only a RIC reference without a ruler of its own borrows the text's rulers (the facet
// search); "(Elagabalus)" in the reference keeps today's path. A mint section is no ruler of its own: beside a mint volume, or with no volume at all
// ("Probus. RIC 40 (Ticinum)"), the heading's ruler still says whose coin it is, where the mint alone opened Constantine's RIC VII Ticinum 40.
const borrowsRulers = ({ reference }, rulers) => reference.catalogue === 'RIC' && rulers.length > 0
  && (!reference.section || ['VI', 'VII', 'VIII', 'IX'].includes(reference.volume) || (!reference.volume && isMintOnly(reference.section)));
// A heading name RIC itself heads a section with, and that no person answers to ("Philip I", "Gaius/Caligula"), is that section rather than a
// portrait: OCRE has no facet value under that name and the local index files the coin under RIC's own section, so asking for the person found
// nothing and left two dozen numbers to choose from. The section brings the volume it implies with it. Only a heading naming one ruler is read so:
// a section standing for one of several is half of what the heading says, and "Aurelian and Severina" opened Severina's own RIC V 2.
const headingSection = (rulers) => (rulers.length === 1 && !isRicPerson(rulers[0]) && volumesOf(rulers[0]).length > 0 ? rulers[0] : '');
// A heading that named a mint and nobody else ("Londinium. RIC 12", "Arles mint") is that mint's section: RIC VI-IX file their coins by mint, so the
// name is where the number lives, and without it a numberless RIC row left every mint of every volume to choose between. The section brings the
// volumes it implies with it, exactly as a ruler section does — but only where the lot has stated no volume of its own, or one the mint really is a
// section of. "Rome mint" stands in most RIC I-V descriptions, and a heading is ruler-less wherever the table does not hold its spelling, so a mint
// that overrode the volume sent "Rome mint. RIC IV 460" to RIC VIII. A mint says where the coin was struck; it never says the lot cited another book.
// Nor does it say whose coin it is: a heading is ruler-less wherever the table lacks its spelling ("Constantius I. Follis. Trier. RIC VI 1"), so the
// row is marked headingMint and the lookup offers what the mint's section holds, never opening it.
const mintSection = (found) => (found.reference.catalogue === 'RIC' && !found.reference.section && found.mint
  && (!found.reference.volume || volumesOf(found.mint).includes(found.reference.volume)) ? found.mint : '');
export function lotLookup(found, rulers) {
  const mint = mintSection(found);
  // The volume the lot stated is one of the mint's own by then, so volumeFor only ever fills a blank one in.
  if (mint) return { ...found.reference, section: mint, volume: found.reference.volume || volumeFor(mint, ''), headingMint: true };
  if (!borrowsRulers(found, rulers)) return found.reference;
  const section = found.reference.section ? '' : headingSection(rulers);
  return section ? { ...found.reference, section, volume: volumeFor(section, found.reference.volume) } : { ...found.reference, rulers };
}
export const lotLabel = (found, rulers) => [found.text, (borrowsRulers(found, rulers) && rulers[0]) || mintSection(found),
  !found.typed && 'prices only', found.cf && 'cf.', found.variant && 'var.'].filter(Boolean).join(' · ');

// Lot text copied in lines (a paste, a right-click) for a one-line box: a break separates as ". " does, so a weight or an "Ex …" line never joins the
// reference above it ("…RIC 1073⏎18 mm"), and a line ending in its own mark keeps it ("HGC 4,⏎1598"). One reference split over lines ("RIC I²⏎Nero
// 306") reads with a space, and breaks at the ends go.
export function oneLine(text) {
  const lines = String(text ?? '').replace(/^\s*[\r\n]\s*|\s*[\r\n]\s*$/g, '');
  const flat = lines.replace(/\s*(?:\r\n|[\r\n])\s*/g, ' ');
  return isLot(flat) ? lines.replace(/([.;,:])?[^\S\r\n]*(?:\r\n|[\r\n])\s*/g, (_, mark) => `${mark ?? '.'} `) : flat;
}
