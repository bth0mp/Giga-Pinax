import test from 'node:test';
import assert from 'node:assert/strict';
import { RIC_VOLUMES, RIC_SECTIONS, BIGR_KINGS, ANY_KING, BOP_KINGS, sectionsOf, selectOptions } from '../extension/catalogues.js';
import { buildQuery, parseReference } from '../extension/lookup.js';

test('the twelve RIC volumes are in RIC order, and every volume and section round-trips through parseReference and buildQuery', () => {
  assert.deepEqual(RIC_VOLUMES.map((volume) => volume.value), [
    'I (2nd edition)', 'II', 'II, Part 1 (2nd edition)', 'II, Part 3 (2nd edition)', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  ]);
  assert.deepEqual(RIC_VOLUMES.map((volume) => volume.label), ['I² (2nd ed.)', 'II', 'II.1² (2nd ed.)', 'II.3² (2nd ed.)', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
  assert.deepEqual(Object.keys(RIC_SECTIONS), RIC_VOLUMES.map((volume) => volume.value));
  assert.equal(Object.values(RIC_SECTIONS).reduce((count, list) => count + list.length, 0), 194);
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
});

test('sectionsOf lists a volume’s sections and nothing for an unlisted volume or an inherited key', () => {
  assert.equal(sectionsOf('IV').length, 29);
  assert.deepEqual(sectionsOf('IV, Part 1'), []);
  assert.deepEqual(sectionsOf(''), []);
  assert.deepEqual(sectionsOf('constructor'), []);
  assert.deepEqual(sectionsOf('__proto__'), []);
});

test('the 48 BIGR kings are in code-unit order without the data typos, and BOP_KINGS puts "Any king" first', () => {
  assert.equal(BIGR_KINGS.length, 48);
  assert.deepEqual([...BIGR_KINGS], [...BIGR_KINGS].sort());
  assert.equal(new Set(BIGR_KINGS).size, 48);
  assert.ok(Object.isFrozen(BIGR_KINGS) && Object.isFrozen(BOP_KINGS) && Object.isFrozen(ANY_KING));
  for (const king of ['Euthydemus I', 'Hermaeus', 'Diodotus I or Diodotus II', 'Menander I', 'Archebius', 'Theophilus II', 'Zoilus II']) assert.ok(BIGR_KINGS.includes(king), king);
  for (const bad of ['Hermaues', 'Archebios', 'Theohpilus II', 'Menander I14A', 'Menander I14A ', 'Eucratides I A', 'Eucratides I A.1']) assert.ok(!BIGR_KINGS.includes(bad), bad);
  assert.ok(BIGR_KINGS.every((king) => king === king.trim() && !/\d/.test(king)));
  assert.equal(BIGR_KINGS.indexOf('Heliocles and Laodice'), BIGR_KINGS.indexOf('Heliocles II') + 1);
  assert.deepEqual(ANY_KING, { value: '', label: 'Any king (list every king with that number)' });
  assert.equal(BOP_KINGS.length, 49);
  assert.equal(BOP_KINGS[0], ANY_KING);
  assert.deepEqual(BOP_KINGS.slice(1), [...BIGR_KINGS]);
});

test('selectOptions lists the entries and appends an unlisted, non-blank value as its own option', () => {
  const two = ['Nero', 'Otho'];
  assert.deepEqual(selectOptions(two, 'Nero'), [{ value: 'Nero', label: 'Nero' }, { value: 'Otho', label: 'Otho' }]);
  assert.deepEqual(selectOptions(two, 'Euthydemos'), [{ value: 'Nero', label: 'Nero' }, { value: 'Otho', label: 'Otho' }, { value: 'Euthydemos', label: 'Euthydemos' }]);
  assert.deepEqual(selectOptions(two, '<b>x</b>').at(-1), { value: '<b>x</b>', label: '<b>x</b>' });
  assert.equal(selectOptions(two, '').length, 2);
  assert.equal(selectOptions(two, undefined).length, 2);
  assert.equal(selectOptions([], 'x').length, 1);
  assert.deepEqual(selectOptions(RIC_VOLUMES, 'IV, Part 1').at(-1), { value: 'IV, Part 1', label: 'IV, Part 1' });
  assert.equal(selectOptions(RIC_VOLUMES, 'II, Part 1 (2nd edition)').length, 12);
  assert.equal(selectOptions(BOP_KINGS, '').length, 49);
  assert.equal(selectOptions(BOP_KINGS, 'Hermaeus').length, 49);
  assert.equal(selectOptions(BOP_KINGS, 'Hermaios').length, 50);
});
