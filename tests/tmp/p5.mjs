import { bundle, peopleOn, lotReference, answer } from '../helpers/bundle.mjs';
import { RIC_PEOPLE } from '../../extension/ric-people.js';
import { parseReference } from '../../extension/lookup.js';
const n = new Map(RIC_PEOPLE.map((p) => [p.id, p.name]));
for (const t of ['Constantine I. Follis. RIC 117a.', 'Diocletian. Antoninianus. RIC 378.', 'Augustus. Denarius. RIC 235.', 'Nero. As. RIC 306.']) {
  const r = await answer(lotReference(t)); console.log(t, r.status, r.card?.id, (r.candidates ?? []).map((c) => c.id + (c.note ? ' — ' + c.note : '')));
}
const r = await answer(parseReference('RIC VI Londinium 117a')); console.log('typed', r.status, r.card?.id);
console.log(n.get('maximinus_daia'), n.get('constantine_i'), peopleOn('ric.6.lon.117a'));
