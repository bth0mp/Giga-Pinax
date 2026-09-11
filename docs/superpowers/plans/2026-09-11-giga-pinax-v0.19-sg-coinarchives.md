# Giga Pinax 0.19 — Sear Greek (SG) references and a CoinArchives link

**Goal:** the user's request (2026-09-11): "Add coin archives as well to the search. Also add whatever this is. SG6829v". Release 0.19.0.

**The user's decision (2026-09-11):** CoinArchives joins as a **link button only**. It was chosen over folding CoinArchives prices into the median, which would need their permission first. Their free tier only shows the last six months.

## Findings (2026-09-11)

- **What SG is.** **SG** is Sear's *Greek Coins and Their Values*. **SG 6829** is the Seleucid Kingdom, Seleukos I Nikator (312–280 BC), silver tetradrachm; the acsearch lots that cite it are all that coin.
- **What dealers write.** On acsearch they cite it as **"Sear 6829"**, which finds 8 lots, one of them "Sear 6829, Var". `"SG 6829"` and `SG6829v` find none.
- **What the "v" means:** a variety.
- **No type data.** No open type database carries Sear numbers, so an SG reference stays prices-only (catalogue Other).
- **A known ambiguity.** "Sear NNNN" can also be a *Roman Coins and Their Values* (SRCV) number. The SG searches here returned only the Greek coin.
- **The CoinArchives search address:** `https://www.coinarchives.com/a/results.php?search=<words>&s=0`.
  - `s=0` is the simple mode; `s=1` is Boolean AND/NOT.
  - The FAQ says individual words work better than phrases.
  - `Nero 306` matched 9 lots.
- **The free and Pro tiers.** The free tier shows sales added in the last six months, prices included, and at most 100 results. The full database needs CoinArchives Pro.
- **Automated use.** The FAQ says nothing about it. Fetching CoinArchives automatically would need their permission first, as acsearch did; a link the user opens needs none.

## Design

### 1. SG references

These go in `lookup.js`, `lot.js` and `prices.js`.

- **Reading them.** `parseReference` reads `SG 6829`, `SG6829`, `SG 6829v`, `SG 6829 var.`, `SGCV 6829`, `GCV 6829` and `Sear Greek 6829`.
  - The result is an Other reference whose number is normalised to `SG 6829`, or `SG 6829 var.` when a `v` / `var.` suffix is given.
  - The card title is therefore `SG 6829 var.`.
  - The number is the digits plus an optional letter suffix (other than `v`), as in `SG 6829a`.
- **The acsearch term.** An SG part becomes `"Sear 6829"` and `"SG 6829"`, either-or: `("Sear 6829" "SG 6829")`. With other `;` parts, their phrases join the same group.
- **In lot text.** `findReferences` treats `SG`, `SGCV` and `GCV` as catalogue keys, with the same normalisation. A trailing `v` becomes the `var.` flag.

### 2. A CoinArchives link, opened only by the user

- **Where it goes.** The result card gets `Search on CoinArchives ↗` next to `Search on acsearch ↗`: `<a id="coinarchives-link" target="_blank" rel="noopener noreferrer">`.
- **Accessibility.** Its `aria-label` is `Search CoinArchives for ${term}, opens a new tab`.
- **The address.** The href is `coinArchivesUrl(coinArchivesTerm(reference))`, which is `https://www.coinarchives.com/a/results.php?search=<encoded>&s=0`.
- **The search text** comes from a pure `coinArchivesTerm(reference)` in `prices.js`: plain words, no quotes, no brackets.

  | Catalogue | Term |
  |---|---|
  | RIC | `${section without a trailing parenthetical} ${number}`, as `Nero 306` |
  | RRC | `Crawford ${n}` |
  | SC | `SC ${n}` |
  | Price | `Price ${n}` |
  | Bop | `${king's first name} Bopearachchi ${series}` |
  | SG | `Sear ${n}` |
  | Other | the first `;` part, without quotes and brackets |

- **It does not follow an edited acsearch term.** acsearch syntax (quotes, either-or brackets) doesn't carry over to CoinArchives.
- **Nothing is fetched.** There is no host permission and no request.

### 3. Docs and release 0.19.0

- **Version:** manifests, `tests/test_packages.py`, README, INSTALL (including "What to try": `SG6829v`, and the CoinArchives button) and the install page.
- **Backlog:** a Done entry.
- **Build and checks:** `python scripts/build.py`, then the usual checks. The stale check is now for `0.18.0`.

## Tests (TDD)

- **`lookup`:** each SG form above parses to the normalised Other reference.
- **`prices`:**
  - the SG term is `("Sear 6829" "SG 6829")`;
  - SG mixed with another `;` part;
  - `coinArchivesTerm` for each catalogue;
  - `coinArchivesUrl` encoding.
- **`lot`:** a lot line `… Seleukos I Nikator. Tetradrachm. SG 6829v; SC 1.` lists `SG 6829 · prices only · var.` and `SC 1`.
- **Popup:** checked by the controller in the browser.

## Verification (controller)

2026-09-11 on `http://localhost:8803`, a port never loaded before, at 440×680. It ran after the integrator's release step, while the reviews were running. numismatics.org was live and acsearch stubbed; no CoinArchives request was made.

**SG references:**
- `SG6829v` gives an Other card titled `SG 6829 var.`, reading "No open type data for this reference. Prices from acsearch only.".
  - Its acsearch term is `("Sear 6829" "SG 6829")`, and the Type link is hidden.
  - **Search on CoinArchives ↗** points to `https://www.coinarchives.com/a/results.php?search=Sear%206829&s=0`, with `target="_blank"`, `rel="noopener noreferrer"` and the aria-label "Search CoinArchives for Sear 6829, opens a new tab".
- `SG 6829` gives an Other card titled `SG 6829` (no `var.`), with the same term and link.

**CoinArchives search text on other cards:**

| Card | Search text |
|---|---|
| `Titus 123` | `Titus 123` |
| `Crawford 44/5` | `Crawford 44/5` (encoded `%2F`) |
| `Bop Hermaeus 20` | `Hermaeus Bopearachchi 20` |

**Lot text:** the Seleukid line `… Tetradrachm. SG 6829v; SC 1.` lists `SG 6829 · prices only · var.` and `SC 1`, and SC 1 (Seleucus I Nicator, tetradrachm) opens at once.

**Layout and console:**
- Body 400 px. The acsearch and CoinArchives buttons are stacked, each 334 px wide.
- 0 CoinArchives requests.
- The console is clean.

### Final pass: `http://localhost:8804`

After the review round's 10 fixes and the controller's own fix for the recheck's remaining regression (a typed reference now ends at its first number, so `Price 3949, 3950` is Price 3949 again). Never loaded before; node 151/151.

| Input | Result |
|---|---|
| `SG6829v` | the card `SG 6829 var.`, term `("Sear 6829" "SG 6829")`, CoinArchives link `search=Sear%206829&s=0` |
| `… SC 130.2; HGC 9, 18b (SG 6829v). Toned, VF.` | rows SC 130.2 (chosen), HGC 9, 18b, SG 6829 · var.; opens Seleucid Coins (part 1) 130.2 |
| `… Price 3949, 3950 (Müller 5). Good VF.` | rows Price 3949 (chosen) and Müller 5; opens Price 3949 |
| The biddr Titus lot | unchanged: opens RIC II, Part 1 (second edition) Vespasian 972 |
| `Titus 123` | unchanged |

- 0 CoinArchives requests on every card.
- Body 400 px; the console is clean.
