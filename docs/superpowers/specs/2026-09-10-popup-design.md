# Ancient coin lookup: first layout

## Agreed direction

- Desktop Brave and Firefox; a compact toolbar popup.
- Guided catalogue entry: Price number, or RIC volume/edition, section and number.
- USD initially, with a collector-selectable currency preference.
- Clean modern styling that follows the browser's light/dark preference.
- Each collector signs into their own acsearch account on acsearch's official website.
- Median recorded hammer price, middle 50% range, number of sales and inspectable examples.

## This deliverable

A local, interactive layout preview in `prototype/`. It demonstrates first use, Price and RIC entry, results, currency formatting and light/dark themes. Every sale and amount is explicitly fictional. It does not authenticate, collect acsearch data, resolve arbitrary references or install an extension. Those capabilities require a subsequent implementation, browser testing and an agreed acsearch integration.

## Layout and visual system

The popup is 400 CSS pixels wide and capped at 590 pixels high, with internal scrolling. Order: small identity row; persistent preview label; first-use card or reference form; catalogue identity; median; middle 50% and count; expandable examples; source/fee explanation. RIC details appear only when RIC is selected. Do not add optional coin-description fields to this first layout.

Palette: marine `#244C5A`, ink `#142A33`, slate `#526A74`, mist `#F3F6F7`, border `#D4DEE2`, white `#FFFFFF`. Dark mode uses ink surfaces and pale marine accents. Body and headings use the system sans-serif; catalogue references use a local monospace stack, and amounts use tabular numerals. The compact catalogue label is the characteristic visual detail. No remote fonts, images or dependencies.

The UI/UX design-system search suggested a scholarly research palette but an unrelated newsletter page structure. Retain the legible, restrained research treatment; use the popup hierarchy above instead of the newsletter layout.

## Preview behavior

- The preview controls select first use or lookup, and system/light/dark theme.
- Price uses the verified example `Price 23`; RIC uses `RIC I (2nd edition), Nero 306`.
- Submitting other references explains that this preview only includes those two examples. It never presents fictional prices as matching arbitrary entries.
- Nine illustrative sales have amounts 90, 110, 135, 165, 180, 215, 245, 310 and 450. Median: 180. Middle 50% (linear interpolation): 135–245.
- Currency changes demonstrate formatting and are remembered locally; the preview explicitly says these are not exchange-rate conversions.
- The sign-in link opens `https://www.acsearch.info/login.html`. It never claims that authentication or Premium access has been verified.
- Reference identity links lead to PELLA or OCRE; fictional sales have no fabricated auction-house links.

## Verification

Check the rendered onboarding, Price results, RIC fields and expanded sample list; test keyboard focus, theme controls, currency persistence, unsupported-reference feedback and narrow viewports. Confirm all sample counts and displayed figures agree, no horizontal clipping occurs and no application requests go to acsearch except deliberate external-link navigation.

## Remaining integration questions

acsearch's approval/access mechanism, session detection, price entitlement checks, reference resolution, real result coverage, price normalization and signed browser distribution are outside this visual preview.
