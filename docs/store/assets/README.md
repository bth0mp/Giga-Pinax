# Reproducible store artwork

`icon-128.png` is an unchanged copy of the packaged `extension/icons/icon-128.png` brand icon.

`small-promo-440x280.svg` and `small-promo-440x280.html` contain original vector artwork derived from the repository's column-and-trend icon. They contain no coin photograph, generated coin imagery, third-party logo or external resource.

`01-workspace-1280x800.png` is a verified 1280×800 capture of the 0.29 release UI. It shows the workflow queue and selected auction record. It is the mandatory listing screenshot; additional screenshots are optional.

To produce the Chrome upload file with a Chromium-family browser installed, open the HTML at exactly 440×280 with device scale factor 1 and capture the page without browser chrome. One reproducible command is:

```powershell
$page = [System.Uri]::new((Resolve-Path docs/store/assets/small-promo-440x280.html).Path).AbsoluteUri
chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=440,280 --screenshot=docs/store/assets/small-promo-440x280.png $page
```

The exact executable name can be `chrome`, `msedge`, `brave`, or its absolute installed path. Verify the output is 440×280 before upload. This artwork process is development-only and is not part of the extension package.
