import { bundleJson } from '../helpers/bundle.mjs';
import { RIC_PEOPLE } from '../../extension/ric-people.js';
import { ricPeople } from '../../extension/catalogues.js';
const meta = bundleJson('ocre/metadata.json');
const recs = {};
for (const parts of Object.values(meta.shards)) for (const { file } of parts) Object.assign(recs, bundleJson('ocre/' + file).records);
const ids = new Set(RIC_PEOPLE.map(p=>p.id));
console.log(ricPeople('Valerianus').map(p=>p.id), ricPeople('Valens').map(p=>p.id), ricPeople('Licinius').map(p=>p.id));
let n=0; for (const [id, r] of Object.entries(recs)) { if ((r.a??[]).includes('valerian') && n++ < 6) console.log(id, r.a, r.o?.p); }
// portrait ids not in people table
const miss = {}; for (const r of Object.values(recs)) for (const p of r.o?.p ?? []) if (!ids.has(p)) miss[p]=(miss[p]??0)+1;
console.log(Object.entries(miss).sort((a,b)=>b[1]-a[1]).slice(0,40));
