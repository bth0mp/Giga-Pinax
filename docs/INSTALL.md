# Install Giga Pinax

Version **0.16.0** looks up RIC, RRC, SC, Bopearachchi and Price coin types from the American Numismatic Society's open OCRE, CRRO, SCO, BIGR and PELLA datasets and fetches recent hammer prices from acsearch with your own account. It contacts `numismatics.org` and `nomisma.org` when you look up a type (**Look up**, a choice from a list or a **Recent** chip), and `www.acsearch.info` when a type resolves (**Look up**, a choice from a list or a **Recent** chip) or you select **Get prices**. A reference without open type data (catalogue **Other**) contacts only `www.acsearch.info`. Nothing else is contacted (an RPC reference's **RPC online** link opens only when you select it) and nothing from acsearch is stored.

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
dist/giga-pinax-brave-0.16.0.zip
dist/giga-pinax-firefox-0.16.0.zip
```

Run the same command again whenever an extension asset or manifest changes. You can build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

## Test in Brave

1. Use `dist/brave`, or unzip `dist/giga-pinax-brave-0.16.0.zip` into its own folder.
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
4. Choose `dist/firefox/manifest.json`, or `dist/giga-pinax-firefox-0.16.0.zip`.
5. Open Giga Pinax from Firefox's extensions menu.

Firefox normally grants access to `numismatics.org`, `nomisma.org` and `www.acsearch.info` when you install the extension. If you later turn that access off in about:addons, selecting **Look up** or **Get prices** asks for it again; if the popup closes while Firefox is asking, reopen it and select the same button.

Firefox removes a temporary add-on when Firefox restarts. Permanent installation needs a Mozilla-signed build; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

**Already installed temporarily?** After rebuilding, select **Reload** for Giga Pinax under **This Firefox** at `about:debugging`, or load the updated ZIP again.

## What to try

- Type **RIC I² Nero 306** in the Reference box and select **Look up**; the RIC fields fill in and the type resolves.
- Select **RIC I² Nero 306** on any web page, right-click and choose **Look up “RIC I² Nero 306” in Giga Pinax**. Drag the window it opens to make it longer or wider.
- With that window still open, right-click another reference, such as **Craw. 44/5** or a reference copied from an auction page: the same window looks it up and comes to the front, rather than a second window opening. Dealer abbreviations (**Craw.**, **Crawf.**), a trailing **;** and the hidden characters auction pages add are read.
- Select the window button (a square with an arrow) in the header: Giga Pinax opens on the type it was showing, in the window already open or in a new one, and you can drag that window to any size.
- **Price 23**, then catalogue **RIC**, and type **Titus** in **Ruler or mint section**: it is suggested as you type, from every OCRE volume, and the volume becomes **II.1² (2nd ed.)** by itself. With number **123**, **Look up** finds RIC II.1² Titus 123. A blank volume or ruler means any.
- **RIC 972** in the Reference box: a list of the six types numbered 972, from Vespasian (II.1²) to Zeno (X); choosing one sets the fields, and its acsearch search follows it (for example "Hadrian 972").
- **RRC 44/5** — an anonymous Roman Republican denarius; its acsearch search starts as "Crawford 44/5".
- **SC 1266.2** — a tetradrachm of Demetrius II from Antioch; **SC 1266.9** doesn't exist and offers **SC 1266** instead.
- **Bop Euthydemus I 24A** — a bronze of Euthydemus I of Bactria; the card shows its BIGR type and the citation **Bopearachchi Euthydème I 24A**, and its acsearch search starts as `(Euthydemus Euthydemos) "Bopearachchi 24A"` — the king in both spellings and the citation as an exact phrase. **Bop 9C** alone lists every king with a 9C series to choose from; with the **King** left blank, a number alone does the same. Each lookup checks its matches against numismatics.org in one request; if that fails, the popup says it couldn't reach numismatics.org instead of "not found".
- **BCD Boiotia 174b; HGC 4, 1218** — neither has open type data, so the catalogue becomes **Other (prices only)** and the card says so; acsearch is searched for the lots that cite either reference, each as an exact phrase: `("BCD Boiotia 174b" "HGC 4, 1218")`. Any other reference (SNG, Sear, RPC…) works the same way, and in a `;` list a RIC, RRC, SC, Bop or Price reference is looked up instead.
- **RPC I 1234** — priced the same way, and the card also has an **RPC online ↗** link to that coin's page on RPC Online (**RPC V.2 1234** goes to part 2 of volume V). It opens only when you select it; Giga Pinax never contacts RPC itself.
- **Look up** fetches prices too. If you are not signed in on acsearch, the popup says so with a sign-in link; sign in with an account that includes hammer prices, then select **Get prices**.
- If the popup says no hammer prices could be counted, it quotes up to five prices exactly as acsearch showed them — send that line so the price reader can learn the format.
- Edit the acsearch search term (for example add the denomination) and select **Get prices** again; the term is remembered for that type.
- The median hammer price sits right under the type's title, and the obverse and reverse are folded under **Obverse and reverse** (select it to open them). The line under the median says how far to trust it, for example **Solid: 22 sales, 2024–2026** — Thin for 1–4 sales, Moderate for 5–14, Solid for 15 or more — and the next line how many matches it was drawn from.
- Under **Middle 50% of sales**, the panel prints the lowest and highest sale, for example **All 22 sales $81–$950**; a quarter of the sales lie above the middle 50%. Lots acsearch lists without a price are counted apart ("2 without a price") from prices the popup couldn't count.
- Type a bid or an asking price, such as **500**, in **Check a price**: the line under it says how many of the counted sales it tops and its multiple of the median, for example "Higher than 16 of 23 sales, 1.6× the median", and a mark shows where it falls on the range bar; beyond the lowest or highest sale the mark waits at that end with an arrow pointing out. Nothing is stored, and a new lookup or currency starts it empty.
- Expand **Inspect sales** to see each sale with a link to it on acsearch.
- Select **Copy summary** at the bottom of the prices panel and paste it anywhere.
- A number that doesn't exist, such as **RIC I² Nero 9999999**: the popup says it was not found rather than inventing a result.
- **RIC I Nero 306** typed in the Reference box with the edition left out: a short "Did you mean" list offers the full reference, and choosing it sets the fields.
- Close and reopen the popup: your last reference, currency and terms are remembered locally.
- Select the sun or moon button in the header: the popup switches between its light and dark look and remembers the choice; until then it follows your system theme.
- Look up two or three types, close and reopen the popup, and choose one from **Recent**. Or press the up arrow in the empty Reference box: your last reference comes back, each further press brings an older one and the down arrow goes back; press Enter to open it.
- Press **Alt+Shift+G**, type a reference and press Enter: the cursor is already in the Reference box, so Giga Pinax works without the mouse. If nothing happens, the key is taken — set another at `brave://extensions/shortcuts` or in Firefox under Add-ons › ⚙ › Manage Extension Shortcuts.

## Remove

In Brave, open `brave://extensions` and select **Remove**. In Firefox, remove it from `about:debugging`, or close and restart Firefox.
