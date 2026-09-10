# Install Giga Pinax

Version **0.3.0** looks up RIC and Price coin types from the American Numismatic Society's open OCRE and PELLA datasets and fetches recent hammer prices from acsearch with your own account. It contacts `numismatics.org` and `nomisma.org` when you select **Look up**, and `www.acsearch.info` when you select **Get prices**. Nothing else is contacted and nothing from acsearch is stored.

## Build the packages

From the repository root, run:

```powershell
python scripts/build.py
```

The command creates these unpacked directories and matching ZIP archives:

```text
dist/brave/
dist/firefox/
dist/giga-pinax-brave-0.3.0.zip
dist/giga-pinax-firefox-0.3.0.zip
```

Run the same command again whenever an extension asset or manifest changes. You can build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

## Test in Brave

1. Use `dist/brave`, or unzip `dist/giga-pinax-brave-0.3.0.zip` into its own folder.
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
4. Choose `dist/firefox/manifest.json`, or `dist/giga-pinax-firefox-0.3.0.zip`.
5. Open Giga Pinax from Firefox's extensions menu.

The first time you select **Look up**, Firefox asks whether Giga Pinax may access `numismatics.org` and `nomisma.org`; the first time you select **Get prices**, it asks about `www.acsearch.info`. Allow each. If the popup closes while a prompt is open, reopen it and select the button again. If you decline, the popup explains what it needs and you can select the button again.

Firefox removes a temporary add-on when Firefox restarts. Permanent installation needs a Mozilla-signed build; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

**Already installed temporarily?** After rebuilding, select **Reload** for Giga Pinax under **This Firefox** at `about:debugging`, or load the updated ZIP again.

## What to try

- **Price 23**, then **RIC I (2nd edition), Nero 306**.
- Select **Get prices**. If you are not signed in on acsearch, the popup says so with a sign-in link; sign in on acsearch's own website, then select **Get prices** again.
- Edit the acsearch search term (for example add the denomination) and select **Get prices** again; the term is remembered for that type.
- Expand **Inspect sales** to see each sale with a link to it on acsearch.
- A number that doesn't exist, such as **RIC I (2nd edition), Nero 9999999**: the popup says it was not found rather than inventing a result.
- **RIC I, Nero 306** with the edition left out of the volume field: a short "Did you mean" list offers the full reference to choose.
- Close and reopen the popup: your last reference, currency and terms are remembered locally.

## Remove

In Brave, open `brave://extensions` and select **Remove**. In Firefox, remove it from `about:debugging`, or close and restart Firefox.
