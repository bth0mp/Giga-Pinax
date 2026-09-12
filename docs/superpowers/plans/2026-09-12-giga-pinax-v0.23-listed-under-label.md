# Giga Pinax 0.23 — the "listed under" label

**Goal:** the user's report (2026-09-12): he pasted a Titus lot, the extension opened **RIC II, Part 1 (second edition) Vespasian 972**, and it looked like a bug. It is not: RIC II.1² files Titus's Caesar coins in the Vespasian section and the portrait is Titus. He said "I think its fine actually" *once it was explained* — so the explanation must come from the card, not from a conversation. Release 0.23.0.

One short line on the card, only when it has something to say.

## Findings (2026-09-12, live probes of numismatics.org and nomisma.org)

**1. The portrait is already in the record the extension fetches.** `nmo:hasPortrait` sits on the `#obverse` node, not the main node. `https://numismatics.org/ocre/id/ric.2_1(2).ves.972.jsonld`:

```
ric.2_1(2).ves.972          nmo:hasAuthority → nomisma.org/id/vespasian
ric.2_1(2).ves.972#obverse  nmo:hasPortrait  → nomisma.org/id/titus      "Head of Titus, laureate, right"
ric.2_1(2).ves.972#reverse  nmo:hasPortrait  → nomisma.org/id/annona     "Annona, draped, seated left…"
```

The plain case, `ric.2_1(2).ves.1`: authority `vespasian`, obverse portrait `vespasian`, reverse portrait `judea_personification`. Same shape, nothing to report.

`toCard` already reads the `#obverse` node (for legend and description) and throws the portrait away. **No new request for the record.**

**2. The reverse portrait is a trap.** Both records above carry a reverse `nmo:hasPortrait`, and it is a deity. Only the obverse one may ever be read.

**3. The Solr facets confirm it, and one of them is wider than its name.** On `typeNumber:"972" AND "RIC II, Part 1 (second edition)"`:

| facet clause | hits |
|---|---|
| `portrait_facet:"Titus"` | **1** |
| `authority_facet:"Titus"` | 0 |
| `authority_facet:"Vespasian"` | **1** |
| `portrait_facet:"Vespasian"` | 0 |

But `portrait_facet` is **not obverse-only**: `typeNumber:"256" AND portrait_facet:"Vespasian"` returns *both* `Titus 256` (Vespasian is on its **reverse**) and `Vespasian 256`. Deities go to a separate `deity_facet` (`deity_facet:"Annona"` matches Vespasian 972; `portrait_facet:"Annona"` does not). So the facets stay where they are — in `ricSearch`, for finding hits — and the **card's own JSON-LD obverse node** is what the label is built from. They are not interchangeable.

**4. nomisma tells persons from deities, and gives the name.** `nm:titus` → `skos:prefLabel` "Titus", `@type` `['foaf:Person','skos:Concept']`. `nm:roma`, `nm:annona`, `nm:apollo`, `nm:judea_personification` → `wordnet:Deity`.

**5. A portrait is routinely not a ruler.** `ric.2_1(2).dom.759`: authority `domitian`, obverse portrait `apollo` ("Bust of Apollo, draped, right"). 71 types in RIC II.1² alone have no `portrait_facet` at all.

**6. Joint types carry two of everything.** `ric.10.leo_ii-zen_e.808`: two `nmo:hasAuthority` (`leo_ii`, `zeno`) and two obverse `nmo:hasPortrait` (`leo_ii`, `zeno`). `namedSlugs` takes only `[0]`, so the card already shows half the answer.

**7. An empress sits under her husband.** `ric.5.sala(2).93` ("RIC V Salonina (2) 93"): authority `gallienus`, obverse portrait `cornelia_salonina`. Title section, authority and portrait are three different strings for two people.

**8. The sibling sections are real and already listed.** `typeNumber:"306" AND "RIC V"` returns both `RIC V Gallienus 306` and `RIC V Gallienus (joint reign) 306`. `RIC X Zeno (East) 914` exists beside `Zeno` and `Zeno (West)`; `RIC IV Gordian III (Caesar) 1–3` beside `Gordian III`. `catalogues.js` already holds every one of these names in `RIC_SECTIONS`, and `buildQuery`'s `siblings` check already uses them.

**9. How he got there.** Typing `Titus 972` alone finds nothing (there is no Titus 972). The card came from the **lot path**: `rulersOf` → `portrait_facet:"Titus" OR authority_facet:"Titus"` → `pickRulers` opens Vespasian 972. The fixtures for exactly this already exist: `tests/fixtures/ocre-search-titus-972.xml` + `ocre-vespasian-972.jsonld`, and both `ocre-vespasian-972.jsonld` and `ocre-vespasian-1073.jsonld` already carry `portrait: titus`.

## Design

The line is a property of the **card**, not of the query. It therefore works identically for a lot text, a typed reference, a Recent chip, a right-click and the pop-out window, and nothing has to be threaded through `renderCard`.

### 1. `toCard` keeps the obverse portrait — `extension/lookup.js`

- New root field `card.portrait` (root, **not** inside `card.obverse`, so the existing `assert.deepEqual(card.obverse, {legend, description})` assertions keep passing).
- It is the label for the obverse node's `nmo:hasPortrait`, and it is `null` unless **all** of these hold:
  - the main node has exactly one `nmo:hasAuthority`;
  - the `#obverse` node has exactly one `nmo:hasPortrait`;
  - `labels[slug]` resolved. Unlike the other four slots, the portrait **never falls back to its slug** — `cornelia_salonina` must not reach the card.
- `otherCard` gains `portrait: null`.

### 2. One extra label fetch, on OCRE only — `cardOutcome`

`nomismaSlugs` is unchanged (its assertions stay green). `cardOutcome` adds the portrait slug at the call site:

```js
const slugs = [...new Set([...nomismaSlugs(jsonld), ...(corpus === 'ocre' ? [portraitSlug(jsonld)] : [])].filter(Boolean))];
```

`portraitSlug` is a new tiny export beside `nomismaSlugs`. Cost: **zero** extra requests when the portrait is the authority (the common case — same slug, deduped by the `Set`), **one** parallel, cached, same-deadline nomisma request when it differs. Nothing changes for CRRO, PELLA, SCO or BIGR.

### 3. `filingNote(card)` — one pure function in `lookup.js`

Returns a string, or `''`. `''` is the answer for the great majority of cards.

Nothing at all unless `card.corpus === 'ocre'` and `parseReference(card.label)` reads back as RIC. Then up to two sentences, joined by a space:

**a. The portrait sentence** — when `card.portrait` is set, differs from `card.authority` (case- and space-insensitively), **and** `volumesOf(card.portrait).length > 0`, i.e. the name is one RIC itself uses as a section heading:

> `Portrait of Titus, listed under Vespasian.`

`Vespasian` is `card.authority`, the same name already in the card's title and summary. The `volumesOf` gate is what keeps Apollo, Annona, Roma, Judea and every personification off the card, with no new parsing and no claim the data does not support.

**b. The sibling sentence** — when `RIC_SECTIONS[volume]` holds other sections whose name before the `(` matches the card's section (the `rulerKey` rule `volumesOf` already uses):

> `RIC V also has a Gallienus (joint reign) section.`
> `RIC X also has Zeno and Zeno (West) sections.` (two is the observed maximum)
> `RIC IV also has a Gordian III (Caesar) section.`

It says the volume has another section. It does **not** say the sibling holds a coin with this number.

**c. Both apply:** the two sentences share one paragraph, in that order.

**d. Portrait and authority agree** (Nero 306, Titus 123, Gordian III (Caesar)) **and no sibling exists:** `''`. Nothing renders, nothing is announced, nothing moves on the card. This is the 95% case and it must stay silent.

### 4. Rendering — `popup.html`, `popup.css`, `popup.js`

- **`popup.html`:** one element, next to the Bop citation line inside the heading's left `<div>`:
  `<p id="result-filing" hidden></p>` — after `#result-summary`, before/after `#result-citation`.
- **`popup.css`: nothing new.** `.type-heading p {font-size:11px; line-height:1.3; color:var(--muted); margin-top:4px;}` already covers it, in the same register as the Bop citation. In the 400 px popup the heading's left column is ≈280 px after `.result`'s 16 px padding and the `Type ↗` link; the longest string here ("Portrait of Cornelia Salonina, listed under Gallienus.") wraps to two lines at 11 px and needs no `overflow-wrap` — these are short words, unlike a catalogue code.
- **`popup.js`, in `renderCard`,** beside the citation lines:
  ```js
  const filing = filingNote(card);
  $('result-filing').textContent = filing;
  $('result-filing').hidden = !filing;
  ```
- **Screen reader:** two things, no new live region.
  1. Document order. The `<p>` sits inside `.type-heading`, so it is read straight after the h2 title and the summary line — title, "Vespasian · Denarius · Rome · Silver · AD 77–78", then "Portrait of Titus, listed under Vespasian." It is a plain paragraph: no role, no `aria-label`, no icon, nothing for a screen reader to announce twice.
  2. The existing announcement. `announce(\`Found ${card.label}.\`)` becomes `announce([\`Found ${card.label}.\`, filing].filter(Boolean).join(' '))`, so the `#announcement` live region says *"Found RIC II, Part 1 (second edition) Vespasian 972. Portrait of Titus, listed under Vespasian."* — the whole point of the feature, spoken. The no-access branch at the end of the submit handler builds the same string; give it the same treatment so it does not lose the sentence.

### 5. Docs and release 0.23.0

- **Version:** manifests, `tests/test_packages.py`, README, INSTALL and the install page. The stale check is now for `0.22.0`.
- **Say what it is,** in one sentence: when RIC files a coin under a different emperor from the one on the portrait, the card says so; when it says nothing, portrait and section agree.
- **Backlog:** a Done entry.
- **Build and checks:** `python scripts/build.py`, then the usual checks.

## What we are not building (ponytail)

The smallest version that delivers the value is **one `<p>`, one pure function, one extra conditional nomisma request, and no CSS**. Everything below was considered and dropped:

- **No new fetch of anything.** The portrait is in the record already on the wire. If it ever needed its own request, the feature would not be worth it.
- **No "as Caesar".** RIC's rank is not in the data. The obverse legend says `T CAESAR VESPASIANVS`, and parsing prose to print a claim about a coin is exactly how a wrong name reaches a collector. The example wording *"Filed as Caesar under Vespasian"* is therefore **rejected**; `Portrait of Titus, listed under Vespasian.` says only what the record says.
- **No `foaf:Person` gate.** It is the semantically right test and it would also catch Crispus in RIC VII and Cornelia Salonina in RIC V — but it means parsing `@type` out of the nomisma record and a second failure mode when a concept is untyped or 404s. `volumesOf` is already imported, costs nothing, and can only ever print a name RIC itself uses as a heading. **Add the person gate only if he asks why an empress or a Caesar of RIC VI–IX says nothing.**
- **No badge, colour, icon or tooltip.** Muted 11 px text under the title, like the Bopearachchi citation. If he wants it to stand out, that is one CSS rule later.
- **No "see the other section" button** for siblings, no cross-links, no second lookup. A sentence.
- **No line on non-RIC corpora.** See the risks.
- **No line naming what he typed** ("you asked for Titus"). The card does not know, and it does not need to: the type itself is what needs explaining, and explaining it from the card alone is what makes it work for a Recent chip and the pop-out too.

## Risks, and what the feature must NOT claim

| Risk | Handling |
|---|---|
| **No portrait field.** 71 RIC II.1² types have none; whole corpora have none. | `card.portrait` is `null`; no sentence. |
| **The portrait is a deity or personification,** not a person (Apollo on Domitian 759, Roma, Annona, Judea). | The `volumesOf` gate drops every name RIC does not use as a section heading. |
| **The portrait label did not resolve** (nomisma 404, offline, untyped concept). | Fail closed: the portrait falls back to `null`, never to its slug. `Portrait of cornelia_salonina` must never render. |
| **Joint portraits and joint authorities** (`Leo II and Zeno 808`, `Valerian and Gallienus`). | Silent unless exactly one authority and exactly one obverse portrait. The card already shows only the first authority; the label must not build on half an answer. |
| **Non-Roman series** where "filed under a ruler" is not a concept. CRRO `rrc-44.5` has issuer `anonymous` and obverse portrait `roma`; PELLA, SCO and BIGR are organised by king or by series, not by an authority a portrait can disagree with. | `corpus === 'ocre'` only. |
| **Name mismatches between nomisma and RIC's own sections** (`Claudius II Gothicus` vs the section `Claudius Gothicus`; `Cornelia Salonina` vs `Salonina (2)`). | These fail the `volumesOf` gate and stay silent. A deliberate, safe miss — never a guess. |
| **Sibling noise.** Plain `Gallienus 306` never opens directly today (it is offered), so the sentence lands on a card the collector chose, where it reads as confirmation. | Kept to one sentence naming at most the sections that exist. |

**It must not claim:** that the coin is "really" someone else's; that the search was wrong; any rank (Caesar, Augustus, Divus); that the sibling section contains this number; that a reverse figure is the portrait; or any name that is not a nomisma English `prefLabel` for a concept RIC files a section under.

## Tests (TDD)

`node:test` `.mjs` in `tests/`, hand-written fixtures, in the style of `tests/lookup.test.mjs`.

**`lookup` — `toCard` keeps the portrait:**
- `toCard(json('ocre-vespasian-972.jsonld'), 'ocre', { vespasian: 'Vespasian', titus: 'Titus', … }).portrait === 'Titus'`, `.authority === 'Vespasian'` — and `card.obverse` still deep-equals `{ legend, description }` with no third key.
- `ocre-nero-306.jsonld` → `portrait === 'Nero'` (equals the authority).
- `ocre-titus-123.jsonld` → `portrait === 'Titus'`.
- The reverse portrait is never read: a hand-written record whose obverse has no portrait and whose reverse has `annona` → `portrait === null`.
- An unresolved label → `null`, not the slug: `toCard(json('ocre-vespasian-972.jsonld'), 'ocre', {})` → `portrait === null`.
- Two obverse portraits (hand-written, `leo_ii` + `zeno`) → `null`. Two `nmo:hasAuthority` → `null`.
- `toCard` of the CRRO and PELLA fixtures → `portrait` is whatever the record says, but nothing downstream uses it (see `filingNote`).
- `lookupById('other', …)` card deep-equals its literal — the literal in the existing test gains `portrait: null`.

**`lookup` — `portraitSlug` and the label request:**
- `portraitSlug(json('ocre-vespasian-972.jsonld')) === 'titus'`; `portraitSlug({}) === null`.
- `lookupType` for the rulers/Titus 972 path (reusing `ocre-search-titus-972.xml` + `ocre-vespasian-972.jsonld`) fetches `nomisma.org/id/titus.jsonld` **once** alongside the other four, and the card carries `portrait: 'Titus'`.
- Nero 306, where portrait and authority share a slug: the nomisma calls are unchanged from today (no duplicate `nomisma-nero.jsonld` fetch).
- A CRRO or PELLA lookup makes **no** portrait label request.

**`lookup` — `filingNote` (the whole wording surface, driven by hand-written card literals):**
- Vespasian 972 card → `'Portrait of Titus, listed under Vespasian.'`
- Nero 306 card → `''`. Titus 123 card → `''`. A card with `portrait: null` → `''`.
- Apollo: `{ authority: 'Domitian', portrait: 'Apollo', label: 'RIC II, Part 1 (second edition) Domitian 759' }` → `''`.
- Cornelia Salonina: `{ authority: 'Gallienus', portrait: 'Cornelia Salonina', label: 'RIC V Salonina (2) 93' }` → only the sibling sentence (`Salonina` / `Salonina (2)`), never a portrait sentence.
- Case and spacing: `portrait: ' titus '` against `authority: 'Titus'` → `''`.
- Siblings: `RIC V Gallienus 306` → `'RIC V also has a Gallienus (joint reign) section.'`; `RIC V Gallienus (joint reign) 306` → `'RIC V also has a Gallienus section.'`; `RIC X Zeno (East) 914` → `'RIC X also has Zeno and Zeno (West) sections.'` (plural, two names, `and`); `RIC IV Gordian III (Caesar) 2` and `RIC IV Gordian III 95` → each names the other.
- Not siblings: `RIC V Gallienus and Salonina 1` → `''` (the name does not split at `' ('`). `RIC VII Treveri 100` → `''` (mint sections). `RIC I (second edition) Nero 306` → `''`.
- Both sentences at once: a hand-written card in a volume with a sibling *and* a differing ruler portrait → the two sentences, space-joined, portrait first.
- Corpus and catalogue gates: the same card with `corpus: 'crro'` → `''`; an Other card → `''`; a card whose `label` does not read back as RIC (an OCRE label that fell back to its id) → `''`.

**Popup:** checked by the controller in the browser — the `<p>` is hidden on a quiet card, the 400 px body does not grow, and the announcement carries the sentence.

## Verification (controller)

On a port never loaded before, at 440×680, numismatics.org live and acsearch stubbed:

| Input | Expect on the card |
|---|---|
| the biddr Titus lot (opens Vespasian 972) | `Portrait of Titus, listed under Vespasian.` |
| `Titus 123` | no filing line at all |
| `RIC I² Nero 306` | no filing line at all |
| the Vespasian 972 Recent chip, and the same card in the pop-out window | the same line, from the chip alone |
| `RIC V Gallienus (joint reign) 306` | `RIC V also has a Gallienus section.` |
| `RIC X Zeno (East) 914` | `RIC X also has Zeno and Zeno (West) sections.` |
| `Crawford 44/5`, `SC 1266.2`, `SG 6829`, `KM# 123` | no filing line at all |

Plus: body 400 px on every one; the console clean; `#announcement` reads "Found … Portrait of Titus, listed under Vespasian."; and the nomisma request count for a Nero 306 lookup unchanged from 0.22.
