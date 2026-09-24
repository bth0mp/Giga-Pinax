# Real acsearch pages

Every other acsearch fixture is written by hand. A page saved here is the only check that the price parser reads the
results page acsearch really serves to a signed-in collector. `tests/acsearch-real.test.mjs` reads every `*.html` in
this folder and asserts only what must hold of any page, so no expectations need writing:

- the parser finds the results array;
- every priced row names exactly one currency (a bare number would be counted in every currency's median), and each is
  counted in that currency alone;
- every date reads as a day, and every priced row has one;
- the grade medians and, when the search is given (below), the citation filter count no more sales than the page has.

The test skips while the folder holds no page. Nothing in it is committed by the tooling: a page goes in only after the
steps below.

## Save, scrub, review

1. Signed in to acsearch.info, run the search you want (for example `Nero "RIC 306"`, category Ancient coins, one
   currency) and let the results load.
2. Save the page as **Web Page, HTML only** (Ctrl+S). Save it **outside the repository**, for example to your
   Downloads folder: the saved original names you and must never be committed.
3. Scrub it into this folder, giving your acsearch user name and the e-mail address of the account (each is replaced
   wherever it appears, then checked for):

   ```
   python scripts/scrub_acsearch.py path/to/saved/acsearch.html tests/fixtures/acsearch-real/ric-nero-306-usd.html --account YOUR_NAME --account you@example.org
   ```

   The script prints what it removed. It exits 1 and writes nothing if anything on its denylist is still in the page
   (an e-mail address, your name, a Logout/Abmelden block, a session or token parameter, a script, a form field, a
   comment, a link off acsearch.info); read the message, and do not work around it by editing the original.
4. Read the summary. `result rows lost their '…' field` names the fields of a lot the page carried besides id, title,
   description, date, price and last. If one of them is what the extension should read, say so in an issue rather
   than adding it to `ROW_FIELDS` unseen: a signed-in row may carry your own watch state or bid.
5. Read the scrubbed file through in a text editor before committing it. Search it for your name, your e-mail, your
   bidder or customer number, your city and anything else that is yours. The denylist cannot know every way a page
   can name you; you do.
6. Optionally give the search the page answers, in a file of the same name ending `.json`, so the citation filter is
   checked too:

   ```json
   { "reference": { "catalogue": "RIC", "volume": "I", "section": "Nero", "number": "306" } }
   ```

7. Run `node --test tests/acsearch-real.test.mjs`. A failure is a finding about the parser on the real page, not
   about the test: report it with the failing message rather than editing the page to pass.

To try a scrubbed page without putting it here, point the test at its folder with the `GIGA_PINAX_ACSEARCH_REAL`
environment variable: `GIGA_PINAX_ACSEARCH_REAL=path/to/folder node --test tests/acsearch-real.test.mjs` in a POSIX
shell, or `$env:GIGA_PINAX_ACSEARCH_REAL = 'path\to\folder'` and then the same `node --test` in PowerShell.

The lot titles, descriptions and prices kept are the auction houses' public catalogue text as acsearch shows it.
Whether a real page may be committed to the public repository is the owner's decision.
