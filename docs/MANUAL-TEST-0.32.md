# Manual test script for 0.32.0

Several 0.32 changes are in page behaviour that the automated suites cannot reach: the workspace editors, the popup's own
storage, capture permissions, the import downloads and a signed-in acsearch session. Work through this list once on the
built package before publishing the release. Every step says what should happen; anything else is a finding.

Use a browser profile whose Giga Pinax records you can afford to lose, or select **Settings → Export backup** first:
steps 12 and 13 replace the stored records.

## Load the unpacked build

Build the packages first: `python scripts/build.py` writes `dist/brave/` and `dist/firefox/` beside the five ZIPs.

- **Brave or Chrome:** open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load
  unpacked**, and choose `dist/brave`. Pin the toolbar button. After each rebuild, select **Reload** on that card.
- **Firefox 142+:** open `about:debugging`, select **This Firefox**, select **Load Temporary Add-on**, and choose
  `dist/firefox/manifest.json`. The add-on goes when Firefox restarts; load it again to continue.

Open the workspace from **Watchlist** in the popup. Have at least two saved coins and one auction event before you start.

## Checklist

1. **Attach an auction while coin details are dirty.** Select a coin, type into **Notes** in the coin details form and do
   not save. In the same coin's **Auction and reminders** section select **Add auction**, fill the event in and select
   **Review and save event**.
   *Expected:* the page announces that the auction was saved and attached to the coin, the coin details form still holds
   the text you typed, and **Auction reminder** now names the new event. Now select **Save details**.
   *Expected:* the save succeeds and the attachment survives it — reopen the coin and the auction is still attached.

2. **Type in the auction form while its save is in flight.** Open a coin's **Add auction** again, select **Review and
   save event**, and keep typing in the event's **Name** field while the save is running.
   *Expected:* the save completes, your later keystrokes are still in the form, and the page says the auction was saved
   but was not attached because the form changed while it was saving, telling you to attach it from coin details. No
   input is silently discarded and no second event is created.

3. **Reload committed data with one conflicting and one clean form.** The forms have to be on different records: the
   coin details, **Bid** and outcome forms all edit the one lot record, so a save of that coin moves all three and the
   banner names every one of them that is dirty. With the workspace open in two tabs, in tab A type into the coin
   details form without saving, and in the same coin's **Auction and reminders** section select **Add auction** and type
   a name into that form without saving it either. In tab B change and save that same coin's details only. Return to
   tab A.
   *Expected:* the banner appears and names the coin details form alone — "Committed data changed while the coin details
   form has unsaved input." The auction form is not named: it holds an auction event, which that save did not touch.
   Select **reload committed data**.
   *Expected:* the coin details form is refilled from the saved record, and the auction form keeps every word you
   typed.

4. **The default currency has one home.** In the popup, change **Currency** to EUR, close the popup and open it again.
   Then open **Settings** and the **Calculator** tab.
   *Expected:* the popup still shows EUR, Settings' default currency shows EUR, and the calculator prices in EUR.
   Changing it in Settings and reopening the popup agrees the same way round.

5. **A right-click lookup while the Number field has focus.** Open the lookup window, put the cursor in the catalogue
   number field (**Price number**, **RIC number**, …) and leave it there. On a web page, select a different reference,
   right-click it and choose **Look up "…" in Giga Pinax**.
   *Expected:* the window looks up the reference you selected on the page. The text you had left in the number field
   does not replace it, and no second lookup window opens.

6. **Capture an auction lot.** Open a real auction lot page, open the popup from the toolbar button and select **Capture
   current page**.
   *Expected:* the reference, title and auction context are filled from the lot — a page publishing structured lot data
   fills them from it rather than from stray visible text — and the fields stay editable before you research or save.

7. **Capture a page that cannot be read.** Open `chrome://extensions` (or `about:debugging`) in the active tab and
   select **Capture current page**.
   *Expected:* "This page can't be read. Open the auction lot in a tab, then select Capture again." Nothing is captured,
   no draft is created, and the fields keep no title or address from that page.

8. **Capture from the side panel after navigating.** Open the side panel (Brave/Chrome) or sidebar (Firefox), navigate
   the tab to a different auction lot, then select **Capture current page** in the panel.
   *Expected:* either the new lot's fields appear, or the same "can't be read" message with the added hint that the
   Giga Pinax toolbar button grants access to the page you are on. Never an empty capture, and never fields from the
   previous page.

9. **A Firefox permission prompt that closes the popup.** In Firefox, disable ANS access in `about:addons`, type a
   reference the bundled data does not hold (a Bopearachchi reference, for example `Bop 24A`) into the popup's
   **Reference** box and look it up so the permission prompt appears and closes the popup. Reopen the popup.
   *Expected:* the reference you typed is still in the Reference box, so the lookup can be repeated without retyping it.

10. **Price check on a real signed-in acsearch session.** Sign in to acsearch in the same browser with an account that
    shows hammer prices. Look up `Price 23` and select **Get prices**.
    *Expected:* the panel gives its query and a line of the form "N of M results cite Price 23"; the median is taken
    from the citing results only, and the rest are still listed under **Inspect sales**. No sign-in note appears. The
    automated fixtures for this page are synthetic, so this is the only check that the signed-in page is read correctly.
    Open the same search on acsearch itself and compare two of the listed prices, date and hammer, with the rows under
    **Inspect sales**: the figures the median rests on must be the ones acsearch shows, in the same currency.

11. **The signed-out note.** Repeat the same lookup in a private window where acsearch is not signed in.
    *Expected:* the sign-in note appears and points at acsearch. It must not appear in step 10, and it must not appear
    merely because the only hits are lots that have yet to be sold.

12. **A merge import preview that really overwrites something.** A merge keeps whichever copy of a record was written
    last, so a backup exported before your latest edit updates nothing and never reaches the safety copy. Make the
    backup the newer side: export a backup (call it **old**), change one record, export a second backup (**new**), then
    import **old** with **Replace local records** so that record is back as it was. Now select **Settings → Backup and
    import**, choose **new**, keep **Merge with local records**, and select **Preview import**.
    *Expected:* the preview lists what would be added, updated and kept — with at least one record under updated —
    names your own copy of each changed record with the date each side was last edited, and says which fields the backup
    would change, all before anything is written. Confirm it.
    *Expected:* because a record would be overwritten, a safety copy download starts first and the status names the
    file, and only then is the merge written.

13. **A replace import with the safety copy.** Preview **new** again with **Replace local records** and confirm it.
    *Expected:* a confirmation is asked for, a safety copy of the current records downloads and is named in the status,
    and only then are the records replaced. If the download cannot be made, you are asked whether to import anyway.

14. **Export raw data.** Select **Settings → Export raw data**.
    *Expected:* a rescue file downloads. It is an exact copy of the stored data, including unsaved drafts, captured page
    text and request IDs. Offering that same file to **Preview import** must be refused with the note that it is a
    rescue file and that **Export backup** makes an importable one.

15. **A house increment ladder in another currency.** In **Settings → House premiums**, add a house, set its ladder
    currency to EUR and enter its published tiers ("from: step", one per line). Open the **Calculator** with its
    currency set to USD and select that house.
    *Expected:* the calculator says this house's increments are in EUR while the calculator is set to USD, and uses the
    fixed increment. Switch the calculator to EUR.
    *Expected:* the ladder is used — the highest affordable bid lands on the tier's grid, a minimum bid off the schedule
    is rounded up, and a hammer off it is answered with the next valid bid.

16. **CoinArchives public prices.** Look up `Price 23`, then select **Get CoinArchives prices** and grant the access it
    asks for.
    *Expected:* a separately labelled median appears beside the acsearch one, with its own query and its own "N of M
    results cite Price 23" line. Open **Inspect sales** under it: every row carries the lot's own description text from
    the CoinArchives results page, not an empty line. An empty description on every row means the page has renamed the
    element the description is read from, and the citation count above is then counting nothing — that is a finding.
    Compare one listed price and date with the CoinArchives results page itself.

17. **Catalogue lookups with the network disabled.** Turn the network off, then look each of these up in the popup:

    | Entered | Expected |
    | --- | --- |
    | `RIC II 972` | choices, not a single card: **RIC II, Part 1 (second edition) Vespasian 972** and **RIC II, Part 3 (second edition) Hadrian 972** |
    | `RIC III, 394a` | read as a reference, offering **RIC III Antoninus Pius 394A (aureus)** and **… (denarius)** |
    | `Philip I, 244-249. Antoninianus, Rome. RIC 27b. 4.23 g.` pasted as lot text | one reference, `RIC 27b` read under the heading's ruler, opening **RIC IV Philip I 27B** |
    | `Crawford 44/5` | the **RRC 44/5** card |
    | `SC 1266.2` | the **Seleucid Coins (part 1) 1266.2** card |

    *Expected:* every one of them answers with the network off, and each card names its authority, denomination, mint,
    material and portrait in English rather than showing identifiers. Prices, which need the network, stay unavailable.
