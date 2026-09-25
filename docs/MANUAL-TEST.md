# Manual test script for 0.34.0

Much of what a release changes is page behaviour the automated suites cannot reach: the popup's own storage, capture
permissions, the import downloads, a browser's own language and a signed-in acsearch session. The workspace editors are
no longer on this list: attaching an auction while coin details are unsaved, typing in the auction form while it saves,
**reload committed data** with one conflicting and one clean form, a coin removed in another tab, the leave-page guard
and **Add coin** after discarding are driven against the real store in `tests/workspace-page.test.mjs`. Work
through this list once on the built package before publishing the release, and add a step for every change of the new
release that only a browser can show. Every step says what should happen; anything else is a finding.

Use a browser profile whose Giga Pinax records you can afford to lose, or select **Settings → Export backup** first:
steps 9, 10, 15, 16 and 17 replace or edit the stored records, and steps 1, 12 and 24 change
your saved settings.

## Load the unpacked build

Build the packages first: `python scripts/build.py` writes `dist/brave/` and `dist/firefox/` beside the five ZIPs.

- **Brave or Chrome:** open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load
  unpacked**, and choose `dist/brave`. Pin the toolbar button. After each rebuild, select **Reload** on that card.
- **Firefox 142+:** open `about:debugging`, select **This Firefox**, select **Load Temporary Add-on**, and choose
  `dist/firefox/manifest.json`. The add-on goes when Firefox restarts; load it again to continue.

Open the workspace from **Watchlist** in the popup. Have at least two saved coins and one auction event before you start.

## Checklist

1. **The default currency has one home.** In the popup, change **Currency** to EUR, close the popup and open it again.
   Then open **Settings** and the **Calculator** tab.
   *Expected:* the popup still shows EUR, Settings' default currency shows EUR, and the calculator prices in EUR.
   Changing it in Settings and reopening the popup agrees the same way round.

2. **A right-click lookup while the Number field has focus.** Open the lookup window, put the cursor in the catalogue
   number field (**Price number**, **RIC number**, …) and leave it there. On a web page, select a different reference,
   right-click it and choose **Look up "…" in Giga Pinax**.
   *Expected:* the window looks up the reference you selected on the page. The text you had left in the number field
   does not replace it, and no second lookup window opens.

3. **Capture an auction lot.** Open a real auction lot page, open the popup from the toolbar button and select **Capture
   current page**.
   *Expected:* the reference, title and auction context are filled from the lot — a page publishing structured lot data
   fills them from it rather than from stray visible text — and the fields stay editable before you research or save.

4. **Capture a page that cannot be read.** Open `chrome://extensions` (or `about:debugging`) in the active tab and
   select **Capture current page**.
   *Expected:* "This page can't be read. Open the auction lot in a tab, then select Capture again." Nothing is captured,
   no draft is created, and the fields keep no title or address from that page.

5. **Capture from the side panel after navigating.** Open the side panel (Brave/Chrome) or sidebar (Firefox), navigate
   the tab to a different auction lot, then select **Capture current page** in the panel.
   *Expected:* either the new lot's fields appear, or the same "can't be read" message with the added hint that the
   Giga Pinax toolbar button grants access to the page you are on. Never an empty capture, and never fields from the
   previous page.

6. **A Firefox permission prompt that closes the popup.** In Firefox, disable ANS access in `about:addons`, type a
   reference the bundled data does not hold (a Bopearachchi reference, for example `Bop 24A`) into the popup's
   **Reference** box and look it up so the permission prompt appears and closes the popup. Reopen the popup.
   *Expected:* the reference you typed is still in the Reference box, so the lookup can be repeated without retyping it.

7. **Price check on a real signed-in acsearch session.** Sign in to acsearch in the same browser with an account that
    shows hammer prices. Look up `Price 23` and select **Get prices**.
    *Expected:* the query shows beside **Change search**, and a line of the form "N of M results cite Price 23"; the median is taken
    from the citing results only, and the rest are still listed under **Inspect sales**. No sign-in note appears. The
    automated fixtures for this page are synthetic, so unless a scrubbed real page has been added to
    `tests/fixtures/acsearch-real/`, this is the only check that the signed-in page is read correctly.
    Open the same search on acsearch itself and compare two of the listed prices, date and hammer, with the rows under
    **Inspect sales**: the figures the median rests on must be the ones acsearch shows, in the same currency.
    To give the automated suite a real page, save that acsearch results page (**Web Page, HTML only**, outside the
    repository) and scrub it with `python scripts/scrub_acsearch.py SAVED.html tests/fixtures/acsearch-real/NAME.html
    --account YOUR_NAME --account YOUR_EMAIL`; [the folder's README](../tests/fixtures/acsearch-real/README.md) says how
    to review it before committing it.
    Under **Inspect sales**, include by hand one row that does not cite Price 23.
    *Expected:* the line now reads "N of M results cite Price 23; K of M counted", with K one more than N: the row you
    included is counted, and never counted as a citation. **Copy summary** says the same.

8. **The signed-out note.** Repeat the same lookup in a private window where acsearch is not signed in.
    *Expected:* the sign-in note appears and points at acsearch. It must not appear in step 7, and it must not appear
    merely because the only hits are lots that have yet to be sold.

9. **A merge import preview that really overwrites something.** A merge keeps whichever copy of a record was written
    last, so a backup exported before your latest edit updates nothing and never reaches the safety copy. Make the
    backup the newer side: export a backup (call it **old**), change one record, export a second backup (**new**), then
    import **old** with **Replace local records** so that record is back as it was. Now select **Settings → Backup and
    import**, choose **new**, keep **Merge with local records**, and select **Preview import**.
    *Expected:* the preview lists what would be added, updated and kept — with at least one record under updated —
    names your own copy of each changed record with the date each side was last edited, and says which fields the backup
    would change, all before anything is written. Confirm it.
    *Expected:* because a record would be overwritten, a safety copy download starts first and the status names the
    file, and only then is the merge written.

10. **A replace import with the safety copy.** Preview **new** again with **Replace local records** and confirm it.
    *Expected:* a confirmation is asked for, a safety copy of the current records downloads and is named in the status,
    and only then are the records replaced. If the download cannot be made, you are asked whether to import anyway.

11. **Export raw data.** Select **Settings → Export raw data**.
    *Expected:* a rescue file downloads. It is an exact copy of the stored data, including unsaved drafts, captured page
    text and request IDs. Offering that same file to **Preview import** must be refused with the note that it is a
    rescue file and that **Export backup** makes an importable one.

12. **A house increment ladder in another currency.** In **Settings → House premiums**, add a house, set its ladder
    currency to EUR and enter its published tiers ("from: step", one per line). Open the **Calculator** with its
    currency set to USD and select that house.
    *Expected:* the calculator says this house's increments are in EUR while the calculator is set to USD, and uses the
    fixed increment. Switch the calculator to EUR.
    *Expected:* the ladder is used — the highest affordable bid lands on the tier's grid, a minimum bid off the schedule
    is rounded up, and a hammer off it is answered with the next valid bid.

13. **CoinArchives public prices.** Look up `Price 23`, then select **Get CoinArchives prices** and grant the access it
    asks for.
    *Expected:* a separately labelled median appears beside the acsearch one, with its own query and its own "N of M
    results cite Price 23" line. Open **Inspect sales** under it: every row carries the lot's own description text from
    the CoinArchives results page, not an empty line. An empty description on every row means the page has renamed the
    element the description is read from, and the citation count above is then counting nothing — that is a finding.
    Compare one listed price and date with the CoinArchives results page itself. Then change **Currency**.
    *Expected:* the CoinArchives median goes, and a line says it was in the old currency, is not converted, and that
    **Get CoinArchives prices** fetches it in the new one. The acsearch median is fetched again in the new currency.

14. **Catalogue lookups with the network disabled.** Turn the network off, then look each of these up in the popup:

    | Entered | Expected |
    | --- | --- |
    | `RIC II 972` | choices, not a single card: **RIC II, Part 1 (second edition) Vespasian 972** and **RIC II, Part 3 (second edition) Hadrian 972** |
    | `RIC III, 394a` | read as a reference, offering **RIC III Antoninus Pius 394A (aureus)** and **… (denarius)** |
    | `Philip I, 244-249. Antoninianus, Rome. RIC 27b. 4.23 g.` pasted as lot text | one reference, `RIC 27b` read under the heading's ruler, opening **RIC IV Philip I 27B** |
    | `Crawford 44/5` | the **RRC 44/5** card |
    | `SC 1266.2` | the **Seleucid Coins (part 1) 1266.2** card |

    *Expected:* every one of them answers with the network off, and each card names its authority, denomination, mint,
    material and portrait in English rather than showing identifiers. Prices, which need the network, stay unavailable.

15. **Restore a record set aside when your data was opened.** In the workspace, give a coin the outcome **Won**, tick
    **Add a won coin to collection history** and save the outcome. Open **Settings**, open the browser's developer
    tools on that page (right-click → **Inspect**) and run, in its console (`browser` in place of `chrome` in Firefox):

    ```js
    const key = 'auctionCompanion:v1';
    const root = (await chrome.storage.local.get(key))[key];
    delete root.lots.find((lot) => lot.collectionEntryId).collectionEntryId;
    await chrome.storage.local.set({ [key]: root });
    ```

    The coin now no longer names its collection entry, which the next read of your data sets aside. Reload Settings.
    *Expected:* **Backup and import** shows "1 record could not be read and was set aside." and a line
    "collectionEntries: foreign-key (<today's date>)" with a **Restore** button. Reload the page twice more: the same
    line is there each time. Select **Restore**.
    *Expected:* "The record was put back into collectionEntries. 1 link was restored with it." The line and the
    set-aside summary go, and the coin shows its collection entry in the workspace again. At no point does Restore
    answer that the record is no longer in the list and the page should be reloaded.

16. **Restore and import keep settings you have not saved.** Set a record aside as in step 15. In **Settings**, add a
    house preset row with a name and a premium, change **Default currency** and the theme, and do not save. Select
    **Restore** on the set-aside line.
    *Expected:* the record goes back and the row you typed, the currency and the theme are all still on the page.
    Now, still without saving, preview and confirm an import of a backup whose settings differ from the page's.
    *Expected:* the typed row, currency and theme stay on the page, and the status says "Backup imported. The settings
    above are the ones you had not saved, not the imported ones. Note what you typed, then reload this page to see the
    imported settings." **Save settings** is refused with the same advice until you reload; after the reload the page
    shows the imported settings.

17. **Amounts in a browser set to Arabic.** Set the browser's display language to Arabic (Brave or Chrome:
    **Settings → Languages**, "Display in this language", then relaunch; Firefox: install the Arabic language pack and
    choose it under **Settings → Language**). In the workspace, save a coin's bid with a maximum hammer of `1250.50`,
    and its outcome with a hammer of `1200` and an actual invoice of `1450.50`. Reopen the coin.
    *Expected:* every amount field reads back in Western digits with a full stop (`1250.50`, `1200.00`, `1450.50`),
    never in Arabic-Indic digits or with the Arabic decimal mark (`١٢٥٠٫٥٠`), and saving the bid and the outcome again
    unchanged succeeds. In **Settings**, a house preset with a premium of `22.5` reads `22.50`, and **Save settings**
    with nothing touched succeeds. On a coin's **Bid** tab, choosing that house under **House preset** fills
    **Buyer’s premium %** with `22.5`, and **Use as maximum** under **Maximum hammer from a budget** fills the maximum
    the same way. Set the language back afterwards.

18. **The filter switches.** Look up `Price 23` and select **Get prices**, then look up a reference whose results name
    a denomination.
    *Expected:* **Only results citing …** and **Only results naming …** each draw as a normal-sized checkbox with its
    label beside it on the same line, the label whole and readable; never a full-width box with the label pushed off
    the edge of the popup. Check this in the side panel as well as the toolbar popup.

19. **A bare RIC number shows no median.** Look up `RIC 237`.
    *Expected:* a list of types to choose from, and no auction research section, median or **Get prices** until a type
    is chosen. Choose one of the types. *Expected:* its prices can now be fetched, and the median is for that type's own
    search. Then look up `RIC IV 237`. *Expected:* if it offers a choice, the popup says "This reference names more than
    one type, so no prices are shown. Choose one type to see its prices." and shows no median.

20. **A currency change keeps the sales you decided by hand.** Look up `Price 23`, select **Get prices**, and under
    **Inspect sales** exclude one counted row and include one row the filters left out. Change **Currency**.
    *Expected:* the prices are fetched again in the new currency, the announcement ends "Sales you included or excluded
    by hand are kept.", and the same two rows are still excluded and included. A new lookup starts from the filters'
    own choice again.

21. **Capture a page that reads "RIC I² 306".** Open a lot page whose visible text cites the coin with no label in front,
    written `RIC I² 306`. If you have none to hand, open an ordinary web page and, in its developer tools, replace a
    paragraph's text with `Nero. AR Denarius. RIC I² 306.` Select **Capture current page**.
    *Expected:* the captured reference is `RIC I² 306`, not `RIC I`, and **Research coin** looks it up and offers the
    RIC I (second edition) 306 types. A page reading "SC in exergue" captures no SC reference.

22. **A lot with a mint after its RIC number.** Paste `Diocletian. Antoninianus. RIC 15 (Lugdunum).` into the
    **Reference** box and look it up.
    *Expected:* two choices, **RIC VI Lugdunum 15** and **RIC V Diocletian 15**, and neither opened on its own. Then
    `Probus. Antoninianus. RIC 40 (Ticinum).`
    *Expected:* **RIC V Probus 40** is offered, and Constantine's RIC VII Ticinum 40 appears nowhere.

23. **The collection table fits its panel.** With at least one won coin added to collection history, open the
    workspace's **History** tab, first in a wide window and then narrowed to phone width.
    *Expected:* the per-currency table reads whole — its columns scroll inside the panel rather than pushing the page
    sideways — and the note above it says the figures are your own records and saved comparables, not an appraisal or a
    valuation. Each entry names its saved comparables or says it has none.

24. **Specimen photos load only when switched on, with no referrer.** In **Settings**, tick **Show specimen photos** and
    select **Save settings**. Open the popup, open its developer tools on the **Network** panel, and look up
    `RIC I² Nero 306`.
    *Expected:* the card appears at once, then a **Specimens** strip shows three obverse and reverse pairs, each captioned
    with the collection that holds it and linked to that specimen's page. Nomisma.org gets one `query` request, and no
    image request carries a `Referer` header. Untick the switch, save, and look up the same reference again.
    *Expected:* no request to `nomisma.org/query` and no photo. In Firefox, repeat with the switch on after withholding
    nomisma.org access in `about:addons`. *Expected:* the card shows and no photos appear.

25. **A CPE type with the network disabled.** Turn the network off, then look up `CPE 330` in the popup.
    *Expected:* the **Coins of the Ptolemaic Empire Vol. I, Part 1, no. 330** card, marked **Local PCO catalogue**,
    reading Ptolemy II Philadelphus · Decadrachm · Alexandria · Silver · 270–246 BC, with no "couldn't reach" message.
    The **Catalogue** list now shows **CPE (Lorber, Ptolemaic)**.

26. **A CPE bronze with the network disabled.** With the network still off, look up `CPE B549`.
    *Expected:* the **Coins of the Ptolemaic Empire Vol. I, Part II, no. B549** card, marked **Local PCO catalogue**,
    reading Ptolemy IV Philopator · Hemiobol · Tyre · Bronze · 222–204 BC. `Svoronos 487` then opens the **… Part 1, no. 330** card
    with the line "Svoronos 487 is filed in PCO as CPE 330."

27. **A Newell Demetrius type with the network disabled.** With the network still off, look up `Newell Demetrius 45`.
    *Expected:* the **Newell Demetrius Poliorcetes, no. 45** card, marked **Local AGCO catalogue**, reading
    Demetrius I Poliorcetes · Hemidrachm · Tarsus · Silver · 298–295 BC. Settings → **Local catalogue data** lists PCO
    and AGCO rows. Turn the network back on.

28. **What a won coin really cost.** In the workspace, add a coin, and on its **Bid** tab type a maximum of `1500` EUR
    and premium `25`; under **Fees** type **VAT on premium %** `19` and shipping `15`. The line under the premium reads
    `≈ €1,961.25 all-in · premium €375.00 · fees €86.25`. Select **Record placed bid**.
    On **Outcome**, record **Won** with a hammer of `1300` EUR, tick **Add a won coin to collection history** and save.
    Open **History**.
    *Expected:* the coin's card reads `EUR  Hammer 1,300.00 · Premium 325.00 · Fees 76.75 · Total 1,701.75` on one
    line, figures right-aligned, with "Premium 25% · VAT on premium 61.75 · shipping 15.00" under it; the collection
    entry shows the same line, and the table's **Total cost** for EUR is €1,701.75. In **Settings**, change the house's
    premium; back on History nothing has moved. Win a second coin with no bid recorded, leaving **Buyer’s premium %**
    on its Outcome tab blank.
    *Expected:* its total reads **Incomplete** in the warning colour, the line under it says no premium rate was
    recorded, **Add the premium rate** opens the coin's Outcome tab on that field, and the table shows
    `€1,701.75 (1 of 2)`. **Export CSV** of the lots and check `total_cost` is `1701.75` for the first and blank, with
    `total_cost_missing` `premium-rate fees`, for the second. Type `20` in its premium and save the outcome again.
    *Expected:* its line reads `Fees not recorded` and a **Total** of hammer + premium, with **Add fees**; the table's
    cell says `(1 without fees)`. At phone width the money line
    folds to two columns and never pushes the page sideways.

29. **A collection entry you correct, and one that follows the outcome.** With two won coins in collection history,
    select **Edit entry** on the first, change its acquisition date, its invoice paid to `1710` and its notes, and
    select **Save entry**.
    *Expected:* the form closes and the entry reads the new date and notes, and "Invoice paid €1,710.00 (your
    correction; the outcome records …)". Open that coin's **Outcome**, change its hammer to `1310` and its invoice to
    `1720`, and save. *Expected:* on History the entry's money line shows the new hammer and total cost, and its
    invoice paid is still €1,710.00. Correct the second coin's hammer and invoice under **Outcome** without editing its
    entry. *Expected:* its entry and the collection totals show the new figures. Open **Edit entry**, type in a field,
    and while the form is open save something in another workspace tab. *Expected:* the form stays open with what you
    typed.
