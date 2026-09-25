import { headingOpens, peopleOn } from '../helpers/bundle.mjs';
import { bundleJson } from '../helpers/bundle.mjs';
for (const h of ['Germanicus', 'Licinius', 'Licinius I', 'Valerianus', 'Domitianus', 'Valens', 'Romulus', 'Maximus', 'Philip I']) {
  const o = await headingOpens(h); console.log(h, o.length, o.filter(x=>x.number===16).map(x=>x.card.id));
}
