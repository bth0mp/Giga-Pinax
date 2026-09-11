# Giga Pinax v0.12 Bopearachchi (Bop) via ANS BIGR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Add a **Bop** catalogue (Bopearachchi 1991, *Monnaies gréco-bactriennes et indo-grecques*) resolved through ANS BIGR (Bactrian and Indo-Greek Coinage), with the king as a guided field, one-box and right-click formats, citation-verified matching, a king-less pick-list, the citation on the card, and release 0.12.0. Approved by the user on 2026-09-11.

**Findings (probed 2026-09-11):** BIGR is the same Numishare API as the other corpora (`https://numismatics.org/bigr/apis/search?q=…`, `…/bigr/id/{id}.jsonld`; CORS open; `numismatics.org` already a host permission). BIGR numbers its types itself (`bigr.euthydemus_i.13.1`, title `Bactrian and Indo-Greek Coinage Euthydemus I 13.1`, parent `bigr.euthydemus_i.13`; ids may go deeper, `bigr.hermaeus.14.1.1`, or carry a letter, `bigr.diodotus_i_ii.8A`, whose title ends `Diodotus I or Diodotus II 8A`). The Bopearachchi citation is only in the NUDS XML record `…/bigr/id/{id}.xml`, inside `<refDesc>`: `<reference><tei:title key="http://nomisma.org/id/bopearachchi-1991">Bopearachchi</tei:title><tei:idno>Euthydème I 24A</tei:idno></reference>` (Mitchiner references sit alongside; a few records, e.g. `bigr.diodotus_i_ii.8A`, have no Bopearachchi reference at all). Parents carry the bare series (`Euthydème I 24`), subtypes the lettered one (`Euthydème I 24A`). The plain search is AND over full text including citations: `Euthydemus I 24A` → `euthydemus_i.13.1` + parent `13`; `Euthydemus I 24` → `13` only; `Philoxenus 9C` → 6 hits of which **three** subtypes (6.3, 7.1, 8.1) are all cited `Philoxène 9C`; bare `9C` → 16 hits, 8 of them cited `…9C` across six kings; bare `24A` → 8 hits, 4 cited `…24A`; `Euthydemos 24A` → 0. The JSON-LD record works with `toCard` unchanged: `skos:prefLabel` is the title, `nmo:hasAuthority` `euthydemus_i_bactria` (nomisma label `Euthydemus I of Bactria`), `nmo:hasDenomination` `denomination_d_sco` (`Denomination D (half)`), `nmo:hasMaterial` `ae`, no mint (`nmo:hasRegion` instead), dates `-0230`/`-0190` → `230–190 BC`, reverse legend `ΒΑΣΙΛΕΩΣ ΕΥΘΥΔΗΜΟΥ`. `parseFeed` is regex string parsing that runs in Node; the NUDS XML is parsed the same way.

## Open points for the controller

- The research note "only 6.3 is verified 9C" was wrong: `bigr.philoxenus.6.3`, `7.1` and `8.1` are all cited `Philoxène 9C`. So `Bop Philoxenus 9C` yields a three-item "Did you mean" list, not a card, and every Bop suggestion is labelled `Bopearachchi {citation} ({BIGR title minus the corpus name})`, e.g. `Bopearachchi Philoxène 9C (Philoxenus 6.3)`, so same-citation subtypes stay distinguishable. Bare `9C` lists eight types (six kings). No design change; the label format is the "enough of the BIGR title" the design allowed.
- The King field reuses `ric-section`, so a catalogue change now resets that field to the catalogue's default (`Nero` for RIC, `Euthydemus I` for Bop) the way it already resets the number. Switching Price → RIC therefore shows `Nero` even if the ruler had been edited; before, the edited ruler survived. This is the one visible change to an existing catalogue.
- A BIGR record without a Bopearachchi reference (rare) produces a card with the king but no citation line; choosing it fills catalogue Bop and the king and leaves the Bop number empty, so the acsearch term is `{king} Bopearachchi` and the next guided Look up asks for a number. Fails closed, as designed.

## Global Constraints

- No new permissions, host permissions, dependencies or files beyond the fifteen test fixtures named below (and new test cases). `textContent`/`value`/attributes only — never innerHTML with fetched text. RIC, RRC, SC and Price behaviour unchanged except the section reset above; all existing tests keep passing except the one expectation named below.
- Only numismatics.org and nomisma.org are contacted for lookups: a Bop lookup runs one plain search (two when the king finds nothing), then at most `VERIFY_LIMIT` (24) parallel `.xml` requests to numismatics.org, then the usual record and nomisma requests, all under the lookup's one 15 s timer. acsearch behaviour and request count unchanged: one request per user action, only with access already granted.
- Version `0.12.0` in manifests, package test and docs (digit-bounded stale check `(^|[^0-9.@])0\.11\.0`).
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output. When editing text that contains typographic characters (`’ “ ” ² – ·`), copy them from the file, and never write a literal control character into any file.

---

### Task 1: Bop catalogue, BIGR verification, 0.12.0

**Files:** `extension/lookup.js`, `extension/prices.js`, `extension/preferences.js`, `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `tests/lookup.test.mjs`, `tests/prices.test.mjs`, `tests/preferences.test.mjs`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`, plus fifteen new fixtures.

**Fixtures** (real responses; capture first, from the repo root in Git Bash, and do not edit them):

```bash
cd tests/fixtures
curl -sS -o bigr-search-euthydemus-i-24a.xml "https://numismatics.org/bigr/apis/search?q=Euthydemus%20I%2024A"
curl -sS -o bigr-search-euthydemus-i-24.xml "https://numismatics.org/bigr/apis/search?q=Euthydemus%20I%2024"
curl -sS -o bigr-search-24a.xml "https://numismatics.org/bigr/apis/search?q=24A"
curl -sS -o bigr-search-9c.xml "https://numismatics.org/bigr/apis/search?q=9C"
curl -sS -o bigr-search-philoxenus-9c.xml "https://numismatics.org/bigr/apis/search?q=Philoxenus%209C"
curl -sS -H "Accept: application/ld+json" -o bigr-euthydemus-i-13-1.jsonld "https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.jsonld"
curl -sS -H "Accept: application/ld+json" -o bigr-euthydemus-i-13.jsonld "https://numismatics.org/bigr/id/bigr.euthydemus_i.13.jsonld"
for id in euthydemus_i.13.1 euthydemus_i.13 philoxenus.6.3 philoxenus.7.1 philoxenus.8.1 philoxenus.6 antialcidas.12.2 hermaeus.9.4; do
  curl -sS -o "bigr-$(echo "$id" | tr '_.' '--').xml" "https://numismatics.org/bigr/id/bigr.$id.xml"
done
```

Expect entry counts 2, 1, 8, 16, 6 in the five feeds (`grep -c "<entry>"`), and each `.xml` record to contain `bopearachchi-1991`. The filenames are `bigr-euthydemus-i-13-1.xml`, `bigr-euthydemus-i-13.xml`, `bigr-philoxenus-6-3.xml`, `bigr-philoxenus-7-1.xml`, `bigr-philoxenus-8-1.xml`, `bigr-philoxenus-6.xml`, `bigr-antialcidas-12-2.xml`, `bigr-hermaeus-9-4.xml`.

**Behaviour**

1. `extension/lookup.js` (exact code; keep everything not mentioned as it is)

   - `PREFIX` gains `Bop: /^(?:Bopearachchi|Bop\.?)[\s-]*(?=\d|$)/i` (extend the comment's examples with `"Bop. 24A"`). After `SCO_ID` add:

     ```js
     // Bopearachchi (1991) references resolve through BIGR, whose own numbering ("Euthydemus I 13.1") differs from Bopearachchi's series ("Euthydème I 24A");
     // the series is read from each record's NUDS XML, which is where BIGR keeps the citation.
     const BIGR = 'bigr';
     const BIGR_TITLE = 'Bactrian and Indo-Greek Coinage ';
     const BOP_KEY = 'http://nomisma.org/id/bopearachchi-1991';
     // Hits verified per lookup (each costs one XML request inside the shared deadline); a bare series such as "9C" has 16 hits.
     const VERIFY_LIMIT = 24;
     ```

   - After `referenceNumber` add:

     ```js
     // Bopearachchi series letters are upper case in BIGR's citations ("24A"), so a typed "24a" is normalised before it is searched or compared.
     export const bopSeries = (number) => referenceNumber('Bop', number).toUpperCase();
     ```

   - After `SIMPLE_REFERENCE` (before `RIC_REFERENCE`) add:

     ```js
     // "Bop Euthydemus I 24A", "Bopearachchi 9C", "Bop-9C" (prefix first, king optional) or "Euthydemus I Bop. 24A", "Euthydemus I, Bop 24A" (king first).
     // The king starts with a non-digit and holds no digit; the series is the last token and starts with a digit. "Bop" must end the word, so "Bopearachi 9C" fails.
     const BOP = String.raw`(?:Bopearachchi|Bop\.?)(?![a-z])`;
     const BOP_REFERENCE = new RegExp(String.raw`^(?:${BOP}[\s-]*(?:([^\d\s][^\d]*?)\s+)?|([^\d\s][^\d]*?)\s*,?\s*${BOP}[\s-]*)(\d\S*)$`, 'i');
     ```

   - In `parseReference`, between the `SIMPLE_REFERENCE` loop and `const ric = …`, insert:

     ```js
       const bop = value.match(BOP_REFERENCE);
       if (bop) return { catalogue: 'Bop', number: bop[3], volume: '', section: squash(bop[1] ?? bop[2] ?? '') };
     ```

   - In `buildQuery`, before the final `return { corpus: 'pella', … }`, insert:

     ```js
       if (catalogue === 'Bop') {
         // The section field is the king (English, as BIGR titles it); the query names the reference the way the popup reports a miss.
         const king = unquote(section);
         const series = bopSeries(number);
         return { corpus: BIGR, query: squash(`Bopearachchi ${king} ${series}`), king, series };
       }
     ```

   - After `parseFeed` add:

     ```js
     // ponytail: regex over the NUDS refDesc, like parseFeed. The Bopearachchi idno ("Euthydème I 24A") of the first reference keyed to Bopearachchi 1991,
     // or null when the record has no readable one (Mitchiner-only records exist), which leaves the hit unverified.
     export function bopCitation(xml) {
       for (const [, body] of String(xml).matchAll(/<reference(?:\s[^>]*)?>([\s\S]*?)<\/reference>/g)) {
         if (!body.includes(`key="${BOP_KEY}"`)) continue;
         const idno = squash(body.match(/<tei:idno(?:\s[^>]*)?>([^<]*)<\/tei:idno>/)?.[1]);
         if (idno) return unescape(idno);
       }
       return null;
     }

     // The series is the citation's last token ("Euthydème I 24A" → "24A"; the parent type "Euthydème I 24" → "24").
     export const seriesOf = (citation) => squash(citation).split(' ').pop();

     // BIGR titles minus the corpus name ("Euthydemus I 13.1"), and minus the trailing BIGR number too ("Euthydemus I"; "Diodotus I or Diodotus II 8A" → "Diodotus I or Diodotus II").
     const shortTitle = (title) => {
       const text = squash(title);
       return text.startsWith(BIGR_TITLE) ? text.slice(BIGR_TITLE.length) : text;
     };
     export const kingOf = (title) => squash(shortTitle(title).replace(/\s+\d\S*$/, ''));
     ```

   - After `toCard` add:

     ```js
     // What a BIGR card carries beyond the record: the king as BIGR titles it and the Bopearachchi series, both null-safe when the citation was unreadable.
     export const bopDetails = (title, citation) => ({ king: kingOf(title), series: citation ? seriesOf(citation) : null, citation: citation ?? null });
     ```

   - After `recordUrl` add `const nudsUrl = (corpus, id) => \`${ORIGIN}/${corpus}/id/${encodeURIComponent(id)}.xml\`;`.

   - Before `cardOutcome` add, and replace `cardOutcome` with:

     ```js
     // Fails closed: a missing or unreadable NUDS record is null (unverified). Only the deadline propagates, so a timed-out lookup is still a network error.
     async function fetchCitation(id, fetchImpl, signal) {
       try { return bopCitation(await getText(nudsUrl(BIGR, id), fetchImpl, signal)); }
       catch (error) {
         if (signal?.aborted) throw error;
         return null;
       }
     }

     // The one path from a fetched record to a card, shared by lookupById and the SC direct fetch.
     // A BIGR card also carries its Bopearachchi citation: the one already read while verifying the hit, else fetched now (Recent chips, right-click).
     async function cardOutcome(jsonld, corpus, { fetchImpl, cache, signal, citation }) {
       const labels = await resolveLabels(nomismaSlugs(jsonld), { fetchImpl, cache, signal });
       const card = toCard(jsonld, corpus, labels);
       if (!card) return { status: 'network' };
       if (corpus === BIGR) card.bop = bopDetails(card.label, citation === undefined ? await fetchCitation(card.id, fetchImpl, signal) : citation);
       return { status: 'ok', card };
     }
     ```

   - `lookupById`: destructure `citation` from `options` (`const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS, signal, citation } = options;`) and pass it: `cardOutcome(jsonld, corpus, { fetchImpl, cache, signal: timer.signal, citation })`.

   - After `inGroup` add:

     ```js
     // BIGR's plain search matches the citation text ("Euthydemus I 24A" finds Euthydemus I 13.1 and its parent 13), so every hit is verified against its own
     // NUDS citation, in parallel: exact when the series matches. The verified hits keep their citation so the card needs no second XML request.
     async function verifyBop(entries, series, fetchImpl, signal) {
       return Promise.all(entries.slice(0, VERIFY_LIMIT).map(async (entry) => {
         const citation = await fetchCitation(entry.id, fetchImpl, signal);
         return { ...entry, citation, exact: citation !== null && norm(seriesOf(citation)) === norm(series) };
       }));
     }

     // Suggestions are labelled by citation, with BIGR's own number to tell three "Philoxène 9C" subtypes apart; an uncited hit keeps its BIGR title.
     const bopCandidate = ({ id, title, citation }) => ({ id, title: citation ? `Bopearachchi ${citation} (${shortTitle(title)})` : title });

     // With a king: "{king} {series}"; one exact hit is the type, several are offered, none leaves the (verified) hits as near misses like any other corpus.
     // A king BIGR cannot find (a Greek spelling, say) or no king at all: the series alone, and every king with that exact series is offered,
     // because Bopearachchi's series restart per king.
     async function pickBop({ king, series }, search, fetchImpl, signal) {
       let hits = king ? await search(`${king} ${series}`) : [];
       const byKing = hits.length > 0;
       if (!byKing) hits = await search(series);
       const verified = await verifyBop(hits, series, fetchImpl, signal);
       const exact = verified.filter((hit) => hit.exact);
       if (byKing && exact.length === 1) return { status: 'ok', entry: exact[0], citation: exact[0].citation };
       if (exact.length > 0) return { status: 'candidates', candidates: exact.map(bopCandidate) };
       if (byKing && hits.length <= 5) return { status: 'candidates', candidates: verified.map(bopCandidate) };
       return { status: 'none' };
     }
     ```

   - `lookupType`: replace `const { corpus, query, id } = buildQuery(reference);` with `const built = buildQuery(reference);` + `const { corpus, query, id } = built;`; replace `if (id) {` with `if (corpus === BIGR) {` + `picked = await pickBop(built, search, fetchImpl, timer.signal);` + `} else if (id) {` (the SC and quoted-search branches unchanged); and the final resolve becomes `return await lookupById(corpus, picked.entry.id, { ...options, signal: timer.signal, citation: picked.citation });` (undefined for other corpora, which never read it).

   Outcome shapes: `ok` cards from BIGR carry `bop: { king, series, citation }`; `candidates`/`none` carry `corpus: 'bigr'` and `query` such as `Bopearachchi Euthydemus I 24A` or `Bopearachchi 9C`. Candidate order is feed order.

2. `extension/prices.js`: import becomes `import { TIMEOUT_MS, bopSeries, referenceNumber } from './lookup.js';`; in `defaultTerm`, after the SC line:

   ```js
     // acsearch lots cite Bopearachchi by the king's first name and series ("Euthydemus Bopearachchi 24A"); the section field is the king.
     if (catalogue === 'Bop') return squash(`${squash(section).split(' ')[0]} Bopearachchi ${bopSeries(number)}`);
   ```

3. `extension/preferences.js`: `DEFAULT_NUMBER` gains `Bop: '24A'`; directly below it add

   ```js
   // The section field is the RIC ruler or mint section for RIC and the king for Bop; a catalogue change resets it like the number.
   export const DEFAULT_SECTION = Object.freeze({ RIC: 'Nero', Bop: 'Euthydemus I' });
   ```

   `CORPORA` gains `'bigr'`; the catalogue allow-list becomes `['RIC', 'RRC', 'SC', 'Bop']`; `section: text(saved.section, DEFAULT_SECTION.RIC)`.

4. `extension/popup.html`: catalogue select gains `<option value="Bop">Bop (Bopearachchi)</option>` after SC. In `#ric-fields`, give the volume wrapper `id="volume-field"` and the section label `id="section-label"` (`<div id="volume-field"><label for="ric-volume">…</label>…</div><div><label id="section-label" for="ric-section">Ruler or mint section</label>…</div>`). In the result heading, after `<p id="result-summary"></p>` add `<p id="result-citation" hidden></p>` (inside the same `div`, so `.type-heading p` styles it). Footer: `Type data: ANS OCRE, PELLA, CRRO, SCO &amp; BIGR (ODbL)`. Placeholder unchanged.

5. `extension/popup.css`: after the `.ric-fields {…}` rule add `.ric-fields.single {grid-template-columns:1fr;}` (the King field alone spans the row).

6. `extension/popup.js`
   - Import `DEFAULT_SECTION` beside `DEFAULT_NUMBER`.
   - `QUICK_ERROR`: `Couldn’t read that reference. Try “RIC I² Nero 306”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below.`
   - `CORPUS_NAME.bigr = 'BIGR'`; `NOT_FOUND_HINT.bigr = 'Check the king and Bop number.'`; `REFERENCE_LABEL.Bop = 'Bop number'`; `REFERENCE_HELP.Bop = 'Example: 24A'`.
   - `updateFields`: add `const isBop = catalogue === 'Bop';`; `$('ric-fields').hidden = !isRic && !isBop;` `$('volume-field').hidden = !isRic;` `$('ric-fields').classList.toggle('single', isBop);` `$('section-label').textContent = isBop ? 'King' : 'Ruler or mint section';` (`required` stays `isRic` for both inputs, so the hidden volume never blocks `reportValidity`).
   - `fillFields`: set `ric-volume` only for RIC, `ric-section` for RIC **and** Bop: `if (parsed.catalogue === 'RIC') $('ric-volume').value = parsed.volume; if (parsed.catalogue === 'RIC' || parsed.catalogue === 'Bop') $('ric-section').value = parsed.section;`.
   - `run`: in the `ok` branch, **before** `renderCard(outcome.card)`, add `if (outcome.card.bop) fillFields({ catalogue: 'Bop', number: outcome.card.bop.series ?? '', volume: '', section: outcome.card.bop.king });` with the comment `// A BIGR card fills King and Bop number from itself (title and citation), so the acsearch term follows the chosen type; chips and suggestions carry no parsable Bop label.` The existing `savePreferences()` after `rememberRecent` persists the filled fields.
   - `renderCard`: add `const citation = card.bop?.citation ? \`Bopearachchi ${card.bop.citation}\` : ''; $('result-citation').textContent = citation; $('result-citation').hidden = !citation;`.
   - Catalogue `change` handler: after the `reference-number` reset add `if (Object.hasOwn(DEFAULT_SECTION, $('catalogue').value)) $('ric-section').value = DEFAULT_SECTION[$('catalogue').value];`.
   - `renderCandidates` and `renderRecent` are unchanged: `parseReference` returns `null` for Bop candidate labels and BIGR titles (verified), so they fill nothing and the card fills the fields in `run`.

7. Version 0.12.0: manifests (`version`; description `Look up ancient coin types by RIC, RRC, SC, Bopearachchi or Price reference and see recent acsearch hammer prices.`), `tests/test_packages.py` (version assertion and ZIP name). README: intro adds `Bopearachchi (Bop) references through [BIGR](https://numismatics.org/bigr/)` and the version; "What it does" one-box bullet adds `` `Bop Euthydemus I 24A` ``; the guided-entry bullet adds `a Bopearachchi king and number`; the matching bullet becomes `- Exact-title matching against the ANS search API (SC references are fetched directly by record; Bopearachchi references are verified against the citation in each BIGR record, and a series typed without its king lists every king that has it); near matches are offered as a short list.`; the card bullet adds `(and the Bopearachchi citation for BIGR types)`; checks block unchanged. INSTALL: every `0.11.0` → `0.12.0`; intro `looks up RIC, RRC, SC, Bopearachchi and Price coin types from … OCRE, CRRO, SCO, BIGR and PELLA datasets`; "What to try" gains `- **Bop Euthydemus I 24A** — a bronze of Euthydemus I of Bactria; the card shows its BIGR type and the citation **Bopearachchi Euthydème I 24A**, and its acsearch search starts as "Euthydemus Bopearachchi 24A". **Bop 9C** alone lists every king with a 9C series to choose from.` Install page: version (eyebrow, intro, both ZIP links), same intro wording, "What to try" adds `<strong>Bop Euthydemus I 24A</strong>` before `or <strong>Price 23</strong>`. Remove stale `dist/giga-pinax-*-0.11.0.zip`.

**Tests**

`tests/preferences.test.mjs`: import `DEFAULT_SECTION`; the `DEFAULT_NUMBER` expectation becomes `{ Price: '23', RIC: '306', RRC: '44/5', SC: '1266.2', Bop: '24A' }` (the only existing expectation that changes). Append:

```js
test('Bop is a remembered catalogue with its own default number and king, and bigr a valid Recent corpus', () => {
  assert.deepEqual({ ...DEFAULT_NUMBER }, { Price: '23', RIC: '306', RRC: '44/5', SC: '1266.2', Bop: '24A' });
  assert.deepEqual({ ...DEFAULT_SECTION }, { RIC: 'Nero', Bop: 'Euthydemus I' });
  assert.ok(Object.isFrozen(DEFAULT_SECTION));
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).catalogue, 'Bop');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).number, '24A');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).section, 'Nero');
  const recent = [{ id: 'bigr.euthydemus_i.13.1', corpus: 'bigr', label: 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, recent);
});
```

`tests/prices.test.mjs`, append:

```js
test('defaultTerm uses the first word of the king, Bopearachchi and the series for Bop', () => {
  assert.equal(defaultTerm({ catalogue: 'Bop', section: ' Euthydemus I ', number: 'Bop 24a' }), 'Euthydemus Bopearachchi 24A');
  assert.equal(defaultTerm({ catalogue: 'Bop', section: 'Diodotus I or Diodotus II', number: '8A' }), 'Diodotus Bopearachchi 8A');
  assert.equal(defaultTerm({ catalogue: 'Bop', section: '', number: 'Bop-9C' }), 'Bopearachchi 9C');
});
```

`tests/lookup.test.mjs`: extend the import with `bopSeries, bopCitation, seriesOf, kingOf, bopDetails`; existing helpers `fixture` and `fakeFetch` (unrouted URLs answer 404; routes match by substring in insertion order). Append:

```js
test('Bop references parse from one box with or without a king, and build a BIGR query', () => {
  const bop = (section, number) => ({ catalogue: 'Bop', number, volume: '', section });
  const cases = [
    ['Bop Euthydemus I 24A', bop('Euthydemus I', '24A')],
    ['Bopearachchi Euthydemus I 24A', bop('Euthydemus I', '24A')],
    ['Euthydemus I Bop. 24A', bop('Euthydemus I', '24A')],
    ['Euthydemus I, Bop 24A', bop('Euthydemus I', '24A')],
    ['Euthydemos Bop 24a', bop('Euthydemos', '24a')],
    ['Diodotus I or Diodotus II Bop 8A', bop('Diodotus I or Diodotus II', '8A')],
    ['Bop-9C', bop('', '9C')],
    ['Bop. 9C', bop('', '9C')],
    ['Bop 9C', bop('', '9C')],
    ['bop9c', bop('', '9c')],
    ['Bopearachchi 9C', bop('', '9C')],
    ['“Bop Philoxenus 9C”', bop('Philoxenus', '9C')],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseReference(text), expected, text);
  for (const text of ['Bop', 'Bopearachchi', 'Euthydemus I 24A', 'Bopearachi 9C', 'Bop 9C tetradrachm', 'Bop Euthydemus 1 24A',
    'Bopearachchi Philoxène 9C (Philoxenus 8.1)', 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1']) {
    assert.equal(parseReference(text), null, text);
  }
  for (const typed of ['24A', 'Bop 24A', 'Bop-24A', 'Bop. 24A', 'bopearachchi24A']) assert.equal(referenceNumber('Bop', typed), '24A', typed);
  assert.equal(bopSeries(' bop. 24a '), '24A');
  assert.deepEqual(buildQuery({ catalogue: 'Bop', number: 'Bop 24a', section: ' Euthydemus I ' }),
    { corpus: 'bigr', query: 'Bopearachchi Euthydemus I 24A', king: 'Euthydemus I', series: '24A' });
  assert.deepEqual(buildQuery({ catalogue: 'Bop', number: '9C' }), { corpus: 'bigr', query: 'Bopearachchi 9C', king: '', series: '9C' });
  assert.deepEqual(buildQuery(parseReference('Euthydemus I, Bop 24A')), { corpus: 'bigr', query: 'Bopearachchi Euthydemus I 24A', king: 'Euthydemus I', series: '24A' });
});

test('bopCitation reads the Bopearachchi idno from a NUDS record and fails closed; seriesOf and kingOf split citation and title', () => {
  assert.equal(bopCitation(fixture('bigr-euthydemus-i-13-1.xml')), 'Euthydème I 24A');
  assert.equal(bopCitation(fixture('bigr-euthydemus-i-13.xml')), 'Euthydème I 24');
  assert.equal(bopCitation(fixture('bigr-philoxenus-6-3.xml')), 'Philoxène 9C');
  const reference = (key, idno) => `<reference><tei:title key="${key}">T</tei:title><tei:idno>${idno}</tei:idno></reference>`;
  const mitchiner = reference('http://nomisma.org/id/mitchiner-1976', '343c');
  assert.equal(bopCitation(`<nuds><refDesc>${mitchiner}</refDesc></nuds>`), null);
  assert.equal(bopCitation(`<nuds><refDesc>${mitchiner}${reference('http://nomisma.org/id/bopearachchi-1991', ' Philox&amp;ne  9C ')}</refDesc></nuds>`), 'Philox&ne 9C');
  assert.equal(bopCitation(`<nuds>${reference('http://nomisma.org/id/bopearachchi-1991', '')}</nuds>`), null);
  for (const bad of ['', '<nuds/>', 'not xml', null, undefined]) assert.equal(bopCitation(bad), null);
  assert.equal(seriesOf('Euthydème I 24A'), '24A');
  assert.equal(seriesOf('Philoxène 9'), '9');
  assert.equal(kingOf('Bactrian and Indo-Greek Coinage Euthydemus I 13.1'), 'Euthydemus I');
  assert.equal(kingOf('Bactrian and Indo-Greek Coinage Diodotus I or Diodotus II 8A'), 'Diodotus I or Diodotus II');
  assert.equal(kingOf('Bactrian and Indo-Greek Coinage Philoxenus 6'), 'Philoxenus');
  assert.deepEqual(bopDetails('Bactrian and Indo-Greek Coinage Euthydemus I 13.1', 'Euthydème I 24A'), { king: 'Euthydemus I', series: '24A', citation: 'Euthydème I 24A' });
  assert.deepEqual(bopDetails('Bactrian and Indo-Greek Coinage Diodotus I or Diodotus II 8A', null), { king: 'Diodotus I or Diodotus II', series: null, citation: null });
});

// Routes match by substring in order: the 24A search is listed before the 24 one, whose needle is its prefix.
const BIGR_ROUTES = {
  'bigr/apis/search?q=Euthydemus%20I%2024A': fixture('bigr-search-euthydemus-i-24a.xml'),
  'bigr/apis/search?q=Euthydemus%20I%2024': fixture('bigr-search-euthydemus-i-24.xml'),
  'bigr/id/bigr.euthydemus_i.13.1.jsonld': fixture('bigr-euthydemus-i-13-1.jsonld'),
  'bigr/id/bigr.euthydemus_i.13.1.xml': fixture('bigr-euthydemus-i-13-1.xml'),
  'bigr/id/bigr.euthydemus_i.13.jsonld': fixture('bigr-euthydemus-i-13.jsonld'),
  'bigr/id/bigr.euthydemus_i.13.xml': fixture('bigr-euthydemus-i-13.xml'),
};

test('a Bop lookup with a king searches "{king} {series}", verifies each hit by its NUDS citation and resolves the one exact type', async () => {
  const fetchImpl = fakeFetch(BIGR_ROUTES);
  const result = await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: 'Bop 24a' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'bigr.euthydemus_i.13.1');
  assert.equal(result.card.label, 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1');
  assert.deepEqual(result.card.bop, { king: 'Euthydemus I', series: '24A', citation: 'Euthydème I 24A' });
  assert.deepEqual([result.card.authority, result.card.denomination, result.card.mint, result.card.material, result.card.dates],
    ['euthydemus_i_bactria', 'denomination_d_sco', null, 'ae', '230–190 BC']);
  assert.equal(result.card.reverse.legend, 'ΒΑΣΙΛΕΩΣ ΕΥΘΥΔΗΜΟΥ');
  assert.equal(fetchImpl.calls[0], 'https://numismatics.org/bigr/apis/search?q=Euthydemus%20I%2024A');
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 1);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.endsWith('.xml')).sort(),
    ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.xml', 'https://numismatics.org/bigr/id/bigr.euthydemus_i.13.xml']);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/bigr/id/') && url.endsWith('.jsonld')), ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.jsonld']);
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));

  const parent = await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24' }, { fetchImpl: fakeFetch(BIGR_ROUTES), cache: new Map() });
  assert.equal(parent.status, 'ok');
  assert.equal(parent.card.id, 'bigr.euthydemus_i.13');
  assert.deepEqual(parent.card.bop, { king: 'Euthydemus I', series: '24', citation: 'Euthydème I 24' });
});

test('a king BIGR does not know falls back to the series alone and offers every verified king as a labelled list', async () => {
  const fetchImpl = fakeFetch({ 'bigr/apis/search?q=Euthydemos%2024A': '<feed></feed>', 'bigr/apis/search?q=24A': fixture('bigr-search-24a.xml'), ...BIGR_ROUTES });
  const result = await lookupType({ catalogue: 'Bop', section: 'Euthydemos', number: '24A' }, { fetchImpl });
  assert.deepEqual(result, { status: 'candidates', corpus: 'bigr', query: 'Bopearachchi Euthydemos 24A',
    candidates: [{ id: 'bigr.euthydemus_i.13.1', title: 'Bopearachchi Euthydème I 24A (Euthydemus I 13.1)' }] });
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/apis/search')),
    ['https://numismatics.org/bigr/apis/search?q=Euthydemos%2024A', 'https://numismatics.org/bigr/apis/search?q=24A']);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.xml')).length, 8);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.jsonld')).length, 0);
});

test('a Bop series without a king lists the verified types of every king; unverified hits are left out', async () => {
  const fetchImpl = fakeFetch({
    'bigr/apis/search?q=9C': fixture('bigr-search-9c.xml'),
    'bigr/id/bigr.philoxenus.6.3.xml': fixture('bigr-philoxenus-6-3.xml'),
    'bigr/id/bigr.philoxenus.7.1.xml': fixture('bigr-philoxenus-7-1.xml'),
    'bigr/id/bigr.philoxenus.8.1.xml': fixture('bigr-philoxenus-8-1.xml'),
    'bigr/id/bigr.philoxenus.6.xml': fixture('bigr-philoxenus-6.xml'),
    'bigr/id/bigr.antialcidas.12.2.xml': fixture('bigr-antialcidas-12-2.xml'),
    'bigr/id/bigr.hermaeus.9.4.xml': fixture('bigr-hermaeus-9-4.xml'),
  });
  const result = await lookupType({ catalogue: 'Bop', section: '', number: 'Bop-9C' }, { fetchImpl });
  assert.equal(result.status, 'candidates');
  assert.equal(result.query, 'Bopearachchi 9C');
  assert.deepEqual(result.candidates.map((entry) => entry.title), [
    'Bopearachchi Philoxène 9C (Philoxenus 8.1)',
    'Bopearachchi Philoxène 9C (Philoxenus 7.1)',
    'Bopearachchi Philoxène 9C (Philoxenus 6.3)',
    'Bopearachchi Antialcidas 9C (Antialcidas 12.2)',
    'Bopearachchi Hermaios 9C (Hermaeus 9.4)',
  ]);
  assert.deepEqual(result.candidates.map((entry) => entry.id), ['bigr.philoxenus.8.1', 'bigr.philoxenus.7.1', 'bigr.philoxenus.6.3', 'bigr.antialcidas.12.2', 'bigr.hermaeus.9.4']);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/apis/search')), ['https://numismatics.org/bigr/apis/search?q=9C']);
  const xml = fetchImpl.calls.filter((url) => url.endsWith('.xml'));
  assert.equal(xml.length, 16);
  assert.ok(xml.every((url) => /^https:\/\/numismatics\.org\/bigr\/id\/bigr\.[a-z_]+(?:\.\d+[A-Z]?)+\.xml$/.test(url)), xml.join('\n'));
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));
});

test('with a king, several exact hits are offered by citation and BIGR number, and near misses follow the five-suggestion rule', async () => {
  const philoxenus = {
    'bigr/id/bigr.philoxenus.6.3.xml': fixture('bigr-philoxenus-6-3.xml'),
    'bigr/id/bigr.philoxenus.7.1.xml': fixture('bigr-philoxenus-7-1.xml'),
    'bigr/id/bigr.philoxenus.8.1.xml': fixture('bigr-philoxenus-8-1.xml'),
    'bigr/id/bigr.philoxenus.6.xml': fixture('bigr-philoxenus-6.xml'),
  };
  const several = fakeFetch({ 'bigr/apis/search?q=Philoxenus%209C': fixture('bigr-search-philoxenus-9c.xml'), ...philoxenus });
  const result = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9c' }, { fetchImpl: several });
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates.map((entry) => entry.title), ['Bopearachchi Philoxène 9C (Philoxenus 8.1)', 'Bopearachchi Philoxène 9C (Philoxenus 7.1)', 'Bopearachchi Philoxène 9C (Philoxenus 6.3)']);
  assert.equal(several.calls.filter((url) => url.includes('/apis/search')).length, 1);
  assert.equal(several.calls.filter((url) => url.endsWith('.xml')).length, 6);

  const feed = (...ids) => `<feed>${ids.map((id) => `<entry><title>Bactrian and Indo-Greek Coinage Philoxenus ${id}</title><id>bigr.philoxenus.${id}</id></entry>`).join('')}</feed>`;
  const near = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9D' }, { fetchImpl: fakeFetch({ 'bigr/apis/search?q=Philoxenus%209D': feed('6', '6.3', '99'), ...philoxenus }) });
  assert.deepEqual(near, { status: 'candidates', corpus: 'bigr', query: 'Bopearachchi Philoxenus 9D', candidates: [
    { id: 'bigr.philoxenus.6', title: 'Bopearachchi Philoxène 9 (Philoxenus 6)' },
    { id: 'bigr.philoxenus.6.3', title: 'Bopearachchi Philoxène 9C (Philoxenus 6.3)' },
    { id: 'bigr.philoxenus.99', title: 'Bactrian and Indo-Greek Coinage Philoxenus 99' },
  ] });
  const many = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9D' }, { fetchImpl: fakeFetch({ 'bigr/apis/search?q=Philoxenus%209D': feed('1', '2', '3', '4', '5', '6'), ...philoxenus }) });
  assert.deepEqual(many, { status: 'none', corpus: 'bigr', query: 'Bopearachchi Philoxenus 9D' });
  const nothing = await lookupType({ catalogue: 'Bop', section: '', number: '9D' }, { fetchImpl: fakeFetch({ 'bigr/apis/search?q=9D': feed('6', '6.3'), ...philoxenus }) });
  assert.deepEqual(nothing, { status: 'none', corpus: 'bigr', query: 'Bopearachchi 9D' });
});

test('Bop lookups report network errors for a failing search or a timed-out verification', async () => {
  const failing = async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) });
  assert.deepEqual(await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24A' }, { fetchImpl: failing }), { status: 'network' });
  const search = fakeFetch(BIGR_ROUTES);
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const hangXml = (url, init) => (url.endsWith('.xml') ? hang(url, init) : search(url, init));
  assert.deepEqual(await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24A' }, { fetchImpl: hangXml, timeoutMs: 20 }), { status: 'network' });
  assert.deepEqual(await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl: hangXml, cache: new Map(), timeoutMs: 20 }), { status: 'network' });
});

test('lookupById on BIGR fetches the NUDS record for the citation, and an unreadable one leaves the card uncited', async () => {
  const fetchImpl = fakeFetch(BIGR_ROUTES);
  const result = await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.card.bop, { king: 'Euthydemus I', series: '24A', citation: 'Euthydème I 24A' });
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/bigr/id/')),
    ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.jsonld', 'https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.xml']);
  const uncited = await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl: fakeFetch({ 'bigr/id/bigr.euthydemus_i.13.1.jsonld': fixture('bigr-euthydemus-i-13-1.jsonld') }), cache: new Map() });
  assert.equal(uncited.status, 'ok');
  assert.deepEqual(uncited.card.bop, { king: 'Euthydemus I', series: null, citation: null });
  const other = await lookupById('pella', 'price.23', { fetchImpl: fakeFetch({ 'pella/id/price.23.jsonld': fixture('pella-price-23.jsonld') }), cache: new Map() });
  assert.equal(other.status, 'ok');
  assert.equal(Object.hasOwn(other.card, 'bop'), false);
});
```

(These ten cases and the changed expectation were run against a scratch copy of the three modules with these fixtures on 2026-09-11: all pass, and every other existing test still passes.)

**Verify:** new tests and the one updated expectation fail first for the expected reasons (missing exports, `Bop` unparsed, `bigr` not a corpus); then `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs tests/selection.test.mjs` 71/71 (61 + 10), `python -m unittest discover -s tests -p "test_*.py"` 9 OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check` on each of `extension/lookup.js`, `extension/prices.js`, `extension/preferences.js`, `extension/popup.js`, `git grep -nE "(^|[^0-9.@])0\.11\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing, and `git grep -nP '[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]' -- ':!*.png' ':!*.zip'` prints nothing (the fixtures were checked clean when captured). Confirm `dist/` holds only `0.12.0` ZIPs.

**Commit** the fifteen code/doc files and fifteen fixtures: `Add Bopearachchi (Bop) via ANS BIGR and release 0.12.0`.

## Verification (controller)

Result 2026-09-11 at `27b1bd2`, in-app Chromium in a 440×680 window (popup body 400 px) on `http://localhost:8790` (never loaded before), live numismatics.org; acsearch is unreachable from a plain tab (CORS), so each "1 acsearch" below is the attempted fetch:

- `?q=Bop Euthydemus I 24A` → fields Bop / `Euthydemus I` / `24A`; card `Bactrian and Indo-Greek Coinage Euthydemus I 13.1`, citation `Bopearachchi Euthydème I 24A`, summary `Euthydemus I of Bactria · Denomination D (half) · Bronze · 230–190 BC`, link `…/bigr/id/bigr.euthydemus_i.13.1`, term `Euthydemus Bopearachchi 24A`; 1 search, 2 `.xml`, 1 `.jsonld`, 1 acsearch. Pass.
- `Bop-9C` → 1 search `?q=9C`, 16 `.xml`, no `.jsonld`, no acsearch; the eight labels exactly as planned. Choosing `(Philoxenus 6.3)` → box cleared, fields Bop / `Philoxenus` / `9C`, citation `Bopearachchi Philoxène 9C`, term `Philoxenus Bopearachchi 9C`; requests 1 `.jsonld`, the nomisma label, **1 `.xml`** and 1 acsearch. (The planned line said no further `.xml`: a chosen suggestion resolves through `lookupById`, which fetches the citation per design point 6 — one request, intended.) Pass.
- `Euthydemos Bop 24A` → searches `?q=Euthydemos%2024A` then `?q=24A`, 8 `.xml`; the four planned labels. Pass.
- `Euthydemus Bop 24` → 1 search, 1 `.xml`; card `… Euthydemus I 13`, citation `Bopearachchi Euthydème I 24`, fields `Euthydemus I` / `24`, term `Euthydemus Bopearachchi 24`. Pass.
- `Bop Philoxenus 9C` → three `Bopearachchi Philoxène 9C (…)`. `Bop Euthydemus I 99Z` → `No Bopearachchi Euthydemus I 99Z found in BIGR. Check the king and Bop number.`, `#reference-number` invalid (king search, then the series fallback; 0 `.xml`). `Bopearachi 9C` → the one-box error naming `“Bop Euthydemus I 24A”`, box invalid, no request. Pass.
- Catalogue Bop → option `Bop (Bopearachchi)`, `King` full width, volume hidden, `Euthydemus I` / `24A`; back to RIC → volume shown, `Ruler or mint section` / `Nero` / `306`; footer names BIGR. Pass.
- Recent chip `Bactrian and Indo-Greek Coinage Euthydemus I 13.1` with the form on Price → fields Bop / `Euthydemus I` / `24A`, citation, term `Euthydemus Bopearachchi 24A`; 1 `.jsonld`, 1 `.xml`, 1 acsearch. Pass.
- `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2`, `Price 23` unchanged (titles, terms, request shapes as in v0.11); `SC 1266.9` offers `Seleucid Coins (part 1) 1266`. Pass.
- Only numismatics.org, nomisma.org and acsearch requested; console: only the acsearch CORS lines and SC 1266.9's expected record 404.

Planned checks:

In a served tab on a never-loaded localhost origin (never-cached), live numismatics.org, acsearch stubbed, 400 px:

- Catalogue **Bop** → option `Bop (Bopearachchi)`, a full-width `King` field (volume hidden) defaulting to `Euthydemus I`, label `Bop number`, help `Example: 24A`, default `24A`, footer `Type data: ANS OCRE, PELLA, CRRO, SCO & BIGR (ODbL)`. Switching to RIC shows the volume again with `Ruler or mint section` / `Nero`.
- `Bop Euthydemus I 24A` in the Reference box → fields Bop / `Euthydemus I` / `24A`; card `Bactrian and Indo-Greek Coinage Euthydemus I 13.1`, citation line `Bopearachchi Euthydème I 24A`, summary `Euthydemus I of Bactria · Denomination D (half) · Bronze · 230–190 BC`, reverse legend `ΒΑΣΙΛΕΩΣ ΕΥΘΥΔΗΜΟΥ`, type link `…/bigr/id/bigr.euthydemus_i.13.1`, term `Euthydemus Bopearachchi 24A`. Network: one search `/bigr/apis/search?q=Euthydemus%20I%2024A`, exactly two `.xml` (`…13.1.xml`, `…13.xml`), one `.jsonld` (`…13.1`), nomisma labels; 1 acsearch request.
- `Bop-9C` → one search `?q=9C`, sixteen `.xml`, no `.jsonld`; "Did you mean" of eight: `Bopearachchi Philoxène 9C (Philoxenus 8.1)`, `… (Philoxenus 7.1)`, `… (Philoxenus 6.3)`, `Bopearachchi Antialcidas 9C (Antialcidas 12.2)`, `Bopearachchi Ménandre I 9C (Menander I 17.3)`, `Bopearachchi Eucratide I 9C (Eucratides I 9.2)`, `Bopearachchi Hermaios 9C (Hermaeus 9.4)`, `Bopearachchi Straton I 9C (Strato I 12.3)`. Choosing the Philoxenus 6.3 entry → box cleared, fields Bop / `Philoxenus` / `9C`, card with citation `Bopearachchi Philoxène 9C`, term `Philoxenus Bopearachchi 9C`, one `.jsonld` and no further `.xml`; 1 acsearch request.
- `Euthydemos Bop 24A` → searches `?q=Euthydemos%2024A` then `?q=24A`, eight `.xml`; pick-list of four: `Bopearachchi Eucratide I 24A (Eucratides I 28.1)`, `Bopearachchi Euthydème I 24A (Euthydemus I 13.1)`, `Bopearachchi Straton I 24A (Strato I 28.1)`, `Bopearachchi Ménandre I 24A (Menander I 23.1)`.
- `Euthydemus Bop 24` → one search `?q=Euthydemus%2024`, one `.xml`; card `… Euthydemus I 13` with citation `Bopearachchi Euthydème I 24`; fields refilled to King `Euthydemus I` / `24`; term `Euthydemus Bopearachchi 24`.
- `Bop Philoxenus 9C` → list of three `Bopearachchi Philoxène 9C (…)`. `Bop Euthydemus I 99Z` → `No Bopearachchi Euthydemus I 99Z found in BIGR. Check the king and Bop number.` with the box marked invalid. `Bopearachi 9C` → the one-box error naming `“Bop Euthydemus I 24A”`, no numismatics.org request.
- Recent chip for the BIGR card with the form on Price → fields Bop / `Euthydemus I` / `24A`, card with citation, term `Euthydemus Bopearachchi 24A`; requests: one `.jsonld`, one `.xml`, labels; 1 acsearch request.
- `popup.html?q=Bop%20Euthydemus%20I%2024A` resolves the same card without a click.
- Existing examples unchanged: `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2`, `Price 23` in the box each resolve as in v0.11 with their usual terms and request counts; `SC 1266.9` still offers `Seleucid Coins (part 1) 1266`.
- Only numismatics.org, nomisma.org and the acsearch stub appear in the network log; console clean apart from the expected acsearch CORS lines in a plain tab; `dist/brave/manifest.json` version `0.12.0`.
