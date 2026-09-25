import { peopleOn, portraitsOn, bundleJson } from '../helpers/bundle.mjs';
for (const id of ['ric.1(2).aug.252', 'ric.7.sis.42']) console.log(id, peopleOn(id), portraitsOn(id));
const meta = bundleJson('ocre/metadata.json'); const recs = {};
for (const parts of Object.values(meta.shards)) for (const { file } of parts) Object.assign(recs, bundleJson('ocre/' + file).records);
let c = {}; for (const r of Object.values(recs)) for (const p of r.o?.p ?? []) if (p === 'octavian') for (const a of r.a ?? []) c[a] = (c[a] ?? 0) + 1;
console.log('octavian portraits by authority', c);
