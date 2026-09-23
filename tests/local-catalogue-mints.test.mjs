// Lot headings naming a mint, swept over the bundled catalogue. A file of its own so node runs its sweep beside the rest; skipped where the bundle
// is not checked out.
import test from 'node:test';
import assert from 'node:assert/strict';

import { findReferences, lotLookup } from '../extension/lot.js';
import { parseReference } from '../extension/lookup.js';
import { bundleJson, lotReference, mintsOn, openedOver, skip } from './helpers/bundle.mjs';

// The reference a heading naming only a mint gives its number: the mint's section, the volume where only one volume has it, and the mark that the
// section came from the heading.
const mintHeading = ({ section, volume }) => (number) => ({ catalogue: 'RIC', number: String(number), volume, section, headingMint: true });

// A mint alias may only ever say which section a number lives in. A heading is ruler-less wherever the people table lacks its spelling, so a section
// read from its mint alone is offered and never opened: over every RIC number from 1 to 400 no spelling opens a coin, and what each offers is coins
// of its own mint and nothing else. A place that opened a stranger's coin as the single answer would be worse than one that opened nothing.
// Each spelling is read into its reference, which is the whole of what the lookup is given, and each section the spellings share is then swept
// once: two spellings of one mint give the same reference for every number, so they get the same answer.
test('over the bundled catalogue, a heading naming only a mint offers that mint\'s coins, no others, and opens none', { skip }, async () => {
  const sections = new Map();
  for (const [heading, concept] of [['Arles', 'arelate'], ['Sisak', 'siscia'], ['Antakya', 'antiocheia_syria'], ['Sirmio', 'sirmium'],
    ['Konstantinopolis', 'constantinople'], ['Marmara Ereğlisi', 'heraclea_thracica'], ['Trier', 'treveri'], ['Istanbul', 'constantinople'],
    ['Londinium', 'londinium'],
    // Every spelling Wikidata added, over the same sweep: a name that opened a stranger's coin would be worse than one that opened nothing.
    ['Sofia', 'serdica'], ['Sredets', 'serdica'], ['Carthago', 'carthage'], ['Ostia Antica', 'ostia'], ['Roman London', 'londinium'],
    ['Triers', 'treveri'], ['Augusta Treverorum', 'treveri'], ['Treviri', 'treveri'], ['Nikomedya', 'nicomedia'], ['Nikomedeia', 'nicomedia'],
    ['Samarobriva', 'ambianum'], ['Amians', 'ambianum'], ['Lugudunum', 'lugdunum'], ['Cizico', 'cyzicus'], ['Kizikos', 'cyzicus'],
    ['Antioch on the Orontes', 'antiocheia_syria'], ['Antiochia', 'antiocheia_syria'], ['Konstantiniyye', 'constantinople'],
    ['Tsarigrad', 'constantinople'], ['Marmaraereğlisi', 'heraclea_thracica'],
    // And every spelling the one statement hop added, over the same sweep. These are the names the mint volumes were asked for, so a wrong single
    // answer here would be the worst kind: each has to open coins of its own mint and of no other.
    ['London', 'londinium'], ['London, UK', 'londinium'], ['Londres', 'londinium'], ['Lunden', 'londinium'], ['Lyon', 'lugdunum'],
    ['City of Lyon', 'lugdunum'], ['Milan', 'mediolanum'], ['Milano', 'mediolanum'], ['Mailand', 'mediolanum'], ['Milan, Italy', 'mediolanum'],
    ['Pavia', 'ticinum'], ['İzmit', 'nicomedia'], ['Ismid', 'nicomedia'], ['Erdek', 'cyzicus'], ['Artake', 'cyzicus']]) {
    const { section, volume } = lotReference(`${heading}. RIC 12`);
    // The spelling reads as its mint's section and nothing else, whatever the number: the first, a middle and the last number of the sweep.
    for (const number of [1, 12, 400]) assert.deepEqual(lotReference(`${heading}. RIC ${number}`), mintHeading({ section, volume })(number), heading);
    // Spellings that share a section share its mint, and so the reference the sweep looks up.
    assert.deepEqual(sections.get(section) ?? { concept, volume }, { concept, volume }, `${heading}: ${section}`);
    sections.set(section, { concept, volume });
  }
  assert.equal(sections.size, 17);
  // Rome is a section of all four mint volumes and of no other, so a number alone never settles which of them is meant: it is offered, never opened.
  const rome = { section: 'Rome', volume: '' };
  for (const number of [1, 12, 400]) assert.deepEqual(lotReference(`Roma. RIC ${number}`), mintHeading(rome)(number));
  assert.deepEqual(await openedOver(mintHeading(rome)), []);
  for (const [section, { concept, volume }] of sections) {
    assert.deepEqual((await openedOver(mintHeading({ section, volume }))).map(({ card }) => card.id), [], section);
    // The section the spelling names is the mint's own: every bundled coin RIC files under it was struck there.
    const filed = bundleJson('ocre/index.json').entries.filter(([, title]) => title.startsWith('RIC V') && title.includes(` ${section} `)
      && parseReference(title, false)?.section === section).slice(0, 25);
    assert.ok(filed.length > 0, section);
    for (const [id] of filed) assert.ok(mintsOn(id).includes(concept), `${section}: ${id}`);
  }
  // The five names the mint volumes were asked for, written the way a lot heading writes them. Four of them now name their Latin section; "Lyons" is
  // in no label Wikidata publishes for Lyon and names none, and nothing was invented to make it.
  for (const [heading, section] of [['London', 'Londinium'], ['Lyon', 'Lugdunum'], ['Milan', 'Mediolanum'], ['Pavia', 'Ticinum'],
    ['Trier', 'Treveri'], ['Lyons', '']]) {
    const lot = findReferences(`${heading}. RIC 12`);
    assert.equal(lotLookup(lot.references[0], lot.rulers).section, section, heading);
  }
  // A heading neither source gives a modern name for names no section, and the row is looked up as it was before. A city's nickname names none
  // either: kept, "the Eternal City" in a Trier lot's prose would have been the earliest mint spelling in it and filed the coin under Rome. The
  // codes and the honorific London's item lists beside its names are refused for the same reason.
  for (const heading of ['Eternal City', 'Caput Mundi', 'Urbe', 'Augusta', 'LDN', 'Big Smoke', 'Capitale des Gaules']) {
    const lot = findReferences(`${heading}. RIC 12`);
    assert.equal(lotLookup(lot.references[0], lot.rulers).section, '', heading);
  }
});
