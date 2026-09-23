# Changelog

Notable changes to Giga Pinax, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
Each date is the date of that version's release tag. Every release also carries the install and update steps in
[docs/INSTALL.md](docs/INSTALL.md); they are not repeated here.

## [Unreleased]

### Fixed

- A RIC number typed without a volume, a ruler or a mint — `RIC 237` — no longer shows a median beside **Choose a type** or "matches too many types": the number names a type in every volume, so its prices mixed Caracalla's denarii with Vespasian's aurei and Constantine's folles. Prices now wait until one type is found or chosen, and prices already fetched for a RIC reference go, with a line saying why, when the lookup offers a choice of types.
- Changing the currency no longer throws away the sales you included or excluded by hand. The same search is fetched again in the new currency and every lot keeps its id, so your decisions stay on the same lots, and the announcement says they were kept. A new lookup still starts from the filters' own choice.
- Control letters a dealer places after a comma — `in left field, MB.`, `in exergue, TB.`, `monogram below, TTB.` — are no longer read as a grade: such a lot counted as **Fine and below** or **VF** in the per-grade medians. A grade mark after a comma anywhere else (`Patina verde, BB.`, `Leicht korrodiert, ss.`) still counts.
- `AU` followed by the coin's weight after a full stop or inside a bracket — `Justinian I. AU. 4.45g.`, `Constantinople. AU (4.45 g).` — is read as the metal, as `AU 4.45 g` already was, and no longer counts a gold coin as **AU/Mint State**.
- A grade the description quotes from an earlier sale — `Good EF. Ex Triton XX (where described as "Good VF").`, `there graded VF`, `catalogued as VF` — no longer takes the place of the lot's own grade, which put the coin in a lower or higher bucket than its dealer gave it.

### Security

- 0.32.0 said hostile acsearch pages were "refused in milliseconds". That was not true of every shape: a result page whose one description filled the two megabytes read, with its `];` terminators at the end, still held the popup for about three seconds, because each terminator was tried by parsing the whole page again. The end of the results is now found in a single pass that reads the page's strings as JSON writes them, and the results are parsed once, so any page within the two megabytes read takes milliseconds.
- An acsearch reply is no longer read whole before any of it is looked at: past 4 MiB the download is cut off, and the panel says the reply was too large to read instead of that acsearch could not be reached.

## [0.32.1] - 2026-09-18

### Added

- A RIC VI–IX mint section is now found by the modern names Nomisma really publishes for it, not by its English label alone: **Arles**, **Sisak**, **Roma**, **Antakya**, **Sirmio**, **Konstantinopolis** and **Marmara Ereğlisi** join **Trier**, **Istanbul** and the rest. Type one into the Reference box or the **Ruler or section** field, or paste a lot whose heading names the mint and nobody else — `Arles. RIC 12`, `Sisak mint, RIC 12` — and the number is looked up in that mint's own section, from the bundled catalogue with no network at all. A mint named beside a ruler is still looked up by the ruler, as before, and a mint name never opens a person's coin. (#9)
- Mint names now come from Wikidata as well, through the links Nomisma's own mint concepts carry, so five more RIC VI–IX sections answer to a modern name and the rest answer to more spellings: **Sofia** and **Sredets** reach **Serdica**, **Carthago** reaches **Carthage**, **Ostia Antica** reaches **Ostia**, **Roman London** reaches **Londinium**, **Samarobriva** reaches **Amiens**, and **Triers**, **Augusta Treverorum**, **Nikomedya**, **Antioch on the Orontes** and a dozen others join the names already recognised — eighteen of the twenty-one mints now answer to a name other than RIC's. A city's nickname is not one of them: "the Eternal City" or "Caput Mundi" in a lot's prose still leaves the coin filed where the lot says it was struck. (#9)
- **London**, **Lyon**, **Milan**, **Pavia** and **Trier** now open their RIC section from the bundled catalogue — `RIC VII London 12`, `RIC IX Milan 1`, a lot headed `Pavia mint` — and **Erdek** and **İzmit**, the towns Cyzicus and Nicomedia stand in today, come with them. Wikidata titles the entries Nomisma links those mints to by the Roman city's Latin name, so each one's own entry for the town standing there now is read, and only where that entry says it is a town rather than a county or a province. **Lyons** is the one spelling still not recognised: Wikidata publishes it as a name of Lyon in no language read here, and none was invented for it. (#9)
- Records set aside because they could not be read can be put back. Each one listed under **Data health** in Settings has a **Restore** button: the record is checked against today's rules and, if it passes, goes back into your watchlist, auctions or collection, together with the links its removal had to clear. A link whose field you have used since is left exactly as it is and named in the reply, and a record that still cannot be read stays where it is, with the reason it cannot go back. (#7)

### Fixed

- The calculator's house-preset controls all say **preset** now (a preset carries a premium and an increment ladder), and a doubled space typed into the workspace's own search box no longer reaches the site as two (#8).
- A lot heading that named only a mint — `Londinium. RIC 12` — used to leave the number searched across every mint of four volumes; it is now read as that mint's section. (#9)
- A mint named in a lot no longer overrules the volume the lot itself cites. `Rome mint. RIC IV 460` opened a RIC VIII coin of Rome and `Constantinople. RIC X 12` a RIC VII one, because "Rome mint" and "Constantinople" stand in descriptions of every part of RIC while only RIC VI–IX are filed by mint: the mint is now read as a section only where the reference gives no volume, or gives one of the volumes that mint is a section of. (#9)
- The **Only results citing …** and **Only results naming …** switches drew as a full-width, 36-pixel box with their label squeezed off the edge of the popup: the checkbox now keeps its own size beside its label.
- The matches line under the median no longer wraps a search term that carries quotes or brackets of its own in a second pair of quotes (“"RIC 237"”, “Nero ("RIC 306" …)”).
- A part of RIC IV written after a comma, as dealers write it — `RIC IV, 1, 123a`, `RIC IV, part 1, 123` — is now read as RIC IV number 123a, the way `RIC IV.1 123a` always was. RIC IV is bound in three parts; a comma followed by a part the volume does not have, such as `RIC IV, 4, 12`, is still left unread. (#2)
- Removing a coin from a group, or settling a collection review, no longer claims the group name or the coin details you were half way through typing "changed in another view": the forms follow your own edit instead of asking you to reload it away. (#5)
- A removal the extension could not confirm — the background worker went quiet, or the write could not be read back — is no longer reported to you as the coin being "removed in another view" once it turns out to have gone through. (#5)
- A lot graded `AU`, `About Uncirculated` or `NGC AU 58` is no longer left out of the per-grade medians: AU counts in the top bucket, which is now named **AU/Mint State** (FDC, Stempelglanz and Uncirculated still count there too). (#6)
- `AU` written as the metal — `Solidus. AU 4.45 g.`, `Aureus. AU, 7.25 g.`, `Gold (AU) solidus` — is the chemical symbol for gold and no longer counts the lot as **AU/Mint State**: a weight or diameter behind it, a bracket behind **Gold**, or a denomination in front of it says the metal is meant, and the row is left ungraded. `NGC AU 58`, `About Uncirculated`, `AU/EF` and a die axis behind the grade (`AU 12 h.`) read exactly as before. (#6)
- A grade a dealer quotes (`"Good VF"`), footnotes (`VF*`, `EF★`) or follows with a reservation (`Extremely Fine though weakly struck`) is now read instead of left ungraded. (#6)
- The Italian `mBB` (*migliore di* BB) is read like `qBB`, in the same bucket as the mark it qualifies. (#6)
- A grade the coin's weight, diameter or die axis follows (`VF 3.41 g`, `Fine 12 h.`) is now read; a bare number behind a grade is still a lot number (`Slg. vz 12.`) and still leaves the row ungraded. (#6)
- A qualified grade written in lower case — `Flan crack, otherwise very fine`, `nearly extremely fine` — now counts. A bare `very fine` is still the ordinary adjective and is still left ungraded. (#6)
- One record set aside for one reason is now one entry under **Data health**, however often it has been through a repair or arrived in a merged backup, and a link cleared to a record already set aside is recorded on the entry that record is already in. A third copy of a record folds into whichever entry it matches rather than only the first, so no two entries in the list are the same record with the same **Restore** button, and an entry that only records links cleared to a record that was never there is no longer opened a second time by a later repair. (#7)
- A link cleared twice to the same set-aside record is written down once. A record repaired, saved, pointed at that same set-aside record again and repaired again listed "2 links cleared" under **Data health** for the one link, and **Restore** offered to put it back twice. (#7)
- Merging a backup no longer adds a second copy of an auction for a lot it skipped as one you already have, which left one sale standing twice and its reminders firing twice. The auction you already track keeps its reminders, the backup's copy is listed in the import summary as kept out, and where the lot you keep was attached to no auction at all, the one the backup knew about is taken and attached to it. (#3)
- The lot that takes over the sale of a duplicate a merge skipped is now named in the import summary, counted among the records the merge updates — so the settings page downloads its safety copy before writing — and carries the time the link was put on it. An older backup merged again no longer re-attaches a sale to a lot you have unlinked since: a lot edited after the backup was exported keeps what you left it as, and the backup's copy of the sale is listed as kept out. (#3)
- A backup too big for the 5 MiB local store is now turned away as a backup that does not fit, instead of as reminders that would exceed the bound — removing reminders was never the way out of it. (#4)
- A right-click lookup whose window cannot be opened now says that, instead of warning that the last page capture could not be saved. A lookup saves nothing, so nothing was lost. (#4)
- A backup that cannot be merged now says so in a plain sentence, with the technical detail after it rather than on its own. (#4)
- A backup holding a record nested thousands of levels deep is now refused as a file that cannot be read, instead of leaving the page that asked for the import waiting for an answer that never came. It also says what still works on data nobody can read: **Export raw data** writes the copy anyway, and the record can be taken out of that copy. (#8)
- A lot and the collection entry that goes with it can now be put back together. Set aside one at a time, each of them refused to come back without the other, so neither ever could: **Restore** on either one now brings both, and says so. Where the other half is not in the list at all, the refusal names the record that is missing. (#7)
- A record that cannot be put back now says why in the words of the check that refused it, instead of being reported as reminders that could not be scheduled — nothing about it was ever a reminder. A record too big for the remaining space says that putting it back would not fit, and points at the records you could remove. (#7, #4)
- Putting a set-aside record back no longer counts a record forward that it left alone: where two of the links had to be given up, the lot or auction they pointed from used to be saved one step on from where it started, which told an open editor it had changed when nothing about it had. (#7)

### Known issues

- A lot whose heading names no ruler is still read as a mint's coin wherever a mint spelling stands anywhere in its text — a sale line such as `Roma Numismatics E-Sale 100` included — as long as its RIC reference gives no volume, or gives one of RIC VI–IX. `Rome mint. RIC 460` is searched in Rome's four volumes only. Where that is not where the coin is filed, name the ruler or the volume in the text you look up. (#9)

## [0.32.0] - 2026-09-17

### Added

- Price searches now look for the reference itself: `Price 23` searches the exact phrase `"Price 23"`, and RIC, Crawford and Seleucid Coins numbers search the spellings dealers most often write. A `Price 3014` lot, a stray `RIC 3061` or a `4.23 g` weight is no longer medianed as a sale of your coin.
- The panel says how many results actually cite the reference — `39 of 55 results cite Price 23` — leaves the rest out of the median, and still lists them under **Inspect sales**, where any of them can be counted by hand. An **Only results citing …** checkbox above both providers turns the filter off; a new lookup turns it back on, a re-fetch keeps what you set, and a search you have edited to look for something else is never filtered. When nothing on the page names the reference at all, nothing is filtered and the count says so.
- Citations are read the way dealers write them: `Cr. 44/5`, `Craw. 44/5`, `RIC² 306`, `R.I.C. 306`, `RIC I (second edition) Nero 306`, `RIC X Leo I 605`, `RIC IV, part I,`, `SC 1266,2`, a suffix letter in either case, and a dealer listing `RIC 305, 306` cites both of them. A starting, hammer or realised price, a weight, a diameter or a die axis is never taken for a catalogue number, another catalogue's key ends the match, and only the volume on your card counts.
- A verified card with a denomination offers an **Only results naming …** switch, which narrows both providers' medians and shows its own count under each panel.
- A median per dealer grade under the range, once three counted sales share one, and a line saying how many counted results carry no grade at all, so a bucket of three is never read as the whole sample. Both go into **Copy summary**. Grades are read as the trade writes them — "Near EF", "Good very fine / About extremely fine", "Gutes sehr schön", "Obverse VF, reverse Fine", `NGC Choice VF 5/5 - 4/5` — and a description that cannot be read with confidence is left ungraded and counted in the no-grade line rather than put in the wrong bucket, so a collection name, a lot number or a control mark is never mistaken for a grade.
- Crawford (RRC), Price and Seleucid Coins references are answered from data inside the package, as RIC already was: a further 15,869 type records travel with the extension, so those type records are answered from inside the package: no request to numismatics.org or nomisma.org, and no site access needed for them. The price search that starts with every lookup still goes to acsearch whenever acsearch access is granted. The English Nomisma.org name of every authority, denomination, mint, material and portrait those records carry travels with them, so a local card reads the same as an online one without asking either site for a name, and RIC cards gain names for their denomination, mint, material and portrait too. The two concepts Nomisma publishes no English name for show as the identifier the record carries; no name is guessed. **Settings** lists every bundled catalogue with its own coverage, generation date, source and licence, and says what still goes online.
- House presets can carry the bid increment ladder you copied from that auction house's own terms: ordered "from: step" tiers, up to 20 per house, entered in **Settings** and kept in the currency the house writes them in. No house's ladder is shipped — the tiers are the ones you enter. The calculator walks that ladder: the highest affordable bid lands on the grid of the tier it falls in, a minimum bid that is off the schedule is rounded up, and a hammer that is off it is answered with the next valid bid. The fixed increment stays for one-off use.
- **Export raw data** in Settings copies your data as it stands — unsaved drafts, captured page text and pending request ids included — and works even when nothing else will load. Settings also shows any records that could not be read and can download those on their own.

### Changed

- Capturing the current page reads the auction lot's own structured data and page metadata before its visible text, ignores anything hidden on the page, and refuses a page it cannot read — a browser settings page, the extension's own pages, a local file — instead of saving an empty source.
- Bopearachchi references still go online: the public BIGR export carries no Bopearachchi citation, so a bundled answer could only be a hit that nothing had verified.
- Bundled lookups are much faster. A RIC number is read from an index of the numbers instead of by parsing all 52,254 bundled titles, and a reference that has to be broadened reuses the entries it already found. No bundled file exceeds 4 MiB, so RIC V ships as two halves and a lookup by identifier opens only the half its identifier falls in; the answers themselves are unchanged.
- A lookup the bundled data cannot answer now names the catalogue it really searched, instead of always naming OCRE.
- Backups are written compactly, so a full watchlist can be exported again, and backups saved by earlier versions still import.
- Merging a backup now really merges: your own settings and reminders stay, the version of a record that was written last wins, and a lot you already have is recognised even when the backup calls it by another name. Before anything is replaced, the summary lists every record that would change and every one that would be kept, names your own copy of each, says which fields the backup would change, and gives the date each side was last edited. A backup whose clock was wrong can no longer overwrite newer work, and a merge no longer drops the collection history the other computer recorded or fails outright because a reminder was edited there.
- Replacing or overwriting your records downloads a copy of them first, names the file it started downloading, and asks again if that copy cannot be made.
- A backup from a newer Giga Pinax says so, and says to update the extension first, instead of calling the file unsupported; a raw rescue file offered as a backup is turned away with the button to use instead.
- The default bid currency has one home. The popup's **Currency**, Settings, the bid calculator and price research read and write the same stored preference and can no longer disagree about it, while the research form's catalogue, number, volume and section stay in the popup's own storage. Existing records and older backups are migrated when they load.
- The code is released under the MIT licence, every push to `main` and every pull request runs both test suites, the build and the Firefox package lint, `python scripts/build.py` writes all five release assets in one command, and the eleven per-release notes have become this one changelog.

### Fixed

- A right-click lookup opens the coin you selected, wherever the cursor happened to be left in the lookup window, and a right-click while only the research panel's fallback window is open opens a proper lookup window.
- The reference you typed is waiting for you when a permission prompt closes the popup, so looking it up again works.
- **Research coin** waits until the captured fields hold a reference it can actually look up, and says so beside the fields when they do not. Saving a captured coin to the watchlist after an uncertain result no longer resends the previous coin's details.
- A capture from the right-click menu that could not be saved stays marked on the toolbar, with a tooltip saying what happened, until you open Giga Pinax or capture something successfully — and a capture that was saved is no longer reported as lost when only the workspace failed to open.
- One unreadable saved record no longer locks you out of everything, exports included: the rest of your data loads, the record is kept aside untouched with the links it had written down beside it, and Settings can download what was set aside.
- Reminders you have acknowledged or snoozed stay that way when you rename or edit an auction event, and an evening reminder the day before a clock change (Santiago, Havana, Beirut, Cairo) is delivered instead of being marked missed.
- Lots addressed by a page's hash route are no longer mistaken for one another, and two lots with different house, sale and lot numbers are never merged because they share a page.
- Correcting a lot back to "won" withdraws the collection review that the mistake asked for, here and when the correction arrives in a backup.
- Editing one part of a coin no longer freezes the rest of the workspace: the page keeps up with saved data while you type, and a form is never blanked by its own save. The "committed data changed" banner appears only when the record you are editing really changed, and says which form it means.
- The bid calculator keeps your figures: Enter no longer saves a plan from it, saving no longer clears it, and a saved hammer is never dropped into the budget field.
- Amounts can be typed with either a point or a comma in any language setting; `1,200` is refused as ambiguous rather than guessed.
- Filtering coins is faster and no longer moves the cursor out of the form you are filling in, and closing the tab with unsaved input now warns you first.
- A RIC volume written as a plain numeral finds the coin wherever OCRE files it: "RIC II 972" reaches both second-edition parts, and "RIC II Domitian 720" offers Domitian's own II.1² coin instead of Trajan's. The comma dealers put after a volume is read at last, in the Reference box and in a pasted lot — "RIC III, 394a" and "RIC II.3, 2345" are references, not stray text — and "RIC IV.1 266" is volume IV part 1 type 266, never volume IV type 1.
- One typed reference is now cleaned up exactly as a lot row is, so "RIC 268 (Elagabalus)", "RIC 972 var.", "RIC II 123 corr.", "RIC.112" and a range like "RIC 12-13" all read.
- A lot's ruler is read from its heading alone: a name inside the coin's legend or in "Head of …" is no longer mistaken for the issuer, and a lower-case letter after a name no longer hides it. Rulers are recognised by their English and Latin names in Nomisma ("Valerianus" offers both Valerians), "Valerian I" and "Licinius I" read as the first of two namesakes, and a heading that is itself a RIC section name, such as "Philip I", is searched as that section; spellings Nomisma does not carry, such as "Constantius I" or "Faustina II", still fall back to the choices for that number. A mint Nomisma gives a modern English name reaches its RIC section under that name, so "Trier" finds Treveri. Where more than one type fits, the choices are offered; a single answer is never the wrong coin.
- A bundled catalogue file that is damaged or out of step with the rest of the bundle is reported as unavailable, instead of being read as an empty catalogue that could answer that a coin is not in RIC. A dropped request for the bundled catalogue is retried on the next lookup instead of disabling it until the window is reopened.
- You are asked to sign in to acsearch only when acsearch itself says you are signed out, not when your only hits are lots that have yet to be sold.
- Excluding or including a sale keeps the keyboard on that row, and a failed CoinArchives retry no longer leaves the filter switches on screen with no results behind them.
- A lot headed with the Latin form of a ruler's name opens that ruler's coin. Nomisma gives Domitian no Latin name of his own while two later men carry "Domitianus", so "Domitianus, 81-96. RIC 1" opened a stranger's coin as its single answer; the heading now offers the three and settles on none, and the emperor's own 290 numbers between 1 and 400 open.
- A form no longer undoes your own correction: a field you saved and then typed back to what it was while the save was still running stays as you left it, and the next save keeps it.
- A right-click lookup sent to an open lookup window no longer files the coin under the sale you had captured in that window. A reference you type there yourself still belongs to the captured page.
- A card found under a mint's other English name is counted as this reference's card: "RIC VII Trier 12" opens RIC VII Treveri 12 and gets its denomination filter, its type link in **Copy summary** and its remembered search term.
- A range a dealer cites is looked up as the range — "Hadrian 100-102" opens the record OCRE titles over 100-102, not the one over 100.
- Prices that arrive before the type card are drawn again once it does, so the denomination filter and the type link are there straight away rather than after some later redraw, and the denomination filter now resets on a new lookup as the citation filter does.
- A merge no longer brings back a reminder you had already acknowledged on the other computer.
- A catalogue page that routes in its address's fragment captures the lot you are looking at, not the first one on the page.
- **Check online** keeps the reference you typed when its permission prompt closes the popup in Firefox.
- Changing the default currency in Settings, or importing records that carry another one, reaches the next popup you open: it no longer prices once in the old currency and then shows an empty panel. A window that had already priced from the cached currency, before its own stored one arrived, prices again in the currency that arrived, where acsearch access is granted, and asks for nothing where it is not; a window that opened with the currency it is showing keeps it (see Known issues). Changing **Currency** by hand while prices are on screen now fetches them again in the new currency too, instead of leaving an empty panel behind.
- **Settings → Updates** is hidden on a Chrome Web Store install, where the store keeps the extension up to date: the card goes by the update URL the store writes into the manifest it serves. An install from addons.mozilla.org, which sets no update URL, keeps the card, as an unpacked or temporary install does. Every package now carries the MIT licence at its root as `LICENSE.txt`.

### Security

- The planning and working logs that used to travel in the repository are no longer published; they recorded developer machine paths. They remain in the repository's published history up to this release.
- A crafted backup can no longer stop every reminder. A revision no write could have counted to, or an auction whose reminder falls outside the instants a record can hold, passed the import and then made every later reconcile fail silently. A file carrying such a revision is now refused whole; a file carrying such an auction is imported, and that one reminder is skipped rather than stopping the rest. A store that already holds either still opens with all its records, and a reconcile that fails says so on the toolbar.
- `alert.claim`, `alert.delivery.record` and `scheduler.reconcile` are the background's own commands and are no longer reachable from a page, and the background and the lookup window answer a message only from this extension's own pages.
- Hostile provider HTML no longer freezes the popup: half a megabyte of unclosed tags or array terminators from acsearch or CoinArchives was costing between one and thirty-five seconds of the popup's own thread, and is now refused in milliseconds.
- The release workflow uploads only into a draft — a tag re-pushed at a published release replaces nothing — and its checkout leaves no credential behind for a later step to push with.

### Known issues

- Lots graded "AU", including a slab's "AU", and a number of rarer grade spellings are counted as ungraded. They are still counted in the median and in the no-grade line; they simply reach no grade bucket.
- A comma-separated volume part reads nothing after RIC IV: "RIC IV, 1, 123a" is not recognised. Write it as "RIC IV.1 123a".
- A merge that recognises an incoming lot as a duplicate still adds that lot's auction event, so expect one duplicate event, and its reminders, to delete after such a merge.
- A second Giga Pinax window that is already open shows the old default currency until it is reopened.
- Increment ladders can be entered in USD, EUR, GBP or CHF only.
- Thirteen of the twenty-one RIC VI–IX mint sections carry no English modern name in Nomisma beyond the one RIC files them under. For five of them that name really differs, so a heading written London, Lyon, Arles, Milan or Pavia is not recognised: use RIC's own spelling — Londinium, Lugdunum, Arelate, Mediolanum, Ticinum. The other eight (Alexandria, Aquileia, Carthage, Heraclea, Ostia, Rome, Sirmium, Siscia) are already the name on the map. Eight sections do carry a second English name and are reached by either, so "Trier" finds Treveri.

### Upgrade notes

- Stored data moves to schema 2 on the first save after upgrading, and **0.31.1 cannot open it**: rolling back needs a build that reads schema 2.
- Export a backup before upgrading to keep a copy 0.31 can still read.
- The extension package grows from about 1.87 MB (0.31.1's released ZIP: 1,872,932 bytes) to about 2.49 MB (2,489,752 bytes), mostly for the bundled Crawford, Price and Seleucid Coins records, their labels and the RIC number index.

## [0.31.1] - 2026-09-15

### Fixed

- **Refine reference** searches run again. Leave the top search box empty, select a catalogue, fill its reference fields, and select **Search** or press Enter in a field. RIC volume and ruler take part in the same search, and values restored from an earlier lookup stay searchable.
- Text left in the top search box no longer overrides a newly refined reference. Top-box lookups are unchanged.

## [0.31.0] - 2026-09-15

### Added

- A separately labelled CoinArchives public-results median beside the acsearch one. Select **Get CoinArchives prices** after a lookup; the browser asks for optional access to `www.coinarchives.com` and the extension reads one public results page. No account credentials are used and the Pro archive is not read.
- The CoinArchives section states its own query, eligible sale count, date coverage and original currency, and its rows can be inspected. Coverage is auctions added in the past six months, up to the first 100 matches — not a full-archive median. The source reports hammer prices, excluding buyer premium.

### Changed

- Upcoming auctions, unposted or unreadable prices and conflicting duplicate records are excluded. Only prices in the selected currency reach the median: currencies and providers are never pooled.
- Each provider loads and fails independently. A CoinArchives retry keeps acsearch curation, and late catalogue details replace neither query. Provider rows stay in the Research session and never enter watchlist evidence or backups.

## [0.30.1] - 2026-09-15

### Added

- RIC ruler suggestions now include the verified people in the bundled records, including emperors absent from the mint-organised volumes VI–IX. Existing mint choices remain, and choosing a person keeps the selected volume. The names ship with the extension; no download, crawler or server is involved.

### Fixed

- Local lookup checks issuing authorities and obverse portraits, so `RIC VII Constantine II 287` resolves to **RIC VII Londinium 287**. `Constantinus II` is the same person; `Constantius II` is not. Several matches remain a choice.
- A pasted lot description carrying an OCRE identifier is read as a catalogue reference, and the identifier is used only after it agrees with the citation and the person. RIC price searches keep a single recognised ruler instead of searching the catalogue number alone.

## [0.30.0] - 2026-09-14

### Added

- Bundled OCRE reference data: 52,254 active Roman Imperial type records and 2,808 replacement redirects derived from the supplied RDF export, so RIC type details work without ANS access. Canonical identifiers are preserved and detailed records load from the package only when needed. Local cards, candidate choices and Settings name the data source.
- Attribution and source metadata in every package. The database is derived from American Numismatic Society OCRE data under ODbL 1.0; the conversion is reproducible from the repository.

### Changed

- Missing records keep an online fallback with an explicit **Check online** action when permission is needed. The snapshot covers OCRE/RIC only — Crawford/RRC, Price, Seleucid Coins and Bopearachchi still use their online sources — holds no auction prices or images, and has an unknown publication date. Conflicting source records are withheld and recorded in the metadata rather than guessed.

## [0.29.2] - 2026-09-14

### Fixed

- Price research starts from the parsed reference instead of waiting for an ANS type card, so an ANS outage no longer prevents a median that acsearch could supply. The acsearch controls and median stay available while catalogue details load, fail or await a more specific match.
- Catalogue details arriving later no longer replace an edited price term, reset included sales or relabel the active query, and changing the reference starts a separate search that older responses cannot overwrite.

## [0.29.1] - 2026-09-14

### Fixed

- A catalogue server error or rate limit is distinguished from a connection failure, and the acsearch and CoinArchives searches stay available for a safely parsed reference instead of being hidden behind "Check your connection". A failed lookup still creates no verified type card, saves nothing to Recent and enables no invented details; editing the reference clears the fallback links.

## [0.29.0] - 2026-09-14

### Added

- Auction page, house, sale and lot identity on captured coins, with duplicate lots detected rather than silently merged.
- Weight, diameter, condition, up to two external photo links, sourced provenance notes, shipping, payment fees and bid increments on a record.
- Total bid cost and the highest affordable hammer on a collector-entered increment grid.
- Closing soon, Needs research, Planned, Active and Completed queues, with timed deadlines distinguished from date-only auction starts.
- Comparison of two to four saved coins. Giga Pinax stores photo URLs, not photo files, and an external HTTP or HTTPS photo server is contacted only once comparison opens.
- Session curation of acsearch results: count, range, median, comparison and copied summary all follow the same included rows.

### Changed

- Auction context carries through current-page capture into Research, and save actions are guarded against repeated clicks. Schema version 1, existing records, the 5 MiB storage bound and the rule that Giga Pinax never places bids are all unchanged.

## [0.28.0] - 2026-09-13

### Added

- Research in the browser's native side panel or sidebar, with the toolbar popup still available for quick lookups.
- A compact watchlist beside one selected-coin detail pane, including optional private lot notes.
- One **Sources** menu for acsearch and the free and Pro CoinArchives routes, and a Settings view for theme, default bid currency, saved house premiums, updates and backup/import.

### Changed

- The shared calculator works from hammer plus buyer premium or from a total budget, with saved house premiums available wherever it appears. Shipping and tax stay outside its totals.
- Storage remains schema 1, so 0.27 records load without migration, and durable changes still use revision-checked commands.

## [0.27.2] - 2026-09-12

### Added

- A compact **CoinArchives Pro** disclosure in Research and in the workspace Search view. Existing subscribers can sign in on CoinArchives and open its ancient- or world-coin Pro archive directly; the extension handles no Pro credentials, detects no login state and fetches no paid data.

### Fixed

- Modern KM and Y references open CoinArchives World Coins; ancient references still open Ancient Coins.
- Remembered acsearch terms are isolated by corpus and record, so one catalogue cannot inherit another's term.
- Rapid right-click and pop-out lookups coalesce onto the latest request instead of losing it or opening duplicate windows.
- Workspace navigation reports the active page to assistive technology, and edits typed while a save is in flight reach the record that save creates.
- Enabling desktop alerts reconciles reminders already due, and failed delivery retries for five minutes while the event is still relevant. Date-only events use their saved timezone in the popup summary.
- Merge-import preview preserves local capture drafts.
- A reminder schedule is accepted only when its durable state and lifecycle reserve fit the 5 MiB budget; an oversized schedule is refused atomically rather than partly saved.

The accompanying audit of research, pricing, launch behaviour, records, reminders, backup, accessibility, packaging and layout is in [docs/AUDIT-2026-09-12.md](docs/AUDIT-2026-09-12.md).

## [0.27.1] - 2026-09-12

### Added

- **Updates** under the popup header, showing the installed version, opening the stable package for the current browser from the latest GitHub release, and opening the releases page. The repository is public, so no GitHub account is needed, and no credential or token is stored in the extension.

### Changed

- The extension never checks GitHub in the background, compares versions or installs an update silently; a download is always a deliberate action.

## [0.27.0] - 2026-09-12

### Added

- An auction companion beside research: Research, Calculator and Watchlist tabs in the existing 400 px popup.
- Exact hammer-plus-buyer's-premium calculation in USD, EUR, GBP and CHF, with per-currency exposure kept separate throughout.
- An editable current-page capture and a reviewed reference-to-watchlist handoff carrying only the displayed reference, a type label and a source page URL.
- A local workspace for lots, ranked alternatives, planned and externally active bids, reminders, outcomes, collection history, saved comparables and validated backups.

### Changed

- acsearch stays scoped to one collector action, one results page and session-only display. Fetched rows, prices, identifiers, medians and claims are never written into drafts, records, exports or backups. Saved comparables are collector-entered and their statistics stay separate from the live price panel's.

[Unreleased]: https://github.com/bth0mp/Giga-Pinax/compare/v0.32.0...HEAD
[0.32.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.32.1
[0.32.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.32.0
[0.31.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.31.1
[0.31.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.31.0
[0.30.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.30.1
[0.30.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.30.0
[0.29.2]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.29.2
[0.29.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.29.1
[0.29.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.29.0
[0.28.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.28.0
[0.27.2]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.27.2
[0.27.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.27.1
[0.27.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.27.0
