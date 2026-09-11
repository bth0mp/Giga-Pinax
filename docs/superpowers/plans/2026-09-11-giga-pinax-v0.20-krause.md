# Giga Pinax 0.20 — Krause (KM#) references

**Goal:** the user's request (2026-09-11): "include Krause Catalog". Release 0.20.0.

Krause is the *Standard Catalog of World Coins* (Krause & Mishler), whose **KM#** numbers are the standard reference for world and modern coins. This is the first non-ancient catalogue in Giga Pinax, so the prices search has to move to acsearch's modern category and CoinArchives' world section.

## Findings (2026-09-11, logged-out probes)

- **acsearch categories** (from its own search form): `0` All, `1-2` Coins, **`1` Ancient coins**, **`2` Modern coins**, `3` Banknotes, `4` Orders & Decorations, `8` Numismatic Literature, `9` Antiquities. Giga Pinax has always sent `category=1`.
- **KM belongs in category 2.** `"KM 123"` finds 107 lots there and only 3 in Ancients.
- **The `#` is ignored:** `"KM# 123"` and `"KM 123"` return the same 107 lots.
- **The Krause/Mishler spelling adds lots:** `"Krause/Mishler 123"` finds 16, mostly German auctions, that the `"KM 123"` phrase misses. Both cite the same coins (Bolivia 4 Soles 1857, Netherlands 2½ Gulden 1898).
- **`Krause 123` without a phrase is unreliable:** 77 lots, matching things like "Krause/Mishler 161" where the number came from elsewhere.
- **A KM number repeats across countries.** Those 107 lots include the Netherlands, Rostock and Bolivia. Adding the country narrows it properly: `Netherlands "KM 123"` gives 66, all Dutch.
- **CoinArchives has a world section:** `https://www.coinarchives.com/w/results.php?search=KM+123&s=0` matched 875 lots. The ancient section is `/a/`.
- **No open type data** carries KM numbers (Numista has them behind an API key), so a KM reference is prices-only, like SG.

## Design

### 1. Reading a KM reference

In `lookup.js`, beside the SG reader:
- **Forms:** `KM# 123`, `KM 123`, `KM#123`, `KM-123`, `KM.123`, `KM# 123.2`, `KM# 123.2a`, `KM# A123`, and the catalogue's letter prefixes (`Pn`, `Tn`, `E`, `PS`, `M`, `X#`, `Y#`, `C#` are **out of scope**: only `KM` with an optional single leading letter).
- **The number** is digits, then an optional `.n` and an optional letter: `123`, `123.2`, `123.2a`, `A123`.
- **Normalised** to `KM# 123.2a`, as the catalogue writes it.
- **A country, when typed before it** (`Netherlands KM# 123`, `German States Rostock KM# 123`), is kept in front: the reference number becomes `Netherlands KM# 123`. Up to 4 words, letters only.
- The result is an Other reference (prices only): `{ catalogue: 'Other', number: 'Netherlands KM# 123', volume: '', section: '' }`.

### 2. The acsearch search

- **The term** for a KM part is the either-or of the two spellings, with the country words in front when there are any:
  - `KM# 123` → `("KM 123" "Krause/Mishler 123")`
  - `Netherlands KM# 123` → `Netherlands ("KM 123" "Krause/Mishler 123")`
  - The number keeps its suffix: `KM# 123.2a` → `("KM 123.2a" "Krause/Mishler 123.2a")`.
- **The category follows the reference.** `buildSearchUrl` takes a `category`, and a new `searchCategory(reference)` in `prices.js` returns `'2'` for a reference whose parts are all KM, and `'1'` otherwise. Both `fetchPrices` and the acsearch link use it.
- **Mixed parts** (`KM# 123; SG 6829`) stay category `1`, since only an all-KM reference is certainly modern.

### 3. The CoinArchives link

- `coinArchivesUrl(term, section)` builds `https://www.coinarchives.com/${section}/results.php?search=<encoded>&s=0`, with `section` `'w'` for a KM reference and `'a'` otherwise.
- `coinArchivesTerm` for KM gives plain words: `Netherlands KM 123`.

### 4. Lot text

`lot.js` gains `KM` as a catalogue key (`KM#`, `KM-` and `KM.` spellings), normalised the same way, listed as a prices-only row. A country before it inside a lot is **not** taken, since a lot's heading is not a reference.

### 5. Docs and release 0.20.0

- **Version:** manifests, `tests/test_packages.py`, README, INSTALL ("What to try": `Netherlands KM# 123`) and the install page.
- **Say what it is:** a KM reference searches acsearch's **modern coins** and CoinArchives' **world** section, and a country makes the median far tighter.
- **Backlog:** a Done entry.
- **Build and checks:** `python scripts/build.py`, then the usual checks; the stale check is now for `0.19.0`.

## Tests (TDD)

- **`lookup`:** every KM form above; `KM` inside a word is never a reference; a country prefix is kept; `KM# 123; SG 6829` keeps both parts.
- **`prices`:**
  - the KM term, with and without a country, and with a suffixed number;
  - `searchCategory`: KM `'2'`, RIC/SG/Other `'1'`, mixed `'1'`;
  - `buildSearchUrl` with a category;
  - `coinArchivesTerm` and `coinArchivesUrl` with the `w` section for KM and `a` otherwise.
- **`lot`:** a lot line `Netherlands. 2½ Gulden 1898. KM# 123; Scholten 782.` lists `KM# 123` (prices only) and `Scholten 782`.
- **Popup:** checked by the controller in the browser.

## Verification (controller)

2026-09-11 on `http://localhost:8805`, a port never loaded before, at 440×680. It ran after the integrator's release step, while the reviews were running. numismatics.org was live and acsearch stubbed; the stub recorded the URL actually fetched, so the category below is the real request, not just the link.

| Input | Card | acsearch category and term | CoinArchives |
|---|---|---|---|
| `KM# 123` | `KM# 123` | **2**, `("KM 123" "Krause/Mishler 123")` | `w` section, `KM 123` |
| `Netherlands KM# 123` | `Netherlands KM# 123` | **2**, `Netherlands ("KM 123" "Krause/Mishler 123")` | `w`, `Netherlands KM 123` |
| `KM#123.2a` | `KM# 123.2a` | **2**, `("KM 123.2a" "Krause/Mishler 123.2a")` | `w`, `KM 123.2a` |
| `SG6829v` | `SG 6829 var.` | **1**, `("Sear 6829" "SG 6829")` | `a`, `Sear 6829` |
| `Titus 123` | RIC II, Part 1 (second edition) Titus 123 | **1**, `Titus 123` | `a`, `Titus 123` |

**Lot text and mixed references:**
- `Netherlands. 2½ Gulden 1898, P. Pander. KM# 123; Scholten 782. Toned EF.` lists `KM# 123 · prices only` and `Scholten 782 · prices only`, and fetches nothing.
- `KM# 123; SG 6829` typed in the Reference box names two catalogues, so it takes the lot path and lists both rows rather than making one mixed Other card. The plan's mixed-reference rule (category 1) therefore applies to the guided **Other** field.

**Layout and console:** body 400 px; the console is clean.

### Final pass: `http://localhost:8806`

After the review round's 8 fixes and the controller's own fix for the recheck's remaining crash. Never loaded before; node 157/157.

**The crash:** `kmNumber` read its number back with an ASCII-only pattern while the key pattern matched case-insensitively over Unicode, so a letter that folds to ASCII (KELVIN SIGN, long s) reached a `null` match and threw, killing the Reference box with no message. The read is now Unicode and guarded, failing closed like `sgNumber`.

| Input | Card | acsearch | CoinArchives |
|---|---|---|---|
| `KM-K5` (KELVIN SIGN) | `KM# K5` | **2**, `("KM K5" "Krause/Mishler K5")` | `w`, `KM K5` |
| `Württemberg KM# 123` | `Württemberg KM# 123` | **2**, `Württemberg ("KM 123" "Krause/Mishler 123")` | `w`, `Württemberg KM 123` |
| `KM# 123` | `KM# 123` | **2** | `w` |
| `Netherlands KM# 123` | country kept | **2** | `w`, `Netherlands KM 123` |
| `SG6829v` | `SG 6829 var.` | **1** | `a` |
| `Titus 123` | RIC II, Part 1 (second edition) Titus 123 | **1** | `a` |
| The biddr Titus lot | lists its three references, opens Vespasian 972 | **1** | `a` |

- Body 400 px; the console is clean.
- `dist/brave/lookup.js` matches the source; `dist/` holds only the 0.20.0 ZIPs.
