// The number index (numbers.json) checked against the bundled catalogue it was built for: every title it keys, and every shape of reference answered
// as a scan of the whole index answers it. A file of its own so node runs the scan beside the rest; skipped where the bundle is not checked out.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalCatalogue, numberKey } from '../extension/local-catalogue.js';
import { parseReference } from '../extension/lookup.js';
import { bundle, bundleJson, bundlePath, lotReference, skip } from './helpers/bundle.mjs';

// numbers.json is written by scripts/import_rdf.py, which reads the number off a title with a regex of its own. That regex is only safe while it
// keys every title exactly where parseReference reads its number, so the two are compared over all 52,254 bundled titles: a title whose entry sat in
// the wrong list, or in none, would hide a coin from every lookup for that number.
// The key is the runtime's own, not a copy of it, so that a change to the way a lookup keys a number is caught here rather than in the field.
test('every bundled title is listed under the number parseReference reads in it', { skip }, () => {
  const { entries } = bundleJson('ocre/index.json');
  const listed = new Map();
  for (const [key, positions] of Object.entries(bundleJson('ocre/numbers.json').numbers)) {
    for (const position of positions) {
      assert.equal(listed.has(position), false, `position ${position} is listed twice`);
      listed.set(position, key);
    }
  }
  let ric = 0;
  entries.forEach(([id, title], position) => {
    const hit = parseReference(title, false);
    const key = hit?.catalogue === 'RIC' ? numberKey(hit.number) : null;
    if (key === null) return;
    ric += 1;
    assert.equal(listed.get(position), key, `${id}: ${title}`);
  });
  assert.equal(ric, 51248);
});

// The same bundle, served a number index that lists every entry under every number: numbered() then hands pickRicEntries the whole index in index
// order, which is the scan the lookup made before numbers.json existed. Whole answers are compared, cards and candidates and all, so a reference
// whose entries the pre-filter narrowed differently cannot come out looking the same.
const scanned = createLocalCatalogue({
  baseUrl: 'moz-extension://test/data/',
  fetchImpl: async (url) => {
    const path = bundlePath(url);
    if (path !== 'ocre/numbers.json') return { ok: true, status: 200, json: async () => bundleJson(path) };
    const everyPosition = bundleJson('ocre/index.json').entries.map((entry, position) => position);
    return { ok: true, status: 200, json: async () => ({ ...bundleJson(path), numbers: new Proxy({}, { get: () => everyPosition }) }) };
  },
});
test('the number index answers every shape of reference exactly as a scan of the whole index does', { skip }, async () => {
  const references = [
    // A plain number, the number the most volumes carry, and a number written with the zeros a dealer sometimes pads it to.
    parseReference('RIC 972'), parseReference('RIC 1'), parseReference('RIC 007'),
    // A heading that is a man's name, and a heading RIC heads a section with.
    lotReference('Vespasian. AR Denarius. RIC 972.'), lotReference('Philip I. AR Antoninianus. Rome. RIC 27b; RSC 9.'),
    // A volume with a ruler section, a volume with a mint section, and a mint under the modern name RIC does not file it under.
    parseReference('RIC II Vespasian 972'), parseReference('RIC VII Londinium 12'),
    { catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' },
    // A letter in either case, alone and under the volume that heads it.
    parseReference('RIC 27b'), parseReference('RIC IV Philip I 27B'),
    // A range OCRE titles a type over, its first number alone, and a range OCRE has no record of.
    parseReference('RIC II.3 Hadrian 1009-1012'), parseReference('RIC II.3 Hadrian 1009'), parseReference('RIC II.3 Hadrian 10-12'),
    // A plain volume numeral over a family whose parts number the same ruler differently.
    parseReference('RIC II Hadrian 720'), parseReference('RIC II Domitian 720'),
    // The one split volume: 264 stands on both sides of the cut, and each side is asked for again by its own id.
    parseReference('RIC V Gallienus 264'),
    { catalogue: 'RIC', volume: 'V', section: 'Gallienus', number: '264', id: 'ric.5.gall(2).264' },
    { catalogue: 'RIC', volume: 'V', section: 'Gallienus', number: '264', id: 'ric.5.gall(2).264.1' },
    // A second-edition volume by id, and an id nothing carries.
    { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306', id: 'ric.1(2).ner.306' },
    { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306', id: 'ric.1(2).nobody.306' },
    // A number past the end of every volume, and one the volume asked for does not reach.
    parseReference('RIC 1000000'), parseReference('RIC VII Londinium 99999'),
    // Answers only the broadened passes find: the same mint in another volume, and a section no volume has.
    parseReference('RIC VIII Londinium 287'), { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Ostia', number: '306' },
    // A heading naming a ruler who is on no coin of that number.
    lotReference('Otho. AR Denarius. RIC II 720.'),
  ];
  assert.equal(references.length, 25);
  for (const reference of references) {
    assert.ok(reference, JSON.stringify(reference));
    assert.deepEqual(await bundle.lookupType(reference), await scanned.lookupType(reference), JSON.stringify(reference));
  }
});
