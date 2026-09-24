// Optional browser checks of the built extension, never part of the required CI path: they need Playwright's Chromium,
// which the repository's own suites do without. Each check is one step of docs/MANUAL-TEST.md that a browser can show
// offline:
//
//   step 18  The filter switches: "Only results citing …" draws as a normal checkbox with its label beside it, in the
//            toolbar popup's width and in the side panel's.
//   step 19  A bare RIC number shows no median: `RIC 237` offers types to choose from, and no price search, median or
//            Get prices appears until one is chosen.
//   step 17  Amounts in a browser set to Arabic (Settings part only): a house premium of 22.5 reads back as `22.50`, in
//            Western digits with a full stop, and Save settings with nothing touched succeeds.
//
// and the popup's frame, which only a real layout shows: its header and tabs stay put through a lot lookup after a list
// of types, the card stays where it is when acsearch answers after it, and Ctrl+K and the skip link reach the Reference box.
//
// The rest of that list needs a signed-in acsearch session, a real auction page, a second browser or a person's eye.
//
// The browser runs with the unpacked dist/brave/ (build it first: python scripts/build.py brave) in a fresh profile. No
// request leaves the machine: every host name fails to resolve, and every request the pages make is answered here -
// an acsearch search from the repository's own fixture page, anything else refused.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// GIGA_PINAX_EXTENSION points the checks at another unpacked build, such as an older release's, to see them fail there.
const EXTENSION = process.env.GIGA_PINAX_EXTENSION || fileURLToPath(new URL('../dist/brave/', import.meta.url));
const FIXTURE = new URL('../tests/fixtures/acsearch-search-nero-306.html', import.meta.url);

// The fixture is a signed-out page, whose hammer prices read "*". Here every lot is given one, so the panel draws a
// median and the filters above it; the lots, descriptions and citations are the fixture's own.
// scale multiplies every price, for a panel drawn with the long amounts a gold coin fetches. A lot dated after today keeps
// its "*", as acsearch lists a lot still to be sold: priced, it would be a future-dated row the panel names apart.
function pricedAcsearchPage(scale = 1) {
  let price = 180;
  const today = new Date().toISOString().slice(0, 10);
  return readFileSync(FIXTURE, 'utf8').replace(/"date": "(\d\d)\.(\d\d)\.(\d{4})", "price": "\*"/g, (whole, day, month, year) => (
    `${year}-${month}-${day}` > today ? whole : `"date": "${day}.${month}.${year}", "price": "${(price += 40) * scale}"`));
}

// A Price 23 page as the re-review's probe wrote it: ten results, eight citing Price 23 (two of them drachms), one Philip II stater that cites
// something else and one tetradrachm without a price - so the counts line carries a filter, the matches and "1 without a price".
function price23Page(scale = 1) {
  const lot = (id, date, price, description) => ({ id, title: `House ${id % 100}, Auction ${id % 7}, Lot ${id % 50}`, description,
    image: 'media/css/images/design/blank.gif', date, price: String(price), last: false });
  const tetradrachm = 'Greek. Kings of Macedon. Alexander III. Tetradrachm (silver, 17.1 g), Amphipolis. Price 23. Very Fine.';
  const drachm = 'Greek. Kings of Macedon. Alexander III. Drachm (silver, 4.2 g), Sardes. Price 23. Very Fine.';
  const lots = [
    lot(90030001, '20.08.2026', 300 * scale, tetradrachm), lot(90030002, '10.05.2026', 280 * scale, tetradrachm),
    lot(90030003, '03.02.2026', 320 * scale, tetradrachm), lot(90030004, '14.11.2025', 290 * scale, drachm),
    lot(90030005, '12.06.2023', 200 * scale, tetradrachm), lot(90030006, '02.03.2023', 210 * scale, tetradrachm),
    lot(90030007, '21.09.2022', 190 * scale, tetradrachm), lot(90030008, '05.01.2022', 220 * scale, drachm),
    lot(90030009, '27.06.2026', 900 * scale, 'Greek. Kings of Macedon. Philip II. Stater (gold, 8.6 g), Pella. Le Rider 12. Extremely Fine.'),
    { ...lot(90030010, '05.06.2026', 0, tetradrachm), price: '*' },
  ];
  return readFileSync(FIXTURE, 'utf8').replace(/initSearchResults = \[[\s\S]*?\];\s*\n/, `initSearchResults = ${JSON.stringify(lots)};\n`);
}

const refused = [];

// acsearchDelay holds the acsearch answer back, as a real search takes a second or two to come in.
// acsearchPage replaces the fixture page with one of the test's own.
async function launch({ locale, acsearchDelay = 0, priceScale = 1, acsearchPage = null } = {}) {
  assert.ok(existsSync(join(EXTENSION, 'manifest.json')), `${EXTENSION} holds no build: run python scripts/build.py brave first`);
  const profile = await mkdtemp(join(tmpdir(), 'giga-pinax-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    locale,
    viewport: { width: 400, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      // Nothing can reach the network even if a request slipped past the routes below.
      '--host-resolver-rules=MAP * ~NOTFOUND',
      ...(locale ? [`--lang=${locale}`] : []),
    ],
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'https://www.acsearch.info' && url.pathname === '/search.html') {
      if (acsearchDelay) await new Promise((resolve) => { setTimeout(resolve, acsearchDelay); });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: acsearchPage ?? pricedAcsearchPage(priceScale) });
    }
    refused.push(url.href);
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  return {
    context,
    url: (path) => `chrome-extension://${id}/${path}`,
    async close() {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function lookUp(page, reference) {
  await page.locator('#quick-reference').fill(reference);
  await page.locator('#quick-reference').press('Enter');
}

test('step 18: the citing filter is a normal checkbox with its label beside it, in the popup and the side panel', async () => {
  const browser = await launch();
  try {
    for (const [path, width] of [['popup.html', 400], ['popup.html?panel=1', 360]]) {
      const page = await browser.context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(browser.url(path));
      await lookUp(page, 'RIC I² Nero 306');
      await page.locator('#citing-row').waitFor({ state: 'visible', timeout: 15000 });
      // The median arrives with the filters; measured once it has, and both boxes in the same frame, so a layout still
      // settling cannot put the two on different lines.
      await page.locator('#median-line').waitFor({ state: 'visible', timeout: 15000 });
      const [box, label] = await page.evaluate(() => ['citing-filter', 'citing-label'].map((id) => {
        const { x, y, width, height } = document.getElementById(id).getBoundingClientRect();
        return { x, y, width, height };
      }));
      const text = await page.locator('#citing-label').textContent();
      assert.match(text, /^Only results citing /, path);
      // A checkbox the size of a checkbox, not a full-width box.
      assert.ok(box.width <= 24 && box.height <= 24, `${path}: checkbox is ${box.width}x${box.height}`);
      // The label beside it on the same line, and whole inside the page.
      assert.ok(label.x >= box.x + box.width, `${path}: label starts at ${label.x}, checkbox ends at ${box.x + box.width}`);
      assert.ok(label.y < box.y + box.height && box.y < label.y + label.height, `${path}: label and checkbox are not on one line`);
      assert.ok(label.x + label.width <= width, `${path}: label runs to ${label.x + label.width} in a ${width}px page`);
      assert.equal(await page.locator('#citing-filter').isChecked(), true, path);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('step 19: a bare RIC number offers types and shows no median until one is chosen', async () => {
  const browser = await launch();
  try {
    const page = await browser.context.newPage();
    await page.goto(browser.url('popup.html'));
    await lookUp(page, 'RIC 237');
    await page.locator('#candidates').waitFor({ state: 'visible', timeout: 15000 });
    assert.ok(await page.locator('#candidate-list li').count() > 1, 'more than one type is offered');
    // Give a price search the time it would take to arrive, then check that none was drawn.
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#research-prices').isVisible(), false, 'the auction research section is hidden');
    assert.equal(await page.locator('#median-line').isVisible(), false, 'no median');
    assert.equal(await page.locator('#prices-button').isVisible(), false, 'no Get prices');
  } finally {
    await browser.close();
  }
});

// Loop 1 (P-02): after a list of types, a pasted lot's answer scrolled the document itself, and the header and tabs went
// off the top for good. Only the panel under them may scroll.
test('the popup keeps its header and tabs in place through a lot lookup after a list of types', async () => {
  const browser = await launch();
  try {
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto(browser.url('popup.html'));
    await lookUp(page, 'RIC 237');
    await page.locator('#candidates').waitFor({ state: 'visible', timeout: 15000 });
    await lookUp(page, 'Philip I, 244-249. Antoninianus, Rome. RIC 27b. 4.23 g.');
    await page.locator('#result').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#median-line').waitFor({ state: 'visible', timeout: 15000 });
    // Past the reveal's last pass (400 ms) and its smooth scroll.
    await page.waitForTimeout(1500);
    const frame = await page.evaluate(() => ({ document: document.scrollingElement.scrollTop,
      header: document.querySelector('.popup-header').getBoundingClientRect().top }));
    assert.deepEqual(frame, { document: 0, header: 0 });
  } finally {
    await browser.close();
  }
});

// Loop 1 (P-01): the card is the answer and comes first; acsearch answering a moment later draws the prices under it
// and moves nothing the collector is reading.
test('prices arriving after the card leave the card where it is', async () => {
  // Fix round: the median's own line and block are held too, the filter row above them included, at every width the popup is drawn at, and with
  // amounts as long as a gold coin's.
  for (const priceScale of [1, 5000]) {
    const browser = await launch({ acsearchDelay: 1500, priceScale });
    try {
      for (const [path, width, height] of [['popup.html', 400, 600], ['popup.html?panel=1', 360, 900], ['popup.html?panel=1', 320, 700]]) {
        const label = `${path} at ${width}, prices ×${priceScale}`;
        const page = await browser.context.newPage();
        await page.setViewportSize({ width, height });
        await page.goto(browser.url(path));
        await lookUp(page, 'RIC I² Nero 306');
        await page.locator('#result').waitFor({ state: 'visible', timeout: 15000 });
        // Past the reveal's last pass (400 ms) and its smooth scroll, but before acsearch answers.
        await page.waitForTimeout(900);
        const frame = () => page.evaluate(() => ({
          result: Math.round(document.getElementById('result').getBoundingClientRect().top),
          median: Math.round(document.getElementById('median-line').getBoundingClientRect().top),
          block: Math.round(document.querySelector('.median-block').getBoundingClientRect().height),
          range: Math.round(document.getElementById('range-block').getBoundingClientRect().top),
        }));
        assert.equal(await page.locator('#prices-panel[data-state="loading"]').count(), 1, `${label}: still loading when measured`);
        assert.equal(await page.locator('#median-line').isVisible(), true, `${label}: the median's place is held while acsearch answers`);
        const before = await frame();
        await page.locator('#prices-panel[data-state="ready"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(900);
        assert.deepEqual(await frame(), before, label);
        assert.ok(before.result >= 0 && before.result < height / 2, `${label}: the card starts at ${before.result}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
});

// Fix round 2: the stat lines under the median wrap rather than lose a count at the side panel's widths, and one wrap moves
// nothing, since the block holds a second line's room under 400 px. Two wraps (CHF millions at 320) may move only what is
// under the block.
test('the stat lines keep every count at 360 and 320, and one wrap moves nothing', async () => {
  for (const [scale, currency, sizes] of [[1, '', [360, 320]], [5000, 'CHF', [320]]]) {
    const browser = await launch({ acsearchDelay: 1500, acsearchPage: price23Page(scale) });
    try {
      for (const width of sizes) {
        const label = `${width} px, ×${scale} ${currency}`;
        const page = await browser.context.newPage();
        await page.setViewportSize({ width, height: 800 });
        await page.goto(browser.url('popup.html?panel=1'));
        if (currency) {
          await page.locator('#refine-summary').click();
          await page.locator('#currency').selectOption(currency);
        }
        await lookUp(page, 'Price 23');
        await page.locator('#prices-panel[data-state="loading"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(900);
        const frame = () => page.evaluate(() => ({
          result: Math.round(document.getElementById('result').getBoundingClientRect().top),
          median: Math.round(document.getElementById('median-line').getBoundingClientRect().top),
          range: Math.round(document.getElementById('range-block').getBoundingClientRect().top),
        }));
        const before = await frame();
        await page.locator('#prices-panel[data-state="ready"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(600);
        const lines = await page.evaluate(() => ['stat-sales', 'stat-counts'].map((id) => {
          const line = document.getElementById(id);
          return { id, text: line.textContent, cut: line.scrollWidth > line.clientWidth, lines: Math.round(line.getBoundingClientRect().height / 17) };
        }));
        for (const line of lines) assert.equal(line.cut, false, `${label}: ${line.id} is cut: ${line.text}`);
        assert.match(lines[1].text, /1 without a price/, label);
        const after = await frame();
        assert.equal(after.result, before.result, label);
        assert.equal(after.median, before.median, label);
        if (lines[0].lines + lines[1].lines <= 3) assert.equal(after.range, before.range, `${label}: ${JSON.stringify(lines)}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
});

// Fix round 2 (re-review Important 2): what Save reference to watchlist says is said under its button, so the Reference box
// stays uncovered and can be clicked straight away.
test('after Save reference to watchlist the Reference box is still the thing under its own centre', async () => {
  const browser = await launch();
  try {
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto(browser.url('popup.html'));
    await lookUp(page, 'Price 23');
    await page.locator('#companion-save-watchlist:not([disabled])').waitFor({ timeout: 15000 });
    await page.locator('#companion-save-watchlist').click();
    await page.locator('#announcement', { hasText: 'Watchlist details are ready to review.' }).waitFor({ state: 'attached', timeout: 15000 });
    await page.bringToFront();
    // The panel scrolled as after a longer answer, so the Reference row is the one stuck under the tabs.
    await page.evaluate(() => document.querySelector('.popup-scroll').scrollTo(0, 300));
    await page.waitForTimeout(300);
    const hit = await page.evaluate(() => {
      const box = document.getElementById('quick-reference').getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.id;
    });
    assert.equal(hit, 'quick-reference');
  } finally {
    await browser.close();
  }
});

// Loop 1 (K-01): Ctrl+K brings the keyboard back to the Reference box from another tab, and the header's first stop is
// the skip link that does the same.
test('Ctrl+K and the skip link take the keyboard to the Reference box', async () => {
  const browser = await launch();
  try {
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto(browser.url('popup.html'));
    await page.locator('#companion-tab-calculator').click();
    await page.keyboard.press('Control+K');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'quick-reference');
    assert.equal(await page.locator('#companion-panel-research').isVisible(), true);
    await page.locator('#companion-tab-watchlist').click();
    // Nothing comes before the skip link: one stop back from the header's first button lands on it.
    await page.locator('#open-panel').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'skip-to-research');
    assert.equal(await page.locator('#skip-to-research').isVisible(), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'quick-reference');
  } finally {
    await browser.close();
  }
});

test('step 17: in Arabic, a house premium reads back as 22.50 and saves again untouched', async () => {
  const browser = await launch({ locale: 'ar-EG' });
  try {
    const page = await browser.context.newPage();
    await page.goto(browser.url('settings.html'));
    // The page really is in Arabic: its own number formatting writes Arabic-Indic digits and the Arabic decimal mark.
    assert.equal(await page.evaluate(() => navigator.language), 'ar-EG');
    assert.equal(await page.evaluate(() => (22.5).toLocaleString()), '٢٢٫٥');
    await page.locator('#add-premium').click();
    const row = page.locator('.premium-row').first();
    await row.locator('.premium-name').fill('Roma');
    await row.locator('.premium-value').fill('22.5');
    await page.locator('#save-settings').click();
    await assert.doesNotReject(page.locator('#settings-status', { hasText: 'Settings saved.' }).waitFor({ timeout: 10000 }));

    await page.reload();
    const saved = page.locator('.premium-row').first().locator('.premium-value');
    await saved.waitFor({ timeout: 10000 });
    assert.equal(await saved.inputValue(), '22.50');
    await page.locator('#settings-status').evaluate((element) => { element.textContent = ''; });
    await page.locator('#save-settings').click();
    await page.locator('#settings-status', { hasText: 'Settings saved.' }).waitFor({ timeout: 10000 });
    assert.equal(await saved.getAttribute('aria-invalid'), null);
  } finally {
    await browser.close();
  }
});

test('the pages asked for no host beyond the providers the extension may reach', () => {
  // Refused requests are expected (a lookup may try an online fallback); this lists them for the log, and fails only if
  // one went anywhere but a host the extension is allowed to reach.
  const allowed = ['https://numismatics.org/', 'https://nomisma.org/', 'https://www.acsearch.info/'];
  for (const href of refused) assert.ok(allowed.some((prefix) => href.startsWith(prefix)), `unexpected request to ${href}`);
});
