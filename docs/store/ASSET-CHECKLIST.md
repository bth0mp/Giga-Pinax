# Store asset checklist

Chrome Web Store's official [image requirements](https://developer.chrome.com/docs/webstore/images) require:

- packaged 128×128 icon: `assets/icon-128.png`;
- 440×280 small promotional image: render `assets/small-promo-440x280.html` or its SVG to `small-promo-440x280.png`; and
- at least one 1280×800 or 640×400 screenshot, with up to five allowed.

The 1400×560 marquee image and promo video are optional. Use PNG or JPEG for dashboard uploads. Keep screenshots full-bleed, without browser chrome, excessive padding or private auction data.

The mandatory Chrome image set is present:

- `assets/icon-128.png` — 128×128 packaged icon.
- `assets/small-promo-440x280.png` — 440×280 small promotional image.
- `assets/01-workspace-1280x800.png` — verified 1280×800 release UI showing the workflow queue and selected auction record.

Additional screenshots are optional listing improvements, not missing mandatory assets. Suitable future additions are the calculator with fees and affordable-bid increment, Research with curated sale-price summary, or comparison with publishable fixture data. The QA comparison capture intentionally demonstrates an unavailable external photo and remains in `.test-artifacts`; add it to the public pack only if that failure-state example is useful to the listing.

Firefox listing imagery can reuse truthful release screenshots and the icon, subject to the current dashboard validation. Do not imply affiliation with ANS, Nomisma, acsearch, CoinArchives or an auction house.
