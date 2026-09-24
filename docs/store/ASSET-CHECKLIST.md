# Store asset checklist

Chrome Web Store's official [image requirements](https://developer.chrome.com/docs/webstore/images) require:

- packaged 128×128 icon: `assets/icon-128.png`;
- 440×280 small promotional image: render `assets/small-promo-440x280.html` or its SVG to `small-promo-440x280.png`; and
- at least one 1280×800 or 640×400 screenshot, with up to five allowed.

The 1400×560 marquee image and promo video are optional. Use PNG or JPEG for dashboard uploads. Keep screenshots full-bleed, without browser chrome, excessive padding or private auction data.

The mandatory Chrome image set is present:

- `assets/icon-128.png` — 128×128 packaged icon.
- `assets/small-promo-440x280.png` — 440×280 small promotional image.
- `assets/01-workspace-1280x800.png` — 1280×800 workspace showing the workflow queue and selected auction record. **It shows the 0.29 UI**, not the current release (0.34.0). **The owner must capture it again** from the package being submitted — a browser with the built extension loaded, publishable fixture records and no private auction data — before any store submission, and update this line with the version it shows. Nothing in the repository can produce it: `scripts/` renders only the icon and the promotional tile.

Additional screenshots are optional listing improvements, not missing mandatory assets. Suitable future additions are the calculator with fees and affordable-bid increment, Research with curated sale-price summary, or comparison with publishable fixture data.

Firefox listing imagery can reuse truthful release screenshots and the icon, subject to the current dashboard validation. Do not imply affiliation with ANS, Nomisma, acsearch, CoinArchives or an auction house.
