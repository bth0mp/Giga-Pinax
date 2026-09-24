// Real acsearch results pages, saved from a signed-in session and scrubbed with scripts/scrub_acsearch.py (see fixtures/acsearch-real/README.md).
// Every other acsearch fixture is written by hand; these are the only check that the parser reads the page acsearch really serves. No page comes
// with the repository, so this skips until one is dropped in; it asserts only what must hold of any page, so none needs expectations written for it.
// GIGA_PINAX_ACSEARCH_REAL points it at another folder, to try a scrubbed page before committing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENCIES } from '../extension/core/money.js';
import { citesReference, extractLots, gradeMedians, parsePrice, saleDate, summarise } from '../extension/prices.js';

const FOLDER = process.env.GIGA_PINAX_ACSEARCH_REAL || fileURLToPath(new URL('./fixtures/acsearch-real/', import.meta.url));
const pages = existsSync(FOLDER) ? readdirSync(FOLDER).filter((name) => name.toLowerCase().endsWith('.html')).sort() : [];

// The currencies a row's price is counted in: exactly one for a priced row. None is a bare number that every currency's median would take in; two
// would put one sale into two medians.
const accepting = (price) => CURRENCIES.filter((currency) => parsePrice(price, currency) !== null);
const isPriced = (lot) => parsePrice(lot.price) !== null;

test('real acsearch pages', { skip: pages.length ? false : 'no scrubbed page in tests/fixtures/acsearch-real' }, async (t) => {
  for (const name of pages) {
    await t.test(name, () => {
      const lots = extractLots(readFileSync(join(FOLDER, name), 'utf8'));
      assert.ok(Array.isArray(lots), 'the parser finds the results array');

      for (const lot of lots.filter(isPriced)) {
        assert.equal(accepting(lot.price).length, 1, `${lot.id}: the price ${JSON.stringify(lot.price)} names exactly one currency`);
      }
      const counted = CURRENCIES.map((currency) => summarise(lots, currency));
      assert.equal(counted.reduce((sum, summary) => sum + summary.count, 0), lots.filter(isPriced).length, 'each priced row is counted in one currency only');
      CURRENCIES.forEach((currency, index) => {
        for (const sale of counted[index].priced) assert.deepEqual(accepting(sale.price), [currency], `${sale.id}: counted under ${currency} alone`);
        const graded = gradeMedians(lots, currency).reduce((sum, bucket) => sum + bucket.count, 0);
        assert.ok(graded <= counted[index].count, `${currency}: the grade medians rest on no more sales than the median`);
      });

      for (const lot of lots) {
        if (lot.date.trim() || isPriced(lot)) assert.notEqual(saleDate(lot.date), null, `${lot.id}: the date ${JSON.stringify(lot.date)} reads as a day`);
      }

      // The search the page answers, when a NAME.json beside NAME.html gives it as { "reference": { "catalogue": "RIC", ... } }.
      const sidecar = join(FOLDER, name.replace(/\.html$/i, '.json'));
      if (!existsSync(sidecar)) return;
      const { reference } = JSON.parse(readFileSync(sidecar, 'utf8'));
      const cited = lots.filter((lot) => citesReference(lot.description, reference));
      assert.ok(cited.length <= lots.length, 'the citation filter keeps no more rows than the page has');
      CURRENCIES.forEach((currency, index) => {
        assert.ok(summarise(cited, currency).count <= counted[index].count, `${currency}: the citation filter counts no more sales than the page has`);
      });
    });
  }
});
