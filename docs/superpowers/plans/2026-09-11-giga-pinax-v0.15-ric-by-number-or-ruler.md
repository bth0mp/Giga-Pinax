# Giga Pinax v0.15 — RIC by number or ruler

**Goal:** Fix three reports from the user (2026-09-11), then release 0.15.0:

1. "I cannot just search for RIC 972 … I have to fill out everything." The Reference box rejects a RIC number that has no volume and ruler, even when the fields below are complete.
2. "The emperor Titus was not listed for RIC." The Ruler list shows only the chosen volume's sections. Titus is only in II.1², so with I² chosen he is invisible.
3. "Allow me to start typing the emperor's name … have it auto find it regardless of RIC and then have the proper RIC for me." The user wants to type a ruler and have the volume follow.

**Root cause:** `parseReference` (`RIC_REFERENCE`, `extension/lookup.js`) needs `RIC {volume} {section} {number}`. `RIC 972` returns `null`, so the submit handler shows `QUICK_ERROR` before the guided fields are ever used. The section `<select>` is filled from `sectionsOf(volume)` only.

## OCRE facts (probed live 2026-09-11)

- `https://numismatics.org/ocre/apis/search?q=` takes a **Solr query**. It returns 100 entries per page, and `<opensearch:totalResults>` gives the total.
- **`typeNumber:"972"`** returns the 6 types numbered 972: II.1² Vespasian, II.3² Hadrian, III Antoninus Pius, III Marcus Aurelius, V Carausius and X Zeno (East). The plain `q=972` also returns the `Hadrian 971-973` range.
- `typeNumber:"306"` returns 35 entries: 33 types plus 2 `…: Subtype 1` entries. `typeNumber:"1"` returns 149, more than one page.
- The field is **case-sensitive**: `typeNumber:"56A"` gives 17 hits (IX), `typeNumber:"56a"` gives 5 (III, IV, VI).
- A ruler narrows the search as a quoted phrase: `typeNumber:"123" AND "Titus"` gives 2 hits. One is II.1² Titus 123; the other is III Antoninus Pius 123, whose text mentions Titus. Quoting keeps `/` and `( )` safe: `typeNumber:"12" AND "Gaius/Caligula"` and `typeNumber:"972" AND "Zeno (East)"` each give 1 hit.
- Subtype titles look like `RIC IX Thessalonica 5: Subtype 1`. `parseReference` reads that as section `Thessalonica 5: Subtype` and number `1`, so subtypes must be filtered out.
- Some titles carry a parenthetical: `RIC IV Septimius Severus 266 (aureus)`.

## Design

### `extension/catalogues.js`
- **`RIC_RULERS`**: every distinct section across all volumes (rulers and the VI–IX mints), in code-unit order, frozen.
- **`ANY_VOLUME`** = `{ value: '', label: 'Any volume' }`, and **`VOLUME_OPTIONS`** = `[ANY_VOLUME, ...RIC_VOLUMES]`, both frozen. `RIC_VOLUMES` stays the 12 volumes.
- **`volumesOf(ruler)`**: the volume values whose sections include the ruler. Matching ignores case and squashes whitespace. It returns `[]` for an unknown, blank or inherited key (`constructor`, `__proto__`).
- **`volumeFor(ruler, current)`**:
  - An unknown ruler returns `current`.
  - A ruler that `current` contains returns `current`.
  - A ruler in exactly one volume returns that volume.
  - A ruler in several volumes returns `''` (Any volume).
  - Examples: Titus → `II, Part 1 (2nd edition)`. Hadrian → `''`, unless II or II.3² is current. Antioch → `''`, unless one of VI–IX is current.
- Delete what becomes unused, together with its tests. This is likely `sectionsOf`, `ANY_KING` and `BOP_KINGS`.

### `extension/lookup.js`

`parseReference` gains these RIC forms. Output stays as typed, whitespace-squashed:

| Typed | Result |
|---|---|
| `RIC 972` | volume `''`, section `''`, number `972` |
| `RIC I² 306`, `RIC 2/3² 12` | the volume exactly as today, section `''` |
| `RIC Titus 123`, `ric titus 123` | volume `''`, section as typed |
| `Titus 123`, `Hadrian 12`, `Rome 306` (no `RIC` prefix) | RIC, volume `''`, section as typed |

- **Known ruler rule:** without a volume, the section must be a known ruler, meaning a case-insensitive member of `RIC_RULERS`. So `RIC XI Nero 1`, `RIC I 2 Nero 306`, `RIC hello 5`, `hello 5` and `Euthydemus I 24A` stay `null`.
- **With a volume**, any section text is kept, as today.
- **Everything that parses today parses the same.** The existing tests keep passing, except the `RIC Nero 306 → null` case, which now reads as section `Nero`.
- **Order:** the RRC/Price/SC and Bop patterns still run first. The number keeps today's rule: the last token, starting with a digit, with an optional ` (…)`.

`buildQuery` keeps today's display query for RIC (`RIC I (second edition) Nero 306`). Blanks are squashed away, giving `RIC 972`, `RIC Hadrian 12` or `RIC I (second edition) 306`. The result also carries `partial: true` when the volume or the section is blank. A full reference is looked up exactly as today.

**Partial RIC lookup:** one numismatics.org search, inside the shared deadline.
- **Query:** `typeNumber:"{n}"`, followed by ` AND "{section}"` when a ruler is given.
  - `{n}` is the number without a trailing parenthetical.
  - When the lower- and upper-case forms of `{n}` differ, query both: `(typeNumber:"56a" OR typeNumber:"56A")`.
  - Strip `"` and `\` from user text before it goes into the query.
- **Keep** a hit only when its title parses as RIC and all of these hold:
  - the number is the same, ignoring a trailing parenthetical and case;
  - the parsed section has no digit and no colon, which drops subtypes;
  - the volume matches when one was given, and the ruler matches when one was given (both case-insensitive).
- **Sort** kept hits in `RIC_VOLUMES` order, then by section, then by title.
- **Outcomes:**
  - The feed's total is larger than the entries it returned (more than one page): `{ status: 'too-many' }`.
  - No hit is kept: `none`.
  - Exactly one hit is kept: the type, fetched like an exact pick (`lookupById`).
  - Several hits are kept: `candidates` with every kept hit. There is no five-entry cap; there are at most 100 by construction.
  - `corpus` and `query` are added to every outcome, as today.

### `extension/popup.html`
- `#ric-section` becomes a text input with a suggestion list: `<input id="ric-section" name="section" list="section-options" maxlength="120" autocomplete="off" spellcheck="false">` plus `<datalist id="section-options"></datalist>` in the same field `div`. The label and its `for` stay the same.
- New Reference placeholder: `Titus 123 · RIC 972 · Crawford 44/5 · Price 23`.

### `extension/popup.js`
- **Volume select:** filled from `VOLUME_OPTIONS`. `selectOptions` still appends a parsed volume that is not listed, such as `IV, Part 1`.
- **Ruler/King input:**
  - Its datalist holds `RIC_RULERS` for RIC and `BIGR_KINGS` for Bop, one `new Option` per entry, never markup.
  - Placeholder: `Any ruler` for RIC, `Any king` for Bop.
  - Its value is set exactly as given; blank means any.
- **Not required:** neither the Volume select nor the Ruler input is required. The number stays required.
- **Typing a ruler** (RIC only, on the input's `input` event): the Volume select becomes `volumeFor(value, currentVolume)`. So the volume updates as soon as the typed text is a known ruler.
- **Choosing a volume:**
  - A known ruler that is not in the new volume is cleared (blank means any ruler).
  - Any volume keeps the ruler.
  - Unknown typed text is kept.
- **Filling from the Reference box, a Recent chip or a suggestion:**
  - A parsed RIC reference with no volume gets `volumeFor(section, '')`, so `Titus 123` shows II.1² at once.
  - An explicit volume is never changed. RIC II (1926) numbers are not II.1² (2007) numbers, so "correcting" `RIC II Titus 5` would show the wrong coin.
- **After any OCRE card resolves:** the RIC fields are refilled from the card title with `parseReference`, as BIGR cards already are. `RIC 972` then shows the chosen type's volume and ruler, and the acsearch term follows (`Hadrian 972`).
- **`too-many` outcome:** `showError(\`${outcome.query} matches too many types to list. Type a ruler to narrow it down.\`)`, with no field marked invalid.
- **Copy:**
  - `REFERENCE_HELP.RIC`: `Example: 306 with Nero. Leave the ruler blank to list every type with that number.`
  - `REFERENCE_HELP.Bop`: `Example: 24A. Leave the king blank to list every king with that number.`
  - `NOT_FOUND_HINT.ocre`: `Check the ruler, volume and number.`
  - `QUICK_ERROR`: `Couldn’t read that reference. Try “RIC 972”, “Titus 123”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below.`
- **Defaults on a catalogue switch** stay the same: RIC is I² / Nero / 306, and Bop is Euthydemus I / 24A.

### `extension/popup.css`
The Ruler input matches the selects in `.ric-fields`: the same height and the same 12px text.

### `extension/preferences.js`
No change is expected. A stored blank volume or section already restores as blank, which now means "any". This also fixes the v0.13 minor about a blank stored section showing as the first section of its volume.

## Tests (TDD: each new test fails first for the expected reason)

- **Fixtures,** captured live into `tests/fixtures/`, real responses only:
  - `ocre-search-typenumber-972.xml`: q=`typeNumber:"972"`.
  - `ocre-search-typenumber-123-titus.xml`: q=`typeNumber:"123" AND "Titus"`.
  - `ocre-search-typenumber-306.xml`: 35 entries, including the subtype entries.
  - A `typeNumber:"1"` page for too-many. It may be trimmed to its header plus a few entries, but must keep `totalResults` 149; if trimmed, the README fixture sentence says so.
  - One OCRE record `.jsonld` for a card, if no existing fixture fits.
- **`parseReference`:** every form in the table above, with the still-`null` list.
- **`lookupType`,** with fake fetch routes:
  - `RIC 972` gives 6 candidates in volume order.
  - `Titus 123` with a blank volume gives the card, through the one kept hit.
  - `RIC 306` gives 33 candidates and no subtypes.
  - `RIC 1` gives `too-many`.
  - An unknown number gives `none`.
  - Assert the exact `q` sent: the `typeNumber` clause, both cases for a letter suffix, and the quoted ruler.
- **`catalogues`:** `RIC_RULERS` size, order and uniqueness, and that it includes Titus and Antioch. `volumesOf` and `volumeFor` cases from the design, and `VOLUME_OPTIONS`.
- **Popup behaviour** has no DOM harness. The controller verifies it in the browser.

## Release 0.15.0

- **Version:** `manifests/brave.json` and `manifests/firefox.json`, plus `tests/test_packages.py` (the version assertion and the ZIP name).
- **README:**
  - The intro version.
  - The Reference box bullet gains `RIC 972` and `Titus 123`.
  - The guided-entry bullet: the ruler is typed with suggestions from every volume, the volume follows it, and a blank volume or ruler means any.
- **`docs/INSTALL.md`:**
  - Every `0.14.0` becomes `0.15.0`.
  - In "What to try", the `II.1² … lists Domitian, Titus and Vespasian` line is replaced by one about typing **Titus** in Ruler (the volume becomes II.1² (2nd ed.)).
  - Add **RIC 972** in the Reference box (a list of the six types numbered 972; choosing one sets the fields).
- **`install/index.html`:** `0.14.0` becomes `0.15.0` in the eyebrow, the intro and both ZIP links, and "What to try" mentions `RIC 972` and typing a ruler.
- **`docs/ideas-backlog.md`:** a Done entry for v0.15, and the fixed v0.13 minor is removed from item 7.
- **Build:** run `python scripts/build.py`. Only `0.15.0` ZIPs remain in `dist/`.
- **Do not commit;** the controller asks the user first.

## Verify

- `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs tests/selection.test.mjs tests/catalogues.test.mjs`
- `python -m unittest discover -s tests -p "test_*.py"`
- `python scripts/make_icons.py --check`
- `python scripts/build.py`
- `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`
- `node --check` on each changed `extension/*.js`
- `git grep -nE "(^|[^0-9.@])0\.14\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.
- The control-character grep from v0.14 prints nothing.
