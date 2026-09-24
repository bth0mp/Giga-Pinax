// Ptolemaic Coins Online (Lorber's CPE) and Antigonid Coinage Online (Newell's Demetrius Poliorcetes), bundled like CRRO, PELLA and SCO: how a
// reference to either is read, typed or in lot text, what it is looked up as, what the bundle answers, and what acsearch is asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CATALOGUES, catalogueForCorpus, catalogueOf, CORPORA } from '../extension/catalogues.js';
import { createLocalCatalogue, LOCAL_CORPORA } from '../extension/local-catalogue.js';
import { findReferences, lotLabel, lotLookup } from '../extension/lot.js';
import { buildQuery, lookupById, lookupType, nomismaSlugs, parseReference, portraitSlug, toCard } from '../extension/lookup.js';
import { citationPhrases, citesReference, coinArchivesTerm, defaultTerm, referenceName, searchesReference } from '../extension/prices.js';
import { bundle, bundleJson, bundledLabels, bundlePath, skip } from './helpers/bundle.mjs';

const read = (text) => {
  const parsed = parseReference(text);
  return parsed && { catalogue: parsed.catalogue, number: parsed.number };
};

test('a CPE reference is read as Lorber\'s number, a B number as part 2, and the corpus titles read back', () => {
  for (const [text, number] of [['CPE 330', '330'], ['CPE B549', 'B549'], ['CPE I 330', '330'], ['CPE I B549', 'B549'], ['Lorber CPE 330', '330'],
    ['CPE 466A', '466A'], ['CPE 506a', '506a'], ['(CPE 330)', '330'], ['CPE 330.', '330'],
    // PCO's own titles, which a Recent chip and a suggestion carry, read as the same reference.
    ['Coins of the Ptolemaic Empire Vol. I, Part 1, no. 330', '330'], ['Coins of the Ptolemaic Empire Vol. I, Part II, no. B146', 'B146']]) {
    assert.deepEqual(read(text), { catalogue: 'CPE', number }, text);
  }
  // A volume PCO does not publish is no reference to it: prices only, as every CPE citation was before. A title whose part and number disagree is
  // no PCO title at all.
  for (const text of ['CPE II 330', 'CPE III B12']) assert.equal(parseReference(text)?.catalogue, 'Other', text);
  for (const text of ['Coins of the Ptolemaic Empire Vol. I, Part 1, no. B146', 'Coins of the Ptolemaic Empire Vol. I, Part II, no. 146']) {
    assert.notEqual(parseReference(text)?.catalogue, 'CPE', text);
  }
  // Svoronos stays prices only: PCO's Svoronos records are not bundled and nothing looks one up.
  assert.deepEqual(parseReference('Svoronos 552'), { catalogue: 'Other', number: 'Svoronos 552', volume: '', section: '' });
});

test('a Newell reference is read only where it names Demetrius Poliorcetes, as AGCO titles its types', () => {
  for (const [text, number] of [['Newell Demetrius 45', '45'], ['Newell, Demetrius 45', '45'], ['Newell Demetrius Poliorcetes 45', '45'],
    ['Newell Demetrius Poliorcetes, no. 45', '45'], ['Newell, Demetrius Poliorcetes, no. 45', '45']]) {
    assert.deepEqual(read(text), { catalogue: 'Newell', number }, text);
  }
  // Newell wrote other books cited by number (the Seleucid mints, the Alexander hoards): a bare "Newell 45" names none of them over the others.
  assert.equal(parseReference('Newell 45')?.catalogue, 'Other');
  assert.equal(parseReference('Newell Demetrios 45')?.catalogue, 'Other');
});

test('a CPE or Newell reference is looked up by the identifier its number names', () => {
  assert.deepEqual(buildQuery({ catalogue: 'CPE', number: '330', volume: '', section: '' }), { corpus: 'pco', query: 'CPE 330', id: 'cpe.1_1.330' });
  assert.deepEqual(buildQuery({ catalogue: 'CPE', number: 'B549', volume: '', section: '' }), { corpus: 'pco', query: 'CPE B549', id: 'cpe.1_2.B549' });
  // The B is Lorber's part 2 in either case; a letter after the number is its own type and keeps its case (506A and 506a are two coins).
  assert.deepEqual(buildQuery({ catalogue: 'CPE', number: 'b549', volume: '', section: '' }), { corpus: 'pco', query: 'CPE B549', id: 'cpe.1_2.B549' });
  assert.equal(buildQuery({ catalogue: 'CPE', number: '506a', volume: '', section: '' }).id, 'cpe.1_1.506a');
  // A key typed into the number field is the key, not part of the number.
  assert.equal(buildQuery({ catalogue: 'CPE', number: 'CPE B549', volume: '', section: '' }).id, 'cpe.1_2.B549');
  assert.deepEqual(buildQuery({ catalogue: 'Newell', number: '45', volume: '', section: '' }),
    { corpus: 'agco', query: 'Newell Demetrius 45', id: 'newell.demetrius.45' });
  assert.equal(buildQuery({ catalogue: 'Newell', number: 'Newell Demetrius 45', volume: '', section: '' }).id, 'newell.demetrius.45');
  // Both catalogues are rows of the one table, so the popup, a Recent chip and the corpus name all know them.
  assert.equal(catalogueForCorpus('pco'), catalogueOf('CPE'));
  assert.equal(catalogueForCorpus('agco'), catalogueOf('Newell'));
  assert.ok(CORPORA.includes('pco') && CORPORA.includes('agco'));
  assert.deepEqual([LOCAL_CORPORA.pco.label, LOCAL_CORPORA.agco.label], ['PCO', 'AGCO']);
});

test('lot text reads CPE and Newell Demetrius as type references and leaves Svoronos and a bare Newell prices only', () => {
  const lot = findReferences('PTOLEMAIC KINGS. Ptolemy II Philadelphos. AR Decadrachm. Alexandria. CPE 330; Svoronos 460; SNG Copenhagen 132.');
  assert.deepEqual(lot.references.map(({ reference, typed }) => [reference.catalogue, reference.number, typed]),
    [['CPE', '330', true], ['Other', 'Svoronos 460', false], ['Other', 'SNG Copenhagen 132', false]]);
  assert.deepEqual(lotLookup(lot.references[0], lot.rulers), { catalogue: 'CPE', number: '330', volume: '', section: '' });
  assert.equal(lotLabel(lot.references[0], lot.rulers), 'CPE 330');
  // A bronze's B number, and two numbers under one key: the second is another type, as "Price 3949, 3950" is.
  assert.deepEqual(findReferences('Ptolemy IV. AE Hemiobol. Tyre. CPE B549, B550.').references.map(({ reference }) => reference.number), ['B549']);
  const newell = findReferences('MACEDONIAN KINGS. Demetrios I Poliorketes. AR Hemidrachm. Tarsos. Newell, Demetrius 45; SNG Alpha Bank 950.');
  assert.deepEqual(newell.references.map(({ reference, typed }) => [reference.catalogue, reference.number, typed]),
    [['Newell', '45', true], ['Other', 'SNG Alpha Bank 950', false]]);
  assert.deepEqual(findReferences('Demetrios Poliorketes. Tetradrachm. Newell 45.').references.map(({ reference, typed }) => [reference.catalogue, reference.number, typed]),
    [['Other', 'Newell 45', false]]);
  // Neither book reaches a four-digit number, so a year after the key is the book's.
  assert.deepEqual(findReferences('Tetradrachm. Newell Demetrius 1927 lists the dies. SNG Cop 12.').references.map(({ text }) => text), ['SNG Cop 12']);
});

test('acsearch is asked for the citation as dealers write it, and a Demetrius search needs his name in the lot', () => {
  assert.equal(defaultTerm({ catalogue: 'CPE', number: 'B549', volume: '', section: '' }), '"CPE B549"');
  assert.equal(referenceName({ catalogue: 'CPE', number: '330', volume: '', section: '' }), 'CPE 330');
  const newell = { catalogue: 'Newell', number: '45', volume: '', section: '' };
  // "Newell 45" alone is also a number in Newell's other books, so the king must be named, in Latin or in Greek, as a Bop search names its king.
  assert.equal(defaultTerm(newell), '(Demetrius Demetrios) ("Newell 45" "Newell Demetrius 45")');
  assert.deepEqual(citationPhrases(newell), ['Newell 45', 'Newell Demetrius 45']);
  assert.equal(coinArchivesTerm(newell), 'Demetrius "Newell 45"');
  assert.equal(searchesReference(defaultTerm(newell), newell), true);
  // The citation filter counts a lot that cites the type and no other: the number is whole and the key is the book's.
  const cpe = { catalogue: 'CPE', number: 'B549', volume: '', section: '' };
  assert.equal(citesReference('Ptolemy IV. AE. CPE B549; Svoronos 1011.', cpe), true);
  assert.equal(citesReference('Ptolemy IV. AE. Cpe b549.', cpe), false);
  assert.equal(citesReference('Ptolemy IV. AE. CPE B5490.', cpe), false);
  assert.equal(citesReference('Ptolemy IV. AE. Svoronos B549.', cpe), false);
  assert.equal(citesReference('Demetrios Poliorketes. Newell 45.', newell), true);
  assert.equal(citesReference('Demetrios Poliorketes. Newell, Demetrius 45.', newell), true);
  assert.equal(citesReference('Demetrios Poliorketes. Newell 145.', newell), false);
});

// The two JSON-LD fixtures are the RDF export's own records written in the shape numismatics.org serves its JSON-LD in (the shape of
// pella-price-23.jsonld), not fetched: they hold exactly what the bundle was built from, so the two card builders read the same record.
const jsonld = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PARITY = [['pco', 'cpe.1_1.330', 'pco-cpe-1-1-330.jsonld'], ['pco', 'cpe.1_2.B146', 'pco-cpe-1-2-b146.jsonld'],
  ['agco', 'newell.demetrius.45', 'agco-newell-demetrius-45.jsonld']];

test('a local PCO or AGCO card is field for field the card the online path builds from the same record', { skip }, async () => {
  for (const [corpus, id, name] of PARITY) {
    const record = jsonld(name);
    const slugs = [...nomismaSlugs(record), ...(portraitSlug(record) ? [portraitSlug(record)] : [])];
    const packaged = Object.fromEntries(slugs.filter((slug) => Object.hasOwn(bundledLabels(), slug)).map((slug) => [slug, bundledLabels()[slug]]));
    assert.ok(Object.keys(packaged).length >= 3, `${id} has too few bundled labels`);
    const { card } = await bundle.lookupById(corpus, id);
    assert.equal(card.source, 'local');
    assert.deepEqual({ ...card, source: undefined }, { ...toCard(record, corpus, packaged), source: undefined }, id);
  }
  const { card } = await bundle.lookupById('pco', 'cpe.1_1.330');
  assert.deepEqual([card.authority, card.denomination, card.mint, card.material, card.dates],
    ['Ptolemy II Philadelphus', 'Decadrachm', 'Alexandria', 'Silver', '270–246 BC']);
});

test('a bundled CPE or Newell reference is answered without one request off the package', { skip }, async () => {
  const refuse = async (url) => { throw new Error(`no network lookup should happen: ${url}`); };
  for (const [text, id] of [['CPE 330', 'cpe.1_1.330'], ['CPE B549', 'cpe.1_2.B549'], ['CPE 506a', 'cpe.1_1.506a'], ['CPE 506A', 'cpe.1_1.506A'],
    ['Newell Demetrius 45', 'newell.demetrius.45'], ['Coins of the Ptolemaic Empire Vol. I, Part II, no. B146', 'cpe.1_2.B146']]) {
    const found = await lookupType(parseReference(text), { localProvider: bundle, fetchImpl: refuse, online: true });
    assert.equal(found.status, 'ok', text);
    assert.equal(found.card.id, id, text);
    assert.equal(found.card.source, 'local', text);
  }
  // A Recent chip reopens its card from the bundle too.
  assert.equal((await lookupById('agco', 'newell.demetrius.1', { localProvider: bundle, fetchImpl: refuse })).card.id, 'newell.demetrius.1');
});

test('a CPE number the bundle lacks offers the types sharing its number, never one of them as the answer', { skip }, async () => {
  const offered = async (text) => {
    const found = await bundle.lookupType(parseReference(text));
    assert.equal(found.status, 'candidates', text);
    assert.ok(found.candidates.every((entry) => entry.source === 'local'), text);
    return found.candidates.map(({ id }) => id);
  };
  // 466 is a type, and so are 466A and 466B: a lower-case "466a" is none of them, and all three are offered.
  assert.deepEqual(await offered('CPE 466a'), ['cpe.1_1.466', 'cpe.1_1.466A', 'cpe.1_1.466B']);
  assert.deepEqual(await offered('CPE B41c'), ['cpe.1_2.B41', 'cpe.1_2.B41a', 'cpe.1_2.B41b']);
  // A number no type carries, in either part, and a Newell number past the end of the book, are a local miss: the lookup goes online.
  for (const text of ['CPE 99999', 'CPE B99999', 'Newell Demetrius 999']) assert.equal((await bundle.lookupType(parseReference(text))).status, 'none', text);
  // Part 1's 41 is not part 2's B41.
  assert.equal((await bundle.lookupType(parseReference('CPE 41'))).card.id, 'cpe.1_1.41');
});

test('a CPE lookup the bundle cannot answer asks numismatics.org for the one record its number names', async () => {
  const asked = [];
  const record = jsonld('pco-cpe-1-1-330.jsonld');
  const fetchImpl = async (url) => {
    asked.push(String(url));
    const body = String(url).endsWith('/pco/id/cpe.1_1.330.jsonld') ? JSON.stringify(record) : null;
    const json = String(url).includes('nomisma.org') ? '{}' : body;
    return json === null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => json };
  };
  const found = await lookupType(parseReference('CPE 330'), { fetchImpl });
  assert.equal(found.status, 'ok');
  assert.equal(found.card.id, 'cpe.1_1.330');
  assert.equal(found.card.corpus, 'pco');
  assert.equal(asked[0], 'https://numismatics.org/pco/id/cpe.1_1.330.jsonld');
  // A number with no record is a clean miss; PCO is never searched for a Svoronos or any other number in its place.
  asked.length = 0;
  const missing = await lookupType(parseReference('CPE 331x'), { fetchImpl });
  assert.deepEqual([missing.status, missing.corpus, missing.query], ['none', 'pco', 'CPE 331x']);
  assert.deepEqual(asked, ['https://numismatics.org/pco/id/cpe.1_1.331x.jsonld']);
});

test('the PCO and AGCO bundles fail closed like the others', { skip }, async () => {
  for (const [broken, text] of [['pco/metadata.json', 'CPE 330'], ['pco/records-cpe.json', 'CPE 330'], ['agco/records-newell.json', 'Newell Demetrius 45'],
    ['pco/index.json', 'CPE 99999']]) {
    const local = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/',
      fetchImpl: async (url) => (bundlePath(url) === broken ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) }) });
    assert.equal((await local.lookupType(parseReference(text))).status, 'unavailable', broken);
  }
});

// A typed reference fills the Catalogue select with its catalogue, so the select must offer every catalogue the table reads: a value it lacks
// leaves the select blank, and the lookup and its prices would go out without a catalogue. The popup footer names every corpus it draws on.
test('the popup offers every catalogue the table reads, and credits every bundled corpus', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const select = html.match(/<select id="catalogue"[^>]*>(.*?)<\/select>/s)[1];
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]).sort(), Object.keys(CATALOGUES).sort());
  const footer = html.match(/<footer class="popup-footer"><span>([^<]*)<\/span>/)[1];
  for (const { label } of Object.values(LOCAL_CORPORA)) assert.match(footer, new RegExp(`(?<![A-Z])${label}(?![A-Z])`), label);
});
