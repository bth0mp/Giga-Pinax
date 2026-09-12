# Install Giga Pinax

Version **0.24.0** looks up RIC, RRC, SC, Bopearachchi and Price coin types from the American Numismatic Society's open OCRE, CRRO, SCO, BIGR and PELLA datasets and fetches recent hammer prices from acsearch with your own account. Paste or right-click a whole lot description and it lists every catalogue reference in it. Sear Greek references such as `SG6829v` and Krause world-coin references such as `Netherlands KM# 123` and `Russia Y# 59.3` get acsearch prices, and every card has a **Search on CoinArchives ↗** button. It contacts `numismatics.org` and `nomisma.org` when you look up a type (**Look up**, a choice from a list or a **Recent** chip), and `www.acsearch.info` when a type resolves (**Look up**, a choice from a list or a **Recent** chip) or you select **Get prices**. A reference without open type data (catalogue **Other**) contacts only `www.acsearch.info`. Nothing else is contacted (an RPC reference's **RPC online** link and the **Search on CoinArchives** button open only when you select them) and nothing from acsearch is stored.

The extension now asks for one browser permission, `contextMenus`, to add a **Look up “…” in Giga Pinax** item to the right-click menu when you select text. Selected text is sent only when you choose that item, and only to `numismatics.org` (and `www.acsearch.info` for prices, as before).

## Build the packages

From the repository root, run:

```powershell
python scripts/build.py
```

The command creates these unpacked directories and matching ZIP archives:

```text
dist/brave/
dist/firefox/
dist/giga-pinax-brave-0.24.0.zip
dist/giga-pinax-firefox-0.24.0.zip
```

Run the same command again whenever an extension asset or manifest changes. You can build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

## Test in Brave

1. Use `dist/brave`, or unzip `dist/giga-pinax-brave-0.24.0.zip` into its own folder.
2. Open `brave://extensions` in Brave.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder that contains `manifest.json`.
5. Open Giga Pinax from Brave's extensions menu. Pin it if you want its button to remain on the toolbar.

Brave grants access to `numismatics.org`, `nomisma.org` and `www.acsearch.info` at install.

**Already installed?** Rebuild, then select **Reload** on Giga Pinax at `brave://extensions`. If you loaded an extracted copy, replace its files with the new ZIP's contents first. Reopen the toolbar popup to use the update.

## Test temporarily in Firefox

Use Firefox 142 or later.

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on**.
4. Choose `dist/firefox/manifest.json`, or `dist/giga-pinax-firefox-0.24.0.zip`.
5. Open Giga Pinax from Firefox's extensions menu.

Firefox normally grants access to `numismatics.org`, `nomisma.org` and `www.acsearch.info` when you install the extension. If you later turn that access off in about:addons, selecting **Look up** or **Get prices** asks for it again; if the popup closes while Firefox is asking, reopen it and select the same button.

Firefox removes a temporary add-on when Firefox restarts. Permanent installation needs a Mozilla-signed build; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

**Already installed temporarily?** After rebuilding, select **Reload** for Giga Pinax under **This Firefox** at `about:debugging`, or load the updated ZIP again.

## What to try

- Type **RIC I² Nero 306** in the Reference box and select **Look up**; the RIC fields fill in and the type resolves.
- Select **RIC I² Nero 306** on any web page, right-click and choose **Look up “RIC I² Nero 306” in Giga Pinax**. Drag the window it opens to make it longer or wider.
- With that window still open, right-click another reference, such as **Craw. 44/5** or a reference copied from an auction page: the same window looks it up and comes to the front, rather than a second window opening. Dealer abbreviations (**Craw.**, **Crawf.**), a trailing **;** and the hidden characters auction pages add are read.
- Paste a whole lot description from biddr into the Reference box, such as **TITUS, AD 69-79. AR, Denarius. Rome. Obv: T CAESAR VESPASIANVS. Head of Titus, laureate, right. Rev: ANNONA AVG. Ref: RIC 972; Cohen 17; BMC 319.**, and select **Look up**: the three references are listed as **RIC 972 · Titus**, **Cohen 17 · prices only** and **BMC 319 · prices only**, and because only RIC has type data it opens at once as RIC II.1² Vespasian 972, Titus's denarius as Caesar, found from the ruler in the heading. Select **Cohen 17** to get its acsearch prices instead. Selecting the same text on biddr and right-clicking does the same in the lookup window. A lot with several RIC, RRC, SC, Bop or Price references fetches nothing until you pick one.
- Select the window button (a square with an arrow) in the header: Giga Pinax opens on the type it was showing, in the window already open or in a new one, and you can drag that window to any size.
- **Price 23**, then catalogue **RIC**, and type **Titus** in **Ruler or mint section**: it is suggested as you type, from every OCRE volume, and the volume becomes **II.1² (2nd ed.)** by itself. With number **123**, **Look up** finds RIC II.1² Titus 123. A blank volume or ruler means any.
- **RIC 972** in the Reference box: a list of the six types numbered 972, from Vespasian (II.1²) to Zeno (X); choosing one sets the fields, and its acsearch search follows it (for example "Hadrian 972").
- **RRC 44/5** — an anonymous Roman Republican denarius; its acsearch search starts as "Crawford 44/5".
- **SC 1266.2** — a tetradrachm of Demetrius II from Antioch; **SC 1266.9** doesn't exist and offers **SC 1266** instead.
- **Bop Euthydemus I 24A** — a bronze of Euthydemus I of Bactria; the card shows its BIGR type and the citation **Bopearachchi Euthydème I 24A**, and its acsearch search starts as `(Euthydemus Euthydemos) "Bopearachchi 24A"` — the king in both spellings and the citation as an exact phrase. **Bop 9C** alone lists every king with a 9C series to choose from; with the **King** left blank, a number alone does the same. Each lookup checks its matches against numismatics.org in one request; if that fails, the popup says it couldn't reach numismatics.org instead of "not found".
- **BCD Boiotia 174b; HGC 4, 1218** — choose the catalogue **Other (prices only)** and type it in the reference field: neither has open type data, so the card says so, and acsearch is searched for the lots that cite either reference, each as an exact phrase: `("BCD Boiotia 174b" "HGC 4, 1218")`. Any other reference (SNG, Sear, RPC…) works the same way. Typed in the **Reference** box instead, a `;` list is listed reference by reference (prices-only rows, nothing fetched until you pick one), and a single RIC, RRC, SC, Bop or Price reference among them is looked up at once.
- **RPC I 1234** — priced the same way, and the card also has an **RPC online ↗** link to that coin's page on RPC Online (**RPC V.2 1234** goes to part 2 of volume V). It opens only when you select it; Giga Pinax never contacts RPC itself.
- **SG6829v** in the Reference box — a Sear *Greek Coins and Their Values* number with a variety `v`: it reads as **SG 6829 var.**, catalogue **Other (prices only)**, since no open type data carries Sear numbers, and acsearch is searched as `("Sear 6829" "SG 6829")`, the two ways dealers cite it. `SG 6829`, `SGCV 6829`, `GCV 6829` and `Sear Greek 6829` read as **SG 6829**, with the same acsearch search; in a pasted lot, `SG 6829v; SC 1` lists **SG 6829 · prices only · var.** and opens **SC 1**.
- **Netherlands KM# 123** in the Reference box — a Krause & Mishler *Standard Catalog of World Coins* number, the reference for world and modern coins: it reads as catalogue **Other (prices only)**, since no open type data carries KM numbers, and acsearch is searched in its **Modern coins** category (not Ancients) as `Netherlands ("KM 123" "Krause/Mishler 123")` — the two spellings dealers cite, either of them. The same number is used in several countries, so the country you type in front is kept and makes the median far tighter; **KM# 123** alone searches all of them. `KM 123`, `KM#123`, `KM-123`, `KM.123`, `KM# 123.2a` and `KM# A123` all read as KM, and Krause's older Y numbering reads and searches the same way (`Y# 31`, `Russia Y# 59.3`, searched as `Russia ("Y 59.3" "Y# 59.3")`), and **Search on CoinArchives ↗** opens that site's **world** section for a KM reference. In the guided **Other** field, mixed with an ancient reference (`KM# 123; SG 6829`) the search stays in Ancients; typed in the Reference box the same text is listed reference by reference, each row searched on its own.
- On any card, select **Search on CoinArchives ↗**, under **Search on acsearch ↗** in the toolbar popup and beside it in the right-click window: CoinArchives opens in a new tab on its own search for the reference in plain words (`Sear 6829` for the card above, `Crawford 44/5` for **RRC 44/5**). It is only a link; Giga Pinax fetches nothing from CoinArchives. Without a CoinArchives subscription its results cover about the last six months.
- **Look up** fetches prices too. If you are not signed in on acsearch, the popup says so with a sign-in link; sign in with an account that includes hammer prices, then select **Get prices**.
- If the popup says no hammer prices could be counted, it quotes up to five prices exactly as acsearch showed them — send that line so the price reader can learn the format.
- Edit the acsearch search term (for example add the denomination) and select **Get prices** again; the term is remembered for that type.
- When RIC files a type under a different ruler from the one on its portrait, one line under the type's title says so, for example **Portrait of Titus, listed under Vespasian.** (RIC files a Caesar's coins in the reigning emperor's section). Where the volume splits that ruler in two, the same line adds which other section exists, for example **RIC V also has a Gallienus (joint reign) section.** — only after the first sentence, so an ordinary card stays quiet. It appears only when the portrait is a ruler RIC itself heads a section with and the card's own section is that ruler, so nothing shown doesn't mean the portrait is the section's ruler: a deity, a name nomisma spells differently, or a volume filed by mint (RIC VI–IX) all stay silent.
- The period buttons and then the median hammer price sit right under the type's title, and the obverse and reverse are folded under **Obverse and reverse** (select it to open them). The line under the median says how far to trust it, for example **Solid: 22 sales, 2024–2026** — Thin for 1–4 sales, Moderate for 5–14, Solid for 15 or more — and, below the trend and **Last sale** lines, a line says how many matches it was drawn from.
- Above the median, select **Last 2 years**: the median, the line saying how far to trust it, the middle 50%, the lowest and highest sale, **Check a price** (a typed amount stays and is checked again) and **Inspect sales** redraw from the sales already fetched, without asking acsearch again, and the matches line reads, for example, **Out of 12 matches from the last 2 years for “Nero 306”**. **Last 5 years** works the same way, and **All** brings back every sale. The choice is remembered the next time you open Giga Pinax. When no sale in the period has a price, the panel says **No sales with a price in the last 2 years.**
- Under the median, a line compares the last 2 years with earlier sales, for example **Last 2 years: $250 median, up 18% on earlier sales ($212)**; within 5% it reads **about the same**. It appears only when both sides have at least 3 sales. Under it, **Last sale** shows the date and price of the most recent sale; select the date to open that lot on acsearch. Neither line changes with the period.
- Under **Middle 50% of sales**, the panel prints the lowest and highest sale, for example **All 22 sales $81–$950**; a quarter of the sales lie above the middle 50%. Lots acsearch lists without a price are counted apart ("2 without a price") from prices the popup couldn't count.
- Type a bid or an asking price, such as **500**, in **Check a price**: the line under it says how many of the counted sales it tops and its multiple of the median, for example "Higher than 16 of 23 sales, 1.6× the median", and a mark shows where it falls on the range bar; beyond the lowest or highest sale the mark waits at that end with an arrow pointing out. Nothing is stored, and a new lookup or currency starts it empty.
- Expand **Inspect sales** to see each sale with a link to it on acsearch.
- Select **Copy summary** at the bottom of the prices panel and paste it anywhere. With **Last 5 years** or **Last 2 years** chosen it names the period, and it carries the last sale and the trend too.
- A number that doesn't exist, such as **RIC I² Nero 9999999**: the popup says it was not found rather than inventing a result.
- **RIC I Nero 306** typed in the Reference box with the edition left out: a short "Did you mean" list offers the full reference, and choosing it sets the fields.
- Close and reopen the popup: your last reference, currency and terms are remembered locally.
- Select the sun or moon button in the header: the popup switches between its light and dark look and remembers the choice; until then it follows your system theme.
- Look up two or three types, close and reopen the popup, and choose one from **Recent**. Or press the up arrow in the empty Reference box: your last reference comes back, each further press brings an older one and the down arrow goes back; press Enter to open it.
- Press **Alt+Shift+G**, type a reference and press Enter: the cursor is already in the Reference box, so Giga Pinax works without the mouse. If nothing happens, the key is taken — set another at `brave://extensions/shortcuts` or in Firefox under Add-ons › ⚙ › Manage Extension Shortcuts.

## Remove

In Brave, open `brave://extensions` and select **Remove**. In Firefox, remove it from `about:debugging`, or close and restart Firefox.
