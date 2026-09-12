# Giga Pinax — price audit, 2026-09-13

Read at 0.25.0, bumped to 0.26.0 under me mid-audit (`manifests/brave.json:4`). **Code untouched by this
audit.** `extension/lot.js` and `tests/lot.test.mjs` were not read or touched — the 0.26 work is in flight
there. `git diff` confirms the 0.26 work changed **nothing** in `extension/prices.js`, `extension/popup.js` or
`tests/prices.test.mjs`, so every line number below is stable.

**No request was made to acsearch or CoinArchives.** Everything below comes from the repo: `extension/prices.js`,
`extension/popup.js`, `tests/prices.test.mjs`, and the one real acsearch page saved in
`tests/fixtures/acsearch-search-nero-306.html`. Anything I could not verify that way I built myself as synthetic
lots and ran through the repo's own `summarise()`.

Every finding is marked **[ran it]** — I executed the repo's code in a scratch script outside the repo and the
numbers quoted are its output — or **[read it]** — I read the code or the saved page and reasoned. All 49 tests in
`tests/prices.test.mjs` pass at this commit **[ran it]**, so nothing below is a broken build. The problems are in
what the working code chooses to say.

This audit exists because of two things you said: *"It only did 300 when a coin clearly shows 950"*, and
*"how far to trust the median"*. **Section 2 answers the first. Section 3 answers the second.** The short version
of both is in the box below.

---

## The short version

> The median is not an estimate of *your* coin. It is the middle price of the last hundred auction lots whose
> text happened to contain your search words — **all grades, all conditions, all sizes, mixed together**. For a
> common bronze that pile is mostly worn Fine and VF examples. A clean EF coin at $950 is not contradicted by a
> $300 median. **Both numbers are right, and the tool never says so.**
>
> I reproduced your complaint with a page containing **no errors at all** — the right coin, every lot genuine,
> nothing miscounted. The median came out **$239 against a real $950 asking price, a 4.0x gap, and the panel
> labelled it "Solid"** **[ran it]**.
>
> That is the finding. The 300-vs-950 gap needs no bug to happen. It is the normal behaviour of the tool.

---

## 1. What the median is actually a median of

### 1.1 The pipeline, end to end

Reading `fetchPrices` → `extractLots` → `summarise` → `renderPrices` **[read it]**:

1. **One request, one page.** `buildSearchUrl` (`prices.js:10`) sends `term`, `category`, `currency` and
   `order=1`. The saved page's own radio buttons say `order=1` is **"Most recent entries first"**
   (`acsearch-search-nero-306.html`) **[read it]**. So page 1 is a *time slice*, not the best matches.
2. **At most 100 lots.** The saved page sets `acsearch.searchItemsPerPage = 100` **[read it]**, and
   `fetchPrices` slices to `PAGE_SIZE = 100` anyway (`prices.js:299`). There is a "Load more results" button on
   the real page; the extension never presses it **[read it]**.
3. **The page states its own total, and the extension throws it away.** The saved page's header reads
   `Results 1-100 of 623 for nero 306` **[ran it —** I re-extracted that string from the fixture**]**. The panel
   prints `Out of 100+ matches`. The figure 623 is sitting in the HTML, unread.
4. **Each lot is reduced to four fields** — `id`, `title`, `date`, `price` (`prices.js:32`). **The description
   is discarded.** Nothing downstream can know the grade, the metal, the denomination, the weight, whether it is
   a group lot, or whether the catalogue number in it is even the one you searched for.
5. **The price string is parsed strictly** (`parsePrice`, `prices.js:50`). One amount only; two numbers, a
   bracketed conversion or an estimate all fail closed to `null`. Verified on the repo's own cases **[ran it]**.
6. **Everything that survives is pooled and the middle one taken** (`summarise`, `prices.js:181`).

### 1.2 What is dropped, and how it is described

Run on a mixed page **[ran it]**:

| Price string | Where it lands | What the panel calls it |
| --- | --- | --- |
| `1,200` | counted | a sale |
| `*` (signed out) | `unpriced` | "without a price" |
| `` (empty) | `unpriced` | "without a price" |
| `-` | `unpriced` | "without a price" |
| `unsold` | `unpriced` | "without a price" |
| `Premium` | `unpriced` | **"without a price"** |
| `Log in` | `unpriced` | **"without a price"** |
| `200 EUR` when USD asked | `uncounted` | "not counted" |
| `200 USD (estimate 150 USD)` | `uncounted` | "not counted" |

The last two rows are honest. **The `Premium` and `Log in` rows are not.** The real page's own dictionary
defines `acsearch.dict.searchLoginRequired = 'Log in'` and `acsearch.dict.searchPremiumRequired = 'Premium'`
**[read it — both strings are in the saved page]**, but `summarise` only treats the literal `*` as a
signed-out marker (`prices.js:199`). A page of `Premium` prices returns `signedOut: false, unpriced: 20,
count: 0` **[ran it]**, so you get *"No hammer prices among the sales acsearch returned"* instead of *"sign in"*.
Worse, in a **mixed** page three gated lots and six visible ones give `median 302.5 · 6 counted · 3 without a
price` **[ran it]** — three coins you are not allowed to see are presented to you as three coins that failed
to sell.

### 1.3 Hammer or hammer-plus-fee

**Hammer.** The saved page sets `acsearch.dict.searchPrice = 'Hammer'` and the lot-details table's fifth
column header is literally `Hammer` **[read it]**. The panel's claim *"Hammer prices exclude buyer's fees, tax
and shipping"* is correct. Nothing in the code adds or removes a premium **[ran it — a single lot of `1000`
comes back as median 1000]**.

**But note what this means for you at the paddle.** A $300 median hammer against a 20–25% buyer's premium is
**$360–$375 out of your pocket**, before tax and shipping. The panel says the right thing in the small print at
the bottom and then puts the bare hammer figure in 44px type at the top.

**Caveat you should know about:** `docs/ideas-backlog.md:37` still says *"Awaiting the first real run on a
Premium account to confirm the logged-in price format"*, and every lot in the only saved page has
`price: "*"` **[ran it]**. **No signed-in acsearch page has ever been seen by this code.** The strict parser
is a guess that fails closed, which is the right way to guess — but the first time you run it signed in, the
thing to check is the `Not counted:` line.

### 1.4 Currency

`parsePrice` rejects a price whose currency mark disagrees with the one you chose (`prices.js:55`) **[ran it —
`parsePrice('200 EUR','USD')` is `null`]**. Good. But a **bare number is accepted under any label**: the same
three lots `900 / 1,100 / 1,000` give median `1000` labelled USD, EUR, GBP or CHF **[ran it]**. The extension
trusts that acsearch honoured `currency=usd`. If it ever ignores that parameter and returns bare euro figures,
you will be shown euro numbers with a dollar sign and nothing will complain.

### 1.5 Multiple-coin lots

Nothing divides by the number of coins **[ran it]**. A `Lot of 12 Roman bronzes` at $1,400 enters the pool as a
single $1,400 "sale". Eight such group lots among 100 singles moved the median from 239 to 265 **[ran it]** —
upward per lot, while the true per-coin price was a fraction of it.

### 1.6 Say it plainly

> **What the number means.** Giga Pinax asks acsearch for the **100 most recent auction lots** whose text
> contains all the words of your search term, takes the ones that show a **hammer price** (not what the winner
> actually paid — add 20–25% buyer's premium), and shows you the **middle one**.
>
> **Every way it can differ from the dealer page in front of you:**
> - That dealer coin has a **grade**. The median has no grade — it is every grade averaged into one number, and
>   most auction appearances of a common type are worn. *(Biggest single cause. See §2.)*
> - It is **hammer, not paid**. Add the premium before you compare.
> - The search matches **words, not coins**. Any lot containing your ruler's name and your number anywhere —
>   in a different catalogue's citation, a lot number, a diameter — is in the pile.
> - It is the **last 100 sales, not all sales**. For "Nero 306" acsearch held 623; you saw 100.
> - **Unsold lots are not in it.** If the market rejected this coin forty times at $900, the median never hears
>   about it.
> - **Group lots count as one coin.**
> - A **forgery or a tooled coin** that sold for $30 counts exactly as much as a genuine one.
> - The sales may span **fifteen years** at whatever prices were normal then.
> - It is **one currency label applied to whatever acsearch returned.**

---

## 2. Reproducing "it only did 300 when a coin clearly shows 950"

All scenarios below are synthetic lots I wrote, pushed through the repo's real `summarise()` **[ran it]**. Price
levels are my own estimates of what a Nero As, RIC I 306 (Temple of Janus) actually fetches by grade.

### 2.1 The headline result: no bug is required

A page containing **only** the correct coin, every lot genuine, in the grade proportions such a type actually
appears in (34 Fine, 38 VF, 18 good VF, 10 EF):

```
median 239 | mid-50% 127-498 | range 72-2475 | 100 counted of 100 (Solid)
dealer asks 950 -> 4.0x the median
median of the EF sales alone: 1450
```

**[ran it]** The $950 coin is an EF. The panel's median is the median of a *Fine-and-VF pile*. Both numbers are
correct descriptions of different things. The tool shows one and implies the other.

### 2.2 The causes, ranked by how often they would bite you

| # | Cause | Median | vs. clean 239 | Gap to $950 |
| --- | --- | --- | --- | --- |
| — | *clean baseline, right coin, all grades* | **239** | — | 4.0x |
| **1** | **Grade mix (no contamination at all)** | **239** | **this IS the baseline** | **4.0x** |
| **2** | Term matches the wrong coins — 45 cheap false matches | **132** | −45% | 7.2x |
| **3** | Sales span 2010–2014 plus 2025–2026 | **134** | −44% | 7.1x (recent 20 alone: 509) |
| **4** | Denomination/metal mix under one number (AE/AR/AV) | **272** | +14% | 3.5x |
| **5** | Unsold lots dropped (30 sold cheap, 25 bought in near 900) | **272** | +14% | 3.5x |
| **6** | Group lots counted as single coins | **265** | +11% | 3.6x |
| **7** | 4 modern forgeries among 100 real sales | **235** | −2% | 4.1x |
| **8** | 12 expensive false matches (aurei, sestertii) | **288** | +21% | 3.3x |
| **9** | Wrong currency | — | fails closed to "not counted" | — |

**[ran it — every row]**

**Ranked by how often it bites, and how hard:**

1. **Grade mix — every single search, always.** It needs nothing to go wrong. It is 100% of searches and it
   alone produces a 4x gap. **This is your complaint.** Nothing else on this list is close.
2. **The term matching the wrong coins — most searches, sometimes severe.** `prices.js:72` documents acsearch's
   behaviour: *"acsearch ANDs every word anywhere in a lot ('20' matched '20 mm')"*. `Nero 306` means *any lot
   containing the token "nero" and the token "306"* — including `BMC 306`, `Cohen 306`, `RPC 306`, lot 306,
   auction 306. **Hard evidence from the only real page in the repo:** of the three lots saved in
   `acsearch-search-nero-306.html`, **one is a Cappadocian silver drachm (RPC I 3648)** — a different metal, a
   different denomination, a different province, not RIC 306 at all — and it sits at position 1, the most recent
   match **[ran it — I parsed the fixture and read all three descriptions]**. One in three, in the only real
   sample that exists.
   Sensitivity **[ran it]**: it takes about **40 cheap false matches out of 140** to halve the median
   (239 → 139). At 20 false matches you are still down 18%. And the strength word said **Solid** at every single
   step.
3. **Time span — common on a slow-moving type.** When only 20 of 70 sales are recent, the median reads 134
   while the recent 20 alone read 509 — **a 3.8x error caused purely by old sales** **[ran it]**. The period
   buttons exist for this, but see §5.2 for why they can't always help.
4. **Denomination/metal mix — common on RIC numbers.** A RIC number is per-denomination, but `defaultTerm`
   builds `Ruler Number` (`prices.js:137`) with nothing to pin the metal.
5. **Unsold lots — common on expensive or optimistically-reserved types.** 25 bought-in lots at a ~$900 reserve
   are invisible to the median; the panel notes "25 without a price" and the number ignores them **[ran it]**.
   This one *understates* market strength precisely when you most need to know it.
6. **Group lots — occasional.**
7. **Forgeries — occasional, and mild.** Four fakes barely moved the median (239 → 235). Worth knowing so you
   *don't* worry about it.
8. **Expensive false matches — occasional, and they lie the other way** (median up 21%), which is the dangerous
   direction: it makes a high asking price look justified.
9. **Wrong currency — rare, and already safe.** It fails closed to "not counted" rather than corrupting the
   number **[ran it]**. Good design; leave it.

### 2.3 The one that makes several of these worse

`order=1` is *most recent first*, so the 100 lots you get are a **time window, not a sample**. On a busy type
that window may be a few months. On a quiet type it may be fifteen years. You cannot tell which from the panel,
because the panel reports the years but never the depth **[read it]**.

---

## 3. The strength indicator

### 3.1 What it measures today

```js
export const medianStrength = (count) => (count >= 15 ? 'Solid' : count >= 5 ? 'Moderate' : 'Thin');
```
`prices.js:217` **[read it]**

It measures **exactly one thing: how many sales there are.** Nothing else. Not the spread, not the years, not
the currency, not how many lots were dropped.

### 3.2 Does it measure the right thing? No.

Your own example, run for real **[ran it]**:

| Case | n | Median | Middle 50% | Q3/Q1 | **Today's word** | 95% band for the median |
| --- | --- | --- | --- | --- | --- | --- |
| 40 sales, 10x spread | 40 | 263 | 172–540 | 3.1 | **Solid** | 190–498 (**±59%**) |
| 8 sales, tightly clustered | 8 | 453 | 436–477 | 1.1 | **Moderate** | 431–493 (**±7%**) |

**The 40-sale mush outranks the 8-sale cluster, and it is eight times less trustworthy.** You had this exactly
right.

It gets worse: the word said **Solid** on every contaminated page in §2.2, including the one with 45 wrong
coins in it, and on a 100-lot page whose middle 50% spanned $123–$471 **[ran it]**.

### 3.3 A better rule

**"How far to trust the median" has a real, exact answer** that uses nothing but the sales already on screen: the
**distribution-free confidence band for a median**, from order statistics (the sign test). No assumption about the
shape of the distribution — which matters, because coin prices are nowhere near a bell curve.

Take the counted sales sorted low to high, `n` of them. Let `k` be the largest index with
`P(Binomial(n, ½) ≤ k−1) ≤ 0.025`. The 95% band is **from the k-th cheapest sale to the k-th dearest**. I computed
`k` exactly **[ran it]**:

| n | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| k | **none** | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 3 |

**Below six counted sales, no 95% band exists at all.** That is not a judgement call, it is arithmetic — and it
gives you a non-arbitrary floor.

**Proposed rule.** Let `half` = half the band's width, as a percentage of the median.

| Condition | Word | What to show |
| --- | --- | --- |
| `count < 6` | **no word, no median** | "Only N sales — too few to give a middle price. Here they are:" + the list |
| `half ≤ 10%` | **Solid** | "Solid: the middle price is $X, and I'm confident it's within ±10%." |
| `half ≤ 25%` | **Moderate** | "Moderate: probably $X, but anywhere from $lo to $hi." |
| `half ≤ 50%` | **Weak** | "Weak: these sales are too scattered to pin down. Somewhere between $lo and $hi." |
| `half > 50%` | **no word, no median** | "These sales are all over the place ($min to $max). A single middle price would mislead you." |

Scored against the same cases **[ran it]**:

| Case | n | Median | Today | **Proposed** | Band |
| --- | --- | --- | --- | --- | --- |
| 40 sales, 10x spread | 40 | 356 | Solid | **Weak** | 207–543 (±47%) |
| 8 sales, tight | 8 | 500 | Moderate | **Solid** | 472–551 (±8%) |
| 100 sales, Nero-306 shape | 100 | 252 | Solid | **Weak** | 211–353 (±28%) |
| 16 sales, tight + 1 record sale | 16 | 281 | Solid | **Solid** | 263–305 (±7%) |
| 22 sales, modest spread | 22 | 488 | Solid | **Moderate** | 350–573 (±23%) |
| 60 sales, metal mix | 60 | 253 | Solid | **Weak** | 138–317 (±35%) |
| 7 sales, tight | 7 | 737 | Moderate | **Solid** | 706–796 (±6%) |
| 4 sales | 4 | 757 | Thin | **no number** | — |

Every row moves in the direction your instinct pointed.

**Why these thresholds and not others.** I calibrated against realistic type spreads **[ran it]** — typical band
half-width, by how varied the type is and how many sales there are:

| Type spread | n=8 | n=12 | n=20 | n=30 | n=50 | n=100 |
| --- | --- | --- | --- | --- | --- | --- |
| tight (x1.3) | 11% | 7% | 6% | 5% | 4% | 3% |
| modest (x2.3) | 34% | 23% | 18% | 15% | 12% | 9% |
| wide (x4.7) | 63% | 44% | 34% | 28% | 23% | 16% |
| very wide (x10) | 99% | 66% | 51% | 41% | 34% | 24% |
| huge (x37) | 189% | 110% | 84% | 67% | 55% | 38% |

- **10% for Solid** because it is the level a tight type reaches by n=6–8, and because ±10% is roughly one
  bidding increment — below that the number is decision-grade.
- **25% for Moderate** because a modest-spread type reaches it around n=12–20, which is what "a decent run of
  comparables" feels like, and because ±25% still leaves a usable range to bid inside.
- **50% as the cutoff for showing any median at all** because beyond that the band is wider than the number,
  and the table shows only "very wide" and "huge" types land there — which are exactly the searches where the
  pile is contaminated or mixed-denomination. **That row is your $300 median.** Under this rule the Nero-306
  page would have said *Weak, $211–$353*, and a 100-sale page of grade-mixed junk would have refused the number
  outright.
- The **±% belongs on screen next to the word**, not hidden behind it. "Solid" alone is what got you here.

**Also add a second, separate line** — the band answers "how well do I know the middle?", but you also need
"how much do these coins differ from each other?" That is `Q3/Q1`. When it exceeds about **2.5**, say so in
words: *"These coins vary hugely — the middle half ran $123 to $471. Grade is doing most of that. Your coin's
grade decides where in that span it belongs."* That single sentence would have prevented this audit.

---

## 4. Outliers (1.5 x IQR)

I ran Tukey's fence on realistic distributions, tagging each lot as genuine or junk beforehand so I could count
what the fence actually caught **[ran it]**:

| Scenario | Median → trimmed | Fence | Junk caught | **Genuine sales wrongly flagged** |
| --- | --- | --- | --- | --- |
| 1. clean type, real grade spread | 304 → **278** | 0–947 | — | **10** |
| 2. + 45 cheap wrong coins | 133 → 120 | 0–771 | **0 of 45** | **10** |
| 3. + 12 aurei/sestertii | 332 → 278 | 0–1227 | 12 of 12 | **10** |
| 4. + 4 modern forgeries | 292 → 269 | 0–944 | **0 of 4** | **10** |
| 5. tight type + 1 genuine record sale | 277 → 262 | 178–372 | — | **1** (the record sale) |
| 6. tight type + 1 wrong cheap coin | 1022 → 1046 | 723–1302 | 1 of 1 | 0 |

### The verdict: **do not let it touch the median. Annotate, and only sometimes.**

1. **On a clean page it flags ten genuine high-grade sales and pushes the median from 304 down to 278.** It
   would make your 300-vs-950 complaint **worse**, not better. The upper tail of a coin-price distribution is
   not noise — **it is the good coins.** It is where your $950 example lives.
2. **On the genuinely poisoned page it catches nothing** — 0 of 45 wrong coins, 0 of 4 forgeries. The
   contamination is *cheap*, which drags Q1 down, which widens the IQR, which widens the fence, which lets the
   contamination through. The fence is blindest exactly when you need it.
3. **It only works against a tight bulk** (rows 5 and 6). In row 6 that is genuinely useful. In row 5 it flags a
   $14,000 sale of a coin that normally does $280 — and **that is the single most important fact on the page**,
   not an error to be swept away.

**Recommendation:** compute the fence, never apply it to the median, and use it for **one** thing — when the bulk
is tight (say `Q3/Q1 ≤ 1.5`) and the fence flags **three or fewer** sales, put a line under the median:
*"1 sale sits far outside the rest: $14,000 on 12.03.2025 — worth a look before you bid."* with a link to the
lot. That turns an outlier from a statistical nuisance into the piece of news it actually is. Below that bar,
stay silent.

---

## 5. Trend and last sale

### 5.1 Neither honours the period. Verified.

`popup.js:467` calls `trendOf(lots, ...)` and `popup.js:470` calls `lastSale(page)` — both take the **whole
page**, while everything else on the panel comes from `lotsInPeriod(...)` (`popup.js:453`) **[read it]**.
Confirmed by running all three periods over one page **[ran it]**:

```
period "All"          : panel median 610 over 6 sales
period "Last 5 years" : panel median 950 over 3 sales
period "Last 2 years" : panel median 950 over 3 sales
trend line, in all three cases: "Last 2 years: $950 median, up 217% on earlier sales ($300)"
last sale,  in all three cases: 01.06.2026
```

**The trend is always a 2-year comparison, whatever button you pressed.** Pick "Last 5 years" and you get a
sentence about 2 years, with no label saying so. The earlier audit's §1.10 flagged the last-sale half of this;
the trend half is the same bug and nobody has written it down.

And the contradiction is real **[ran it]** — with sales only from 2016–2019 and "Last 2 years" selected, the
panel prints, one line above the other:

```
No sales with a price in the last 2 years.
Last sale 12.03.2019 - $180
```

### 5.2 "All" is not all

On a busy type where the 100 returned lots all fall inside two years, the three period buttons produce
**identical output** — same 100 sales, same median, same everything **[ran it]**. The buttons can only ever
*narrow*, never widen: "All" can never reach further back than the 100th most recent sale. For "Nero 306" that
means 100 of 623. Calling it "All" is the panel's plainest untruth.

### 5.3 A period button can drop sales for the wrong reason

`lotsInPeriod` drops any lot whose date string `saleDate` cannot read (`prices.js:255`) **[read it]**. `saleDate`
accepts only `dd.mm.yyyy` and `yyyy-mm-dd`. Run on four lots **[ran it]**:

```
"2026/07/01" -> UNREADABLE     "July 2026" -> UNREADABLE     "1.7.2026" -> UNREADABLE     "01.07.2026" -> ok
All          -> 4 sales, median 500
Last 5 years -> 1 sale,  median 900
```

Pressing "Last 5 years" dropped three *recent* sales and changed the median by 80% — not because they were old,
but because their date string was a shape the reader doesn't know. Silently. Note `1.7.2026` — a single-digit
day or month is not accepted, and that is a format auction sites really do emit.

### 5.4 Should a two-point "trend" be shown at all? Mostly, no.

I ran a Monte Carlo: recent sales and earlier sales drawn from **the same unchanging distribution** — a
perfectly flat market, nothing to report. How often does `trendOf` + `trendText` announce a move anyway
**[ran it]**?

**A wide type (prices 90–900 — i.e. any normal grade spread):**

| n per side | says "up/down" | claims ≥20% | claims ≥50% | worst it ever claimed |
| --- | --- | --- | --- | --- |
| **3** *(today's minimum)* | **95%** | **80%** | **50%** | **up 668%** |
| 5 | 93% | 77% | 41% | 562% |
| 8 | 91% | 69% | 28% | 387% |
| 12 | 90% | 64% | 21% | 288% |
| 20 | 87% | 56% | 14% | 241% |
| 30 | 85% | 48% | 6% | 176% |

**A tight type (prices 420–560):**

| n per side | says "up/down" | claims ≥20% |
| --- | --- | --- |
| 3 | 56% | 3% |
| 8 | 37% | 0% |
| 20 | 19% | 0% |

Read the first table again. On a normal, wide-spread type with **a completely flat market**, today's trend line
announces a move **95% of the time**, announces a move of 20% or more **80% of the time**, and once told me the
market was **up 668%**. At `TREND_MIN = 3` the whole sentence rests on the 2nd of 3 coins on each side — **two
coins decide it** **[ran it]**.

**And raising the threshold does not fix it.** At 30 a side it still cries wolf 85% of the time. The problem is
not the count, it is the spread: a wide grade mix means the two medians wander regardless of how many you take.

**The fix.** Show a trend only when the two medians' 95% bands (§3.3) **do not overlap**. Scored **[ran it]**:

| Type | n/side | flat market (should be 0%) | real +30% rise | real +100% rise |
| --- | --- | --- | --- | --- |
| tight | 8 | **0%** | **100%** | **100%** |
| tight | 30 | **0%** | **100%** | **100%** |
| modest | 15 | **0%** | 11% | **99%** |
| modest | 30 | **0%** | 32% | **100%** |
| wide | 15 | **0%** | 1% | 9% |
| wide | 30 | **0%** | 3% | 30% |

**Zero false alarms in every case**, full power where a move is genuinely detectable, and honest silence on a
wide type — because on a wide type **you genuinely cannot tell**, and the current line pretends otherwise.

**Recommendations, in order:**
1. **Gate the trend on non-overlapping bands.** When they overlap, either hide the line or say
   *"No change I can prove — these sales are too varied to tell."*
2. **Make the trend follow the chosen period**, or label it *"Trend (last 2 years, regardless of the period
   above)"*. Silent disagreement is the worst of the three options.
3. **Make "Last sale" follow the period too**, or suppress it when the period has no sales, so the two
   contradictory lines in §5.1 can never appear together.
4. **"Last sale" is the most trustworthy thing on the whole panel** — one real coin, one real price, one real
   date, linked to the lot. It deserves to be nearer the top than the trend, not below it.
5. **Rename "All"** to *"All 100 shown"* or *"As far back as acsearch sent"*.

---

## 6. The price check

### 6.1 What it says today

```js
`Higher than ${below} of ${sales(count)}, ${ratio.toFixed(1)}× the median`
```
`popup.js:523`, over `priceCheck` (`prices.js:220`) **[read it]**.

`below` counts sales **strictly** under the amount — correct, ties excluded. `ratio` is
`amount / summary.median`. Both are computed from the period-filtered summary, so at least they agree with the
big number above **[read it]**.

### 6.2 Where it overstates

**a) It will render a verdict from one sale.** `showCheck` only requires `summary.count` to be non-zero
(`popup.js:518`) **[read it]**. Run **[ran it]**:

```
1 sale (640)            | check 950 -> "Higher than 1 of 1 sale, 1.5× the median"
2 sales (300/1200)      | check 950 -> "Higher than 1 of 2 sales, 1.3× the median"
```

*"1.5x the median"* from a single coin is not a statistic, it is a coincidence with a decimal point on it.

**b) "Higher than 92 of 100 sales" is technically true and practically a lie.** On the realistic Nero-306 page
**[ran it]**:

```
median 259 | mid-50% 123-471 | range 71-2319
check 950 -> "Higher than 92 of 100 sales, 3.7× the median"
truth:      10 of 100 sales were 850 or more.
```

A collector reads *"higher than 92 of 100"* as **"you are overpaying badly."** What it actually means is *"you
are looking at a nicer coin than 92 of these."* **The sentence has no idea which of those two it means** — it
threw the descriptions away in §1.1.

**c) The range bar makes every realistic price look extravagant.** `rangePercent` is linear
(`popup.js:433`) but coin prices are not. On the same page **[ran it]**:

| | Amount | Position on the bar |
| --- | --- | --- |
| Q1 | 123 | **2.3%** |
| median | 259 | **8.3%** |
| Q3 | 471 | **17.8%** |
| a 950 check | 950 | **39.1%** |

**Half of all sales are squashed into the left 8% of the bar.** The "middle 50%" box is a sliver at the far
left, and any price you type flies out to the right of it. The picture says *"you are way above normal"* for a
price that is, in truth, an unremarkable good-grade result. **A log scale fixes this** and costs one line:
`Math.log(v)` in place of `v` inside `rangePercent`. Same page, same sales, both scales **[ran it]**:

| | Amount | Linear (today) | **Log (proposed)** |
| --- | --- | --- | --- |
| Q1 | 123 | 2.3% | **15.6%** |
| median | 259 | 8.3% | **37.1%** |
| Q3 | 471 | 17.8% | **54.3%** |
| a 950 check | 950 | 39.1% | **74.4%** |

On the log bar the middle-50% box is a visible block across the centre and the $950 marker sits just past its
right edge — which is the honest picture of what $950 is.

### 6.3 Rewritten verdicts

Replace the single sentence with a rule that says only what the data supports. The figures in the examples are
the real output for the §6.2 page **[ran it]**:

| Situation | Say this |
| --- | --- |
| `count < 6` | **"Only N sales to compare against — not enough to judge a price. Here they are."** *(then list them; no ratio, no count-below, no marker)* |
| Band half-width `> 50%` | **"These sales are too scattered to judge a price against. $950 falls inside the range they cover ($71–$2,319), which is all I can honestly tell you."** |
| Amount inside the middle 50% | **"$450 is an ordinary price for this type — it sits inside the middle half of recent sales ($123–$471). Whether it's right for *this* coin depends on its grade."** |
| Amount above Q3 | **"$950 is above the middle half of recent sales ($123–$471), but 10 of 100 sales were $850 or more. That's the price band good examples fetch. Compare grade, not just numbers."** |
| Amount above the highest sale | **"$3,000 is more than any of these 100 sales ($71–$2,319). If this coin is exceptional that can still be right — but nothing here supports it."** |
| Amount below Q1 | **"$90 is below the middle half ($123–$471) — 86 of these 100 sales went higher. Either it's a bargain or it's a problem coin; check the grade and the surfaces."** |
| Always append, when hammer is what was compared | **"These are hammer prices. At a 20% buyer's premium you'd actually pay about $1,140."** |

Three principles behind those:
- **Never a multiple of the median as the headline.** "3.7x the median" is a true number that answers a
  question nobody asked. Position against the *middle half* is what a bidder needs.
- **Always name grade as the missing variable.** The tool cannot see it, and it is the biggest term in the
  equation. Saying so is not a weakness, it is the single most useful sentence on the panel.
- **Always convert hammer to what leaves your account**, at the point where you are about to decide.

---

## 7. What the tool should refuse to say

Ranked by how much a bad bid each one prevents. Thresholds are the ones calibrated in §3.3.

| # | Number | Refuse when | Show instead |
| --- | --- | --- | --- |
| **1** | **The median** | fewer than **6** counted sales (no 95% band exists — §3.3), **or** band half-width **> 50%** | The sales themselves, as a list, with dates and links: *"N sales, $min to $max. Too few / too varied for one middle price."* |
| **2** | **The strength word** | fewer than **6** counted sales | *"Only N sales."* — a count, not a verdict |
| **3** | **The trend** | the two medians' 95% bands **overlap** (§5.4), or either side has fewer than **6** sales | Nothing, or *"No change I can prove."* Never a percentage. |
| **4** | **The price-check verdict** | fewer than **6** counted sales, or band half-width **> 50%** | *"Not enough comparable sales to judge a price."* Keep the sales list. |
| **5** | **"× the median"** | **always** — retire the phrasing | Position against the middle 50%, in words (§6.3) |
| **6** | **The middle 50% band** | fewer than **4** counted sales (below 4, quartiles are just the sales again) | The individual prices |
| **7** | **The range bar** | fewer than **4** counted sales, or `max/min > 20` on a linear scale | Switch to log scale (§6.2c); below 4 sales, dots not a bar |
| **8** | **"All"** as a period label | **always**, when `capped` is true | *"All 100 shown"* / *"acsearch holds 623; these are the 100 most recent"* |
| **9** | **"N without a price"** | when any price string is `Premium` or `Log in` | *"N prices your account can't see"* — separately from *"N unsold"* (§1.2) |
| **10** | **The currency symbol** | when no returned price carried a currency mark | Show the number with a note: *"acsearch returned bare figures; assuming USD as requested"* |

---

## 8. Recommendations, ranked by what protects you from a bad bid

1. **Put a grade sentence on the panel, permanently.** One line under the median: *"This is every grade mixed
   together — the middle half ran $123–$471. Grade decides where your coin sits in that span."* **This is the
   entire 300-vs-950 problem, and it is a text change.** Everything else on this list is smaller.
2. **Replace `medianStrength(count)` with the confidence band of §3.3, and print the ±% on screen.** It
   answers your literal question, it uses only data already in hand, and it would have labelled the Nero-306
   page *Weak, $211–$353* instead of *Solid, $252*.
3. **Refuse the median below 6 sales or above ±50%** (§7 rows 1–2). Showing a list of five real sales is more
   useful and more honest than a middle price drawn from five real sales.
4. **Gate the trend on non-overlapping bands, or delete it.** As it stands it announces a move 95% of the time
   in a flat market and once claimed +668%. Of everything in this audit, this is the number most likely to
   make you bid high on a coin that has not moved at all.
5. **Make the range bar logarithmic.** One line of code; it stops the bar from making every realistic price
   look extravagant (§6.2c).
6. **Rewrite the price-check verdicts** to §6.3 — position against the middle half, name grade as the missing
   variable, and convert hammer to what you actually pay.
7. **Read the "of 623" the page already prints** and show the real depth, so you know whether you are seeing
   100 of 110 or 100 of 623.
8. **Tell `Premium` / `Log in` apart from unsold** (§1.2) — right now the tool tells you a coin failed to sell
   when in fact it declined to show you the price.
9. **Fix the period/trend/last-sale disagreement** (§5.1) and rename "All" (§5.2).
10. **Widen `saleDate`** to single-digit days and months and `yyyy/mm/dd`, so a period button never drops a
    recent sale for a formatting reason (§5.3).
11. **Leave outlier trimming alone.** Compute the fence, never apply it to the median; use it only to *point
    out* a lone stray against a tight bulk (§4).
12. **Leave the currency check alone.** Failing closed to "not counted" is correct.

---

## 9. What I could not verify

- **The signed-in price format.** Every lot in the only saved acsearch page has `price: "*"`, and
  `docs/ideas-backlog.md:37` confirms this has never been run against a Premium account. The strict parser is a
  well-designed guess. **On your first signed-in run, read the `Not counted:` line before you trust anything
  else on the panel** — if it is long, the parser is rejecting the real format and the median is drawn from
  whatever slipped through.
- **acsearch's exact matching semantics.** I took `prices.js:72` at its word (`"20" matched "20 mm"`) rather
  than testing it. The direction of §2.2 cause 2 does not depend on the details, and the fixture's Cappadocian
  drachm is direct evidence that unrelated coins do reach the results.
- **Real price levels.** The grade bands in §2 are my estimates for a Nero As. The *shape* — a dense cheap bulk
  with a thin dear tail — is what drives every conclusion, and that shape is not in doubt.
- **What acsearch does with `currency=usd`.** Untested by design; see §1.4.
