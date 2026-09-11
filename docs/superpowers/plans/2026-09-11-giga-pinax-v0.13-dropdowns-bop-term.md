# Giga Pinax v0.13 Dropdowns and a phrase-exact Bop acsearch term

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Two changes the user approved on 2026-09-11. (1) The default acsearch term for a Bopearachchi type becomes `(Hermaeus Hermaios) "Bopearachchi 20"`: the king's first name in both the Latin (BIGR) and Greek (dealer) spelling as an either-or group, and the series as an exact phrase, because acsearch ANDs every word anywhere in a lot (`Hermaeus Bopearachchi 20` found one wrong sale, "20" matching "20 mm") and most dealers write "Hermaios". (2) The RIC **Volume** and **Ruler or mint section** fields and the Bop **King** field become real `<select>` dropdowns fed by a bundled data module (12 OCRE volumes, 194 sections, 48 BIGR kings plus "Any king"), while everything that fills those fields from text (the one Reference box, right-click, Recent chips, "Did you mean") keeps working through an extra-option path. Release 0.13.0.

**Findings (2026-09-11):** acsearch syntax (acsearch.info/howto.html): quoted text is an exact phrase, `(a b)` is either-or, `*` is a wildcard, `-word` excludes. `buildSearchUrl` uses `URLSearchParams`, which encodes the term as `%28Hermaeus+Hermaios%29+%22Bopearachchi+20%22` (verified in Node). The four Greek-spelling rules (final `-us` → `-os`, `ae` → `ai`, `c` not before `h` → `k`, final `-o` → `-on`, in that order) reproduce all 24 changed and 8 unchanged names in the approved table and cover every first name of the 48 kings, so no explicit table is needed (the table lives in a test instead). **Remembered terms:** `rememberTerm(preferences, currentCard.id, term)` runs only in `runPrices(term, currency, { remember: true })`, i.e. only from the prices form's submit (**Get prices**), keyed by the card id (`bigr.hermaeus.20`), whether or not the term was edited; the automatic fetch after a lookup passes `remember: false` and stores nothing. So the old default `Hermaeus Bopearachchi 20` is on disk for a type exactly when the user pressed Get prices on it, and `renderCard` (`saved || defaultTerm(currentReference())`) would show it for ever. Handling: a remembered term that equals the v0.12-format default is treated as unsaved (pure `chooseTerm` in `prices.js`); nothing is deleted or migrated, and any edited term still wins. RIC data: OCRE's title forms are `I (second edition)`, `II`, `II, Part 1 (second edition)`, `II, Part 3 (second edition)`, `III`–`X`; `parseReference` emits `I (2nd edition)` / `II, Part 1 (2nd edition)` and `buildQuery` maps `2nd` → `second`, so the select values use the parse form and every one of the 194 `RIC {volume} {section} 1` titles round-trips through `parseReference` and `buildQuery` unchanged (verified). `RIC I Nero 306` and `RIC II.1 Titus 112` (edition left out) parse to volumes `I` / `II, Part 1`, which are not OCRE titles: today they reach the type through the one-item "Did you mean" list, and choosing it fills the fields from the full title; that path is unchanged, the selects simply show the chosen volume and section afterwards. The planned pure code and tests below were run against a scratch copy of the modules: 78/78 pass (71 existing with the one changed expectation, plus 7 new).

## Open points for the controller

- **Remembered term:** only **Get prices** remembers a term (any term, edited or not); README's "edited terms are remembered per type" is therefore slightly generous but not changed here. `chooseTerm` ignores a stored term only when it is exactly the v0.12 Bop default for the current king and series (`Hermaeus Bopearachchi 20`, `Bopearachchi 9C`, `Hermaeus Bopearachchi`); a stored v0.13 default or anything edited is kept. Storage is untouched, so the old value stays on disk until the next Get prices overwrites it.
- **Volume labels:** `I² (2nd ed.)`, `II`, `II.1² (2nd ed.)`, `II.3² (2nd ed.)`, `III`, `IV`, `V`, `VI`, `VII`, `VIII`, `IX`, `X` (plain `II` is the 1926 volume; the RIC II parts and RIC I in OCRE are all second editions). Values stay the existing field form (`I (2nd edition)`, `II, Part 1 (2nd edition)`), so stored preferences, parsed references and queries need no migration.
- **Bop king default stays `Euthydemus I`** (not "Any king"): the guided Look up then resolves to a card and fetches prices in one click as documented; "Any king" is one click away and produces a pick-list, never prices.
- **Section on volume change:** the current section is kept when the new volume has it (Rome, Antioch, Hadrian), else the first section is selected; for a volume outside the list (a parsed `IV, Part 1`, which has no sections) the current section is kept as the extra option.
- **Sorting:** sections exactly as in the data file (code-unit order); kings in code-unit order too, so `Heliocles I`, `Heliocles II` precede `Heliocles and Laodice`.
- **Prices line:** "9 sales matching “(Hermaeus Hermaios) "Bopearachchi 20"”" nests straight quotes inside the curly ones; accepted as is. The Copy summary text carries the same term.
- **In passing:** `restorePreferences` now falls back to `DEFAULT_SECTION[catalogue]` (King `Euthydemus I` for a saved Bop preference without a section) instead of `Nero`, the first minor of backlog item 7; one line, one test expectation. Backlog bookkeeping is left to the controller.
- A user-typed one-box king in Greek (`Hermaios Bop 20`) reaches BIGR as before (series fallback and pick-list); the chosen card refills King with BIGR's Latin name, so the term is `(Hermaeus Hermaios) "Bopearachchi 20"` again. Only a card without a lookup (none exist) would keep a Greek king; then the term is `Hermaios "Bopearachchi 20"`, which is still correct.

## Global Constraints

- No new permissions, host permissions or dependencies. One new extension file, `extension/catalogues.js` (bundled data plus two pure helpers), and one new test file, `tests/catalogues.test.mjs`. `textContent`/`value`/attributes and `new Option(label, value)`/`createElement`/`replaceChildren` only — never innerHTML with data, stored values or fetched text.
- Only numismatics.org and nomisma.org are contacted for lookups; the dropdown data is bundled and never fetched at runtime. acsearch behaviour and request count unchanged apart from the default term: one request per user action, only with access already granted, the term passed through the existing `buildSearchUrl`.
- RIC, RRC, SC, Price and Bop lookup logic (`lookup.js`) is untouched; `popup.js` changes only where named. All existing tests keep passing except the two expectations named below.
- Version `0.13.0` in manifests, package test and docs (digit-bounded stale check `(^|[^0-9.@])0\.12\.0`).
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output. When editing text that contains typographic characters (`’ “ ” ² – ·`), copy them from the file, and never write a literal control character into any file.

---

### Task 1: Dropdowns, Bop term, 0.13.0

**Files:** new `extension/catalogues.js`, new `tests/catalogues.test.mjs`; `extension/prices.js`, `extension/preferences.js`, `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `tests/prices.test.mjs`, `tests/preferences.test.mjs`, `scripts/build.py`, `tests/test_packages.py`, `manifests/brave.json`, `manifests/firefox.json`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour**

1. `extension/catalogues.js` (new; exact content — the data was generated from the verified SPARQL grouping and the BIGR title list, do not retype it by hand from memory):

   ```js
   // Static pick-lists for the guided fields, bundled with the extension and never fetched at runtime.
   // RIC volumes and sections: the nomisma.org SPARQL endpoint (https://nomisma.org/query) on 2026-09-11, query
   //   SELECT ?l WHERE { ?t a nmo:TypeSeriesItem ; skos:prefLabel ?l . FILTER(STRSTARTS(STR(?l), "RIC ")) }
   // grouped by volume and section with subtype noise removed: 12 volumes, 194 sections, each list in code-unit order.
   // Volume values are the form parseReference produces ("I (2nd edition)"); buildQuery turns them into OCRE's title form ("I (second edition)").
   // BIGR kings: the 57 distinct kings in BIGR's type titles ("Bactrian and Indo-Greek Coinage {king} {number}") the same day, minus data typos
   // ("Hermaues", "Theohpilus II", "Archebios") and subtype noise ("Eucratides I A.1", "Menander I14A"): 48, in code-unit order, so "Heliocles I" and
   // "Heliocles II" precede "Heliocles and Laodice". Both are American Numismatic Society data under the Open Database License (ODbL).

   export const RIC_VOLUMES = Object.freeze([
     { value: 'I (2nd edition)', label: 'I² (2nd ed.)' },
     { value: 'II', label: 'II' },
     { value: 'II, Part 1 (2nd edition)', label: 'II.1² (2nd ed.)' },
     { value: 'II, Part 3 (2nd edition)', label: 'II.3² (2nd ed.)' },
     { value: 'III', label: 'III' },
     { value: 'IV', label: 'IV' },
     { value: 'V', label: 'V' },
     { value: 'VI', label: 'VI' },
     { value: 'VII', label: 'VII' },
     { value: 'VIII', label: 'VIII' },
     { value: 'IX', label: 'IX' },
     { value: 'X', label: 'X' },
   ]);

   export const RIC_SECTIONS = Object.freeze({
     'I (2nd edition)': Object.freeze([
       'Augustus', 'Civil Wars', 'Claudius', 'Clodius Macer', 'Gaius/Caligula', 'Galba', 'Nero', 'Otho', 'Tiberius', 'Vitellius',
     ]),
     'II': Object.freeze([
       'Anonymous', 'Hadrian', 'Nerva', 'Trajan',
     ]),
     'II, Part 1 (2nd edition)': Object.freeze([
       'Domitian', 'Titus', 'Vespasian',
     ]),
     'II, Part 3 (2nd edition)': Object.freeze([
       'Hadrian',
     ]),
     'III': Object.freeze([
       'Antoninus Pius', 'Commodus', 'Marcus Aurelius',
     ]),
     'IV': Object.freeze([
       'Aemilian', 'Balbinus', 'Caecilia Paulina', 'Caracalla', 'Clodius Albinus', 'Didius Julianus', 'Elagabalus', 'Geta', 'Gordian I', 'Gordian II',
       'Gordian III', 'Gordian III (Caesar)', 'Jotapianus', 'Macrinus', 'Mar. Silbannacus', 'Maximinus Thrax', 'Maximus', 'Pacatianus', 'Pertinax',
       'Pescennius Niger', 'Philip I', 'Pupienus', 'Septimius Severus', 'Severus Alexander', 'Sponsianus', 'Trajan Decius', 'Trebonianus Gallus',
       'Uranius Antoninus', 'Volusian',
     ]),
     'V': Object.freeze([
       'Allectus', 'Amandus', 'Anonymous', 'Aurelian', 'Aurelian and Severina', 'Aureolus', 'Bonosus', 'Carausius',
       'Carausius issuing for Diocletian/Maximian', 'Carus', 'Claudius Gothicus', 'Diocletian', 'Domitianus of Gaul', 'Dryantilla', 'Florian',
       'Gallienus', 'Gallienus (joint reign)', 'Gallienus and Salonina', 'Gallienus and Saloninus', 'Laelianus', 'Macrianus Minor', 'Mariniana',
       'Marius', 'Postumus', 'Probus', 'Quietus', 'Quintillus', 'Quintus Julius Gallienus', 'Regalianus', 'Sabinus Julianus', 'Salonina', 'Saloninus',
       'Saturninus', 'Severina', 'Tacitus', 'Tetricus I', 'Vabalathus', 'Valerian', 'Valerian II', 'Valerian and Gallienus',
       'Valerian, Gallienus, Valerian II, and Salonina', 'Victorinus', 'Zenobia',
     ]),
     'VI': Object.freeze([
       'Alexandria', 'Antioch', 'Aquileia', 'Carthage', 'Cyzicus', 'Heraclea', 'Londinium', 'Lugdunum', 'Nicomedia', 'Ostia', 'Rome', 'Serdica',
       'Siscia', 'Thessalonica', 'Ticinum', 'Treveri',
     ]),
     'VII': Object.freeze([
       'Alexandria', 'Antioch', 'Aquileia', 'Arelate', 'Constantinople', 'Cyzicus', 'Heraclea', 'Londinium', 'Lugdunum', 'Nicomedia', 'Rome', 'Serdica',
       'Sirmium', 'Siscia', 'Thessalonica', 'Ticinum', 'Treveri',
     ]),
     'VIII': Object.freeze([
       'Alexandria', 'Amiens', 'Antioch', 'Aquileia', 'Arelate', 'Constantinople', 'Cyzicus', 'Heraclea', 'Lugdunum', 'Mediolanum', 'Nicomedia', 'Rome',
       'Sirmium', 'Siscia', 'Thessalonica', 'Treveri',
     ]),
     'IX': Object.freeze([
       'Alexandria', 'Antioch', 'Aquileia', 'Arelate', 'Constantinople', 'Cyzicus', 'Heraclea', 'Londinium', 'Lugdunum', 'Mediolanum', 'Nicomedia',
       'Rome', 'Sirmium', 'Siscia', 'Thessalonica', 'Treveri',
     ]),
     'X': Object.freeze([
       'Anthemius', 'Arcadius', 'Avitus', 'Basilicus', 'Basiliscus', 'Basiliscus and Marcus', 'Burgundians or Franks', 'Constantine III', 'Glycereius',
       'Honorius', 'Johannes', 'Jovinus', 'Julius Nepos', 'Leo I (East)', 'Leo I (West)', 'Leo II', 'Leo II and Zeno', 'Leontius', 'Libius Severus',
       'Majorian', 'Marcian', 'Maximus of Barcelona', 'Non-Imperial African', 'Odoacar', 'Olybrius', 'Petronius Maximus', 'Priscus Attalus',
       'Romulus Augustulus', 'Suevi', 'Theodosius II (East)', 'Theodosius II (West)', 'Valentinian III', 'Visigoths', 'Zeno', 'Zeno (East)',
       'Zeno (West)',
     ]),
   });

   export const BIGR_KINGS = Object.freeze([
     'Agathocles', 'Amyntas', 'Antialcidas', 'Antimachus I', 'Antimachus II', 'Antiochus Nicator', 'Apollodotus I', 'Apollodotus II', 'Apollophanes',
     'Archebius', 'Artemidorus', 'Demetrius I', 'Demetrius II', 'Demetrius III', 'Diodotus I or Diodotus II', 'Diomedes', 'Dionysius', 'Epander',
     'Eucratides I', 'Eucratides II', 'Euthydemus I', 'Euthydemus II', 'Heliocles I', 'Heliocles II', 'Heliocles and Laodice', 'Hermaeus',
     'Hermaeus and Calliope', 'Hippostratus', 'Lysias', 'Lysias and Antialcidas', 'Menander I', 'Menander II', 'Nicias', 'Pantaleon', 'Peucolaus',
     'Philoxenus', 'Plato', 'Polyxenus', 'Strato I', 'Strato I and Agathocleia', 'Strato II', 'Strato II and Strato III', 'Telephus', 'Theophilus I',
     'Theophilus II', 'Thrason', 'Zoilus I', 'Zoilus II',
   ]);

   // The king-less pick-list stays reachable from the guided fields: an empty king lists every king with the typed number.
   export const ANY_KING = Object.freeze({ value: '', label: 'Any king (list every king with that number)' });
   export const BOP_KINGS = Object.freeze([ANY_KING, ...BIGR_KINGS]);

   // The sections of a volume; none for a volume outside the list (a parsed "IV, Part 1") or an inherited key.
   export const sectionsOf = (volume) => (Object.hasOwn(RIC_SECTIONS, volume) ? RIC_SECTIONS[volume] : []);

   // The options a select shows for a value: the list (strings become { value, label }), plus the value itself, last, when it is not listed,
   // so a typed "Euthydemos", a parsed "IV, Part 1" or a stored section is shown and used exactly as it came. A blank value adds nothing.
   export function selectOptions(entries, value) {
     const options = entries.map((entry) => (typeof entry === 'string' ? { value: entry, label: entry } : entry));
     const wanted = String(value ?? '');
     return wanted && !options.some((option) => option.value === wanted) ? [...options, { value: wanted, label: wanted }] : options;
   }
   ```

2. `extension/prices.js`: replace the whole `defaultTerm` function (and its Bop comment) with the following block (`squash`, `bopSeries`, `referenceNumber` are already in scope; nothing else changes):

   ```js
   // Dealers mostly spell an Indo-Greek king in Greek ("Hermaios", "Eukratides") where BIGR spells it in Latin; four rules, in this order, cover every
   // BIGR first name (the table test lists them all): final -us to -os, ae to ai, c not before h to k, final -o to -on. Other names come back unchanged.
   export const greekName = (latin) => String(latin ?? '').replace(/us$/, 'os').replace(/ae/g, 'ai').replace(/c(?!h)/g, 'k').replace(/o$/, 'on');

   // The king's first name as BIGR spells it; the section field is the king ("Euthydemus I", "Diodotus I or Diodotus II").
   const firstName = (section) => squash(section).split(' ')[0];

   // acsearch ANDs every word anywhere in a lot ("20" matched "20 mm") and offers (a b) for either-or and "…" for an exact phrase, so the term is
   // the king in both spellings, "(Hermaeus Hermaios)" (one word when they agree: Menander), and the series as the exact phrase "Bopearachchi 20".
   // No series (an uncited BIGR type) leaves the bare word Bopearachchi; no king leaves the phrase alone.
   function bopTerm(section, number) {
     const latin = firstName(section);
     const greek = greekName(latin);
     const king = latin && greek !== latin ? `(${latin} ${greek})` : latin;
     const series = bopSeries(number);
     return squash(`${king} ${series ? `"Bopearachchi ${series}"` : 'Bopearachchi'}`);
   }

   export function defaultTerm({ catalogue, number, section }) {
     if (catalogue === 'RIC') return squash(`${squash(section)} ${squash(number)}`);
     if (catalogue === 'RRC') return squash(`Crawford ${referenceNumber('RRC', number)}`);
     if (catalogue === 'SC') return squash(`SC ${referenceNumber('SC', number)}`);
     if (catalogue === 'Bop') return bopTerm(section, number);
     return squash(`Price ${referenceNumber('Price', number)}`);
   }

   // v0.12's Bop default ("Hermaeus Bopearachchi 20") was stored under the type whenever Get prices ran, so it would hide the new default for good;
   // a remembered term that is exactly that old default counts as unsaved. Anything else the collector saved still wins.
   const oldBopTerm = ({ section, number }) => squash(`${firstName(section)} Bopearachchi ${bopSeries(number)}`);
   export function chooseTerm(reference, saved) {
     const term = squash(saved);
     if (!term || (reference.catalogue === 'Bop' && term === oldBopTerm(reference))) return defaultTerm(reference);
     return term;
   }
   ```

   The `…` in the second comment is the typographic ellipsis (U+2026), as elsewhere in the code; a plain `...` is fine too.

3. `extension/preferences.js`: `section: text(saved.section, DEFAULT_SECTION.RIC),` becomes `section: text(saved.section, DEFAULT_SECTION[catalogue] ?? DEFAULT_SECTION.RIC),` (the comment above `DEFAULT_SECTION` already says it). Nothing else changes; the allow-lists and `DEFAULT_SECTION` values stay.

4. `extension/popup.html`: in `#ric-fields` replace the two inputs with selects, keeping ids, names, labels and wrappers:

   ```html
   <div id="ric-fields" class="ric-fields" hidden>
     <div id="volume-field"><label for="ric-volume">Volume / edition</label><select id="ric-volume" name="volume"></select></div>
     <div><label id="section-label" for="ric-section">Ruler or mint section</label><select id="ric-section" name="section"></select></div>
   </div>
   ```

   No `<option>` markup: `popup.js` fills both from `catalogues.js`. Everything else in the file is unchanged.

5. `extension/popup.css`: `.ric-fields {display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; margin-bottom:10px;}` and `.ric-fields.single {grid-template-columns:minmax(0,1fr);}` (a `1fr` track has an `auto` minimum, so `Carausius issuing for Diocletian/Maximian` could widen the 400 px popup; `minmax(0,1fr)` cannot). Replace `.ric-fields input {font-size:12px;}` with `.ric-fields select {font-size:12px; text-overflow:ellipsis;}`. The shared `select,input {…}` rule already gives the selects the inputs' height, border, radius, padding, colours and `min-width:0`, so they look like the fields they replace.

6. `extension/popup.js`
   - Imports: `import { ACSEARCH_ORIGIN, buildSearchUrl, chooseTerm, defaultTerm, fetchPrices, quoteList, summaryText } from './prices.js';` and, after the preferences import, `import { BOP_KINGS, RIC_VOLUMES, sectionsOf, selectOptions } from './catalogues.js';`. (`defaultTerm` is no longer called in the popup; drop it from the import if the implementer prefers, but `chooseTerm` must be there.)
   - `REFERENCE_HELP.RIC` becomes `'Example: 306, with I² (2nd ed.) and Nero chosen above'` (copy the `²` from `RIC_VOLUMES`).
   - After `savePreferences` add:

     ```js
     // A select is rebuilt from its list plus the wanted value (selectOptions appends an unlisted one, so a typed "Euthydemos" or a parsed "IV, Part 1"
     // is shown and used exactly as it came), each option built with new Option(label, value), never markup; a blank value with no blank option shows the first.
     function fillSelect(select, entries, value) {
       select.replaceChildren(...selectOptions(entries, value).map((option) => new Option(option.label, option.value)));
       select.value = value;
       if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = 0;
     }

     // The Volume select always lists the RIC volumes; the section select lists the kings for Bop and the chosen volume's sections otherwise.
     function fillSelects(catalogue, volume, section) {
       fillSelect($('ric-volume'), RIC_VOLUMES, volume);
       fillSelect($('ric-section'), catalogue === 'Bop' ? BOP_KINGS : sectionsOf($('ric-volume').value), section);
     }
     ```

   - `fillFields` becomes:

     ```js
     function fillFields(parsed) {
       $('catalogue').value = parsed.catalogue;
       $('reference-number').value = parsed.number;
       // Only a RIC reference carries a volume and only RIC and Bop a section; the other catalogues leave the selects as they were.
       const volume = parsed.catalogue === 'RIC' ? parsed.volume : $('ric-volume').value;
       const section = parsed.catalogue === 'RIC' || parsed.catalogue === 'Bop' ? parsed.section : $('ric-section').value;
       fillSelects(parsed.catalogue, volume, section);
       updateFields();
     }
     ```

     (`run` still calls `fillFields({ catalogue: 'Bop', number: …, volume: '', section: outcome.card.bop.king })` for a BIGR card; the blank volume is now ignored, so a Bop lookup no longer touches the RIC volume.)
   - `renderCard`: replace `$('price-term').value = saved || defaultTerm(currentReference());` with `$('price-term').value = chooseTerm(currentReference(), saved);` (the `saved` line above it stays).
   - Start-up: replace the two lines `$('ric-volume').value = preferences.volume;` and `$('ric-section').value = preferences.section;` with `fillSelects(preferences.catalogue, preferences.volume, preferences.section);` (still before `updateFields()`; a stored value outside the lists appears only as an extra option, through `new Option`).
   - Catalogue `change` handler: replace `if (Object.hasOwn(DEFAULT_SECTION, $('catalogue').value)) $('ric-section').value = DEFAULT_SECTION[$('catalogue').value];` with `if (Object.hasOwn(DEFAULT_SECTION, $('catalogue').value)) fillSelects($('catalogue').value, $('ric-volume').value, DEFAULT_SECTION[$('catalogue').value]);` — the existing reset behaviour (number and section back to the catalogue's defaults, one-box cleared) is kept, and the section select is switched between kings and sections.
   - After the `currency` change listener (before the form `input` listener) add:

     ```js
     // A new volume lists its own sections: the current section stays when the volume has it (Rome, Hadrian), else the first is chosen; a volume outside the
     // list has no sections, so the current one is kept as the extra option. The form's input handler has already cleared the one-box and the output.
     $('ric-volume').addEventListener('change', () => {
       const sections = sectionsOf($('ric-volume').value);
       const current = $('ric-section').value;
       fillSelect($('ric-section'), sections, sections.length === 0 || sections.includes(current) ? current : sections[0]);
       savePreferences();
     });
     ```

     The form-level `input` listener is unchanged: a `<select>` fires `input` (then `change`) on a user choice in both browsers, and its `event.target.id` is `ric-volume` / `ric-section`, so a guided change still clears the one-box, clears the output, shows the "Reference changed" prompt and saves.
   - `updateFields`, `applyQuickReference`, `renderCandidates`, `renderRecent`, `run`, `runPrices`, the submit handlers and the right-click `?q=` path are unchanged. `required` stays `isRic` for both selects, so Bop with "Any king" (value `''`) passes `reportValidity` and reaches the king-less pick-list; `currentReference()` reads the selects' values as it read the inputs'.

7. `scripts/build.py`: `ASSET_PATHS` gains `"catalogues.js"` after `"prices.js"`. `tests/test_packages.py`: `ASSETS` gains `"catalogues.js"`, and both `0.12.0` occurrences (version assertion, ZIP name) become `0.13.0`.

8. Version 0.13.0 and docs:
   - `manifests/brave.json`, `manifests/firefox.json`: `"version": "0.13.0"` (description unchanged).
   - `README.md`: intro `Version **0.13.0**`; the guided-entry bullet becomes `- Guided entry for Price numbers, an RRC (Crawford) number, an SC (Seleucid Coins) number, a Bopearachchi king (a list of the 48 BIGR kings, or **Any king** to list every king with that number) and number, or a RIC volume and ruler or mint section chosen from lists of every OCRE volume and section, and number. A whole reference typed in the Reference box still sets the lists to exactly what it says.`; the prices bullet (`When a type resolves …`) gains the sentence `For Bopearachchi types the search starts as `(Hermaeus Hermaios) "Bopearachchi 20"`: the king in both spellings dealers use and the citation as an exact phrase.`; the checks block's node line becomes `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs tests/selection.test.mjs tests/catalogues.test.mjs`.
   - `docs/INSTALL.md`: every `0.12.0` → `0.13.0` (intro, two ZIP names in the block, Brave step 1, Firefox step 4). "What to try": the `**Price 23**, then **RIC I (2nd edition), Nero 306**.` line becomes `- **Price 23**, then catalogue **RIC** with **I² (2nd ed.)**, **Nero** and **306** from the lists; the volume and section lists hold every OCRE volume and section, and choosing **II.1² (2nd ed.)** lists Domitian, Titus and Vespasian.`; the Bop line's term becomes `"(Euthydemus Euthydemos) "Bopearachchi 24A"" — the king in both spellings and the citation as an exact phrase` and gains `; with **Any king** in the King list, a number alone does the same.` after `to choose from`; `**RIC I (2nd edition), Nero 9999999**` → `**RIC I² Nero 9999999**`; the `**RIC I, Nero 306** with the edition left out of the volume field` line becomes `- **RIC I Nero 306** typed in the Reference box with the edition left out: a short "Did you mean" list offers the full reference, and choosing it sets the lists.`
   - `install/index.html`: `0.12.0` → `0.13.0` in the eyebrow, the intro and both ZIP links; in "What to try", after the first paragraph's last sentence add `The RIC volume and section and the Bopearachchi king are lists now; for a Bopearachchi type the acsearch search uses both spellings of the king and the citation as an exact phrase, such as <strong>(Hermaeus Hermaios) "Bopearachchi 20"</strong>.`
   - Remove the stale `dist/giga-pinax-*-0.12.0.zip` after building.

**Tests**

`tests/preferences.test.mjs`, in the Bop test: `assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).section, 'Nero');` becomes

```js
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop' })).section, 'Euthydemus I');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Bop', section: 'Hermaeus' })).section, 'Hermaeus');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'Price' })).section, 'Nero');
```

`tests/prices.test.mjs`: the import becomes `import { buildSearchUrl, extractLots, parsePrice, defaultTerm, summarise, fetchPrices, summaryText, greekName, chooseTerm } from '../extension/prices.js';` plus `import { BIGR_KINGS } from '../extension/catalogues.js';`. Replace the whole last test (`defaultTerm uses the first word of the king, Bopearachchi and the series for Bop`) with:

```js
test('defaultTerm groups both spellings of the king and quotes the Bopearachchi series as an exact phrase', () => {
  const bop = (section, number) => ({ catalogue: 'Bop', section, number });
  assert.equal(defaultTerm(bop(' Hermaeus ', 'Bop 20')), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(defaultTerm(bop(' Euthydemus I ', 'Bop 24a')), '(Euthydemus Euthydemos) "Bopearachchi 24A"');
  assert.equal(defaultTerm(bop('Diodotus I or Diodotus II', '8A')), '(Diodotus Diodotos) "Bopearachchi 8A"');
  assert.equal(defaultTerm(bop('Strato I', '12')), '(Strato Straton) "Bopearachchi 12"');
  assert.equal(defaultTerm(bop('Menander I', '9C')), 'Menander "Bopearachchi 9C"');
  assert.equal(defaultTerm(bop('Hermaios', '20')), 'Hermaios "Bopearachchi 20"');
  assert.equal(defaultTerm(bop('', 'Bop-9C')), '"Bopearachchi 9C"');
  assert.equal(defaultTerm(bop('Hermaeus', '')), '(Hermaeus Hermaios) Bopearachchi');
  assert.equal(defaultTerm(bop('', '')), 'Bopearachchi');
});

// Latin (BIGR) first name to the Greek form dealers use; the unchanged names prove the rules leave them alone.
const GREEK = {
  Hermaeus: 'Hermaios', Euthydemus: 'Euthydemos', Eucratides: 'Eukratides', Philoxenus: 'Philoxenos', Antialcidas: 'Antialkidas',
  Agathocles: 'Agathokles', Heliocles: 'Heliokles', Apollodotus: 'Apollodotos', Demetrius: 'Demetrios', Diodotus: 'Diodotos',
  Antimachus: 'Antimachos', Zoilus: 'Zoilos', Hippostratus: 'Hippostratos', Artemidorus: 'Artemidoros', Nicias: 'Nikias',
  Archebius: 'Archebios', Peucolaus: 'Peukolaos', Polyxenus: 'Polyxenos', Theophilus: 'Theophilos', Telephus: 'Telephos',
  Dionysius: 'Dionysios', Antiochus: 'Antiochos', Strato: 'Straton', Plato: 'Platon',
  Menander: 'Menander', Lysias: 'Lysias', Amyntas: 'Amyntas', Epander: 'Epander', Thrason: 'Thrason', Pantaleon: 'Pantaleon',
  Diomedes: 'Diomedes', Apollophanes: 'Apollophanes',
};

test('greekName follows the four spelling rules for every BIGR first name', () => {
  assert.equal(Object.keys(GREEK).length, 32);
  for (const [latin, greek] of Object.entries(GREEK)) assert.equal(greekName(latin), greek, latin);
  const firstNames = new Set(BIGR_KINGS.map((king) => king.split(' ')[0]));
  assert.deepEqual([...firstNames].filter((name) => !Object.hasOwn(GREEK, name)), []);
  assert.equal(greekName(''), '');
  assert.equal(greekName(undefined), '');
});

test('buildSearchUrl encodes the parentheses and quotes of a Bop term', () => {
  assert.equal(buildSearchUrl({ term: '(Hermaeus Hermaios) "Bopearachchi 20"', currency: 'USD' }),
    'https://www.acsearch.info/search.html?term=%28Hermaeus+Hermaios%29+%22Bopearachchi+20%22&category=1&currency=usd&order=1');
  assert.equal(buildSearchUrl({ term: 'Menander "Bopearachchi 24A"', currency: 'EUR' }),
    'https://www.acsearch.info/search.html?term=Menander+%22Bopearachchi+24A%22&category=1&currency=eur&order=1');
});

test('chooseTerm keeps a remembered term unless it is blank or the v0.12 Bop default', () => {
  const hermaeus = { catalogue: 'Bop', section: 'Hermaeus', number: '20' };
  assert.equal(chooseTerm(hermaeus, 'Hermaeus Bopearachchi 20'), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(chooseTerm(hermaeus, ' Hermaeus  Bopearachchi 20 '), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(chooseTerm(hermaeus, 'Hermaios Bopearachchi 20 tetradrachm'), 'Hermaios Bopearachchi 20 tetradrachm');
  assert.equal(chooseTerm(hermaeus, '(Hermaeus Hermaios) "Bopearachchi 20"'), '(Hermaeus Hermaios) "Bopearachchi 20"');
  for (const blank of ['', '   ', undefined, null]) assert.equal(chooseTerm(hermaeus, blank), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(chooseTerm({ catalogue: 'Bop', section: '', number: '9C' }, 'Bopearachchi 9C'), '"Bopearachchi 9C"');
  assert.equal(chooseTerm({ catalogue: 'Bop', section: 'Hermaeus', number: '' }, 'Hermaeus Bopearachchi'), '(Hermaeus Hermaios) Bopearachchi');
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306' };
  assert.equal(chooseTerm(nero, 'Nero 306'), 'Nero 306');
  assert.equal(chooseTerm(nero, 'Nero 306 denarius'), 'Nero 306 denarius');
  assert.equal(chooseTerm(nero, ''), 'Nero 306');
  assert.equal(chooseTerm({ catalogue: 'Price', number: '23' }, undefined), 'Price 23');
});
```

`tests/catalogues.test.mjs` (new; the `’` in the second test name is the typographic apostrophe used elsewhere, a plain `'` escaped or a different wording is fine):

```js
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
```

(These seven new cases and the two changed expectations were run against a scratch copy of `prices.js`, `preferences.js` and the new `catalogues.js` on 2026-09-11: 78/78 pass, every other existing test unchanged.)

**Verify:** new tests fail first for the expected reasons (`catalogues.js` missing, `greekName`/`chooseTerm` not exported, the old Bop term, King `Nero`); then `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs tests/selection.test.mjs tests/catalogues.test.mjs` 78/78 (71 + 7), `python -m unittest discover -s tests -p "test_*.py"` 9 OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check` on each of `extension/catalogues.js`, `extension/prices.js`, `extension/preferences.js`, `extension/popup.js`, `git grep -nE "(^|[^0-9.@])0\.12\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing, and `git grep -nP '[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]' -- ':!*.png' ':!*.zip'` prints nothing. Confirm `dist/` holds only `0.13.0` ZIPs and that `dist/brave/catalogues.js` exists.

**Commit** the seventeen files (two new): `Add volume, section and king dropdowns, a phrase-exact Bop acsearch term and release 0.13.0`.

## Verification (controller)

Result 2026-09-11 at `bf52fab`, in-app Chromium 440×680 on `http://localhost:8791` (never loaded before), live numismatics.org; acsearch is unreachable from a plain tab (CORS), so each acsearch URL is the attempted fetch:

- Volume select: 12 options `I² (2nd ed.)=I (2nd edition)` … `X=X`; I² lists the 10 sections; II.1² lists Domitian/Titus/Vespasian (section moves to Domitian); V lists 43; with `Carausius issuing for Diocletian/Maximian` selected the body stays 400 px (selects 175 px). Bop → King select with 49 options, first `Any king (list every king with that number)` (value `''`), default `Euthydemus I`, volume hidden. Pass.
- Catalogue back to RIC with volume VI → section `Nero` appended after `Treveri` (the implementer's concern, review Important 1): fixed in the fix round, re-checked below.
- `?q=RIC II.1² Titus 112` → `RIC II, Part 1 (second edition) Titus 112`, selects `II.1² (2nd ed.)` / `Titus` (3 options), term `Titus 112`. Pass.
- `?q=RIC IV.1 Caracalla 123` → not found in OCRE (quoted, then plain search, as before); volume shows the extra option `IV, Part 1`, section `Caracalla`. Pass.
- `?q=Bop Hermaeus 20` → card `… Hermaeus 20`, citation `Bopearachchi Hermaios 20`, King `Hermaeus`, term `(Hermaeus Hermaios) "Bopearachchi 20"`, acsearch `…term=%28Hermaeus+Hermaios%29+%22Bopearachchi+20%22…`. Pass.
- `?q=Bop Menander I 9C` → `… Menander I 17.3`, citation `Bopearachchi Ménandre I 9C`, term `Menander "Bopearachchi 9C"`. Pass.
- `?q=Bop-9C` → the eight labelled types, King shows `Any king …`; fields Bop / Any king / `9C` + Look up → the same eight (1 search, 16 `.xml`). Pass.
- Stored v0.12 term `Hermaeus Bopearachchi 20` for `bigr.hermaeus.20` → shown and fetched as `(Hermaeus Hermaios) "Bopearachchi 20"`; a stored edited `Hermaios Bopearachchi 20 tetradrachm` → kept and fetched. Pass.
- Recent chips with the form on Price: `RIC II, Part 1 (second edition) Titus 112` → RIC / `II.1² (2nd ed.)` / `Titus` / `112`; `… Menander I 17.3` → Bop / `Menander I` / `9C`, term `Menander "Bopearachchi 9C"`. Pass.
- `Crawford 44/5`, `SC 1266.2`, `Price 23` unchanged. Console: only the acsearch CORS lines. Pass.

Fix round `308192c`, re-checked on `http://localhost:8792` (never loaded before):

- RIC with volume VI → Price → RIC, and VI → Bop → RIC: `I² (2nd ed.)` / `Nero` / `306`, the ten I² sections, no extra option. Pass.
- Bop with `Any king`, then `Price 23` in the box: catalogue Price, number `23`, stored section still `''`, hidden King select untouched. Pass.
- `Bop Hermaeus 20` → term `(Hermaeus Hermaios) "Bopearachchi 20"`; `RIC II.1² Titus 112` → `II.1² (2nd ed.)` / `Titus`. Console: only the acsearch CORS lines. Pass.

Planned checks:

In a served tab on a never-loaded localhost origin (never-cached), 440×680 window (popup body 400 px), live numismatics.org; acsearch is unreachable from a plain tab (CORS), so each "1 acsearch" is the attempted fetch:

- Catalogue **RIC** → `#ric-volume` is a `<select>` with exactly 12 options labelled `I² (2nd ed.)`, `II`, `II.1² (2nd ed.)`, `II.3² (2nd ed.)`, `III`, `IV`, `V`, `VI`, `VII`, `VIII`, `IX`, `X` (values `I (2nd edition)`, `II`, `II, Part 1 (2nd edition)`, …); `#ric-section` lists the 10 sections of volume I with `Nero` selected; help text `Example: 306, with I² (2nd ed.) and Nero chosen above`. Choosing `II.1² (2nd ed.)` relists the section select as Domitian / Titus / Vespasian (Domitian selected), clears the one-box and shows "Reference changed"; choosing `V` then `VI` keeps nothing (first section), choosing `VII` after picking `Rome` in `VI` keeps `Rome`. No network request.
- `RIC II.1 Titus 112` in the Reference box → selects show an extra option `II, Part 1` and section `Titus`; Look up runs the quoted then plain search and offers `RIC II, Part 1 (second edition) Titus 112`; choosing it resolves the card and the selects show `II.1² (2nd ed.)` / `Titus` with no extra option left (the volume list is 12 again). `RIC IV.1 Caracalla 123` → extra option `IV, Part 1`, section `Caracalla` alone, the existing suggestion path (or not-found) as in v0.12, no error in the console.
- Catalogue **Bop** → `#ric-section` labelled `King`, full width, 49 options: `Any king (list every king with that number)` (value `''`) first, then the 48 kings from `Agathocles` to `Zoilus II` in that order, with `Euthydemus I` selected and number `24A`; the volume select hidden. Back to RIC → volume shown, 12 volumes, section list of the current volume with `Nero`.
- `Bop Hermaeus 20` in the box → fields Bop / `Hermaeus` / `20`; card `bigr.hermaeus.20` with citation `Bopearachchi Hermaios 20`; `#price-term` is `(Hermaeus Hermaios) "Bopearachchi 20"`; the acsearch link and the attempted fetch use `term=%28Hermaeus+Hermaios%29+%22Bopearachchi+20%22`; 1 acsearch.
- `Bop Menander I 9C` → card, term `Menander "Bopearachchi 9C"`. `Euthydemos Bop 24A` → the pick-list as in v0.12; the King select shows the extra option `Euthydemos` until a choice refills it with `Euthydemus I`, after which the term is `(Euthydemus Euthydemos) "Bopearachchi 24A"`.
- `Bop-9C` in the box → the eight-item pick-list as in v0.12. King **Any king** + number `9C` via the fields → Look up passes validity and gives the same pick-list (one search `?q=9C`); choosing `Bopearachchi Philoxène 9C (Philoxenus 6.3)` sets King `Philoxenus` and the term `(Philoxenus Philoxenos) "Bopearachchi 9C"`.
- Remembered term: with the form on `bigr.hermaeus.20`, set `localStorage['giga-pinax-preferences-v1']` so that `terms['bigr.hermaeus.20']` is `Hermaeus Bopearachchi 20` (or press Get prices in v0.12 first), reload → the card shows `(Hermaeus Hermaios) "Bopearachchi 20"`. Store `Hermaios tetradrachm` instead → it is shown unchanged.
- Recent chips: a chip for `RIC I (second edition) Nero 306` with the form on Bop → selects RIC / `I² (2nd ed.)` / `Nero`, term `Nero 306`; a chip for `Bactrian and Indo-Greek Coinage Hermaeus 20` with the form on Price → Bop / King `Hermaeus` / `20`, term `(Hermaeus Hermaios) "Bopearachchi 20"`.
- Preferences: close/reopen with catalogue Bop and King `Hermaeus` → `Hermaeus` selected; with a stored `section` of `<b>x</b>` (set in localStorage) → an extra option whose text is the literal `<b>x</b>` (no bold), and `document.querySelector('#ric-section b')` is null.
- Existing `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2`, `Price 23` unchanged (cards, terms, request shapes as in v0.12); `RIC I Nero 306` still offers `RIC I (second edition) Nero 306`.
- Width: with volume `V` and section `Carausius issuing for Diocletian/Maximian` selected, `document.body.scrollWidth` is 400 and the section select is clipped, not overflowing; the Bop King select with `Any king (list every king with that number)` likewise.
- Only numismatics.org, nomisma.org and acsearch requested (no request for any catalogue data); console clean apart from the expected plain-tab acsearch CORS lines; `dist/brave/manifest.json` version `0.13.0`.
