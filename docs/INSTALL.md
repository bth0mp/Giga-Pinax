# Install Giga Pinax

Version **0.2.0** looks up RIC and Price coin types from the American Numismatic Society's open OCRE and PELLA datasets. It contacts only `numismatics.org` and `nomisma.org`, and only when you select **Look up**. Prices are not connected; the acsearch links open acsearch's own website in a new tab.

## Build the packages

From the repository root, run:

```powershell
python scripts/build.py
```

The command creates these unpacked directories and matching ZIP archives:

```text
dist/brave/
dist/firefox/
dist/giga-pinax-brave-0.2.0.zip
dist/giga-pinax-firefox-0.2.0.zip
```

Run the same command again whenever an extension asset or manifest changes. You can build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

## Test in Brave

1. Use `dist/brave`, or unzip `dist/giga-pinax-brave-0.2.0.zip` into its own folder.
2. Open `brave://extensions` in Brave.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder that contains `manifest.json`.
5. Open Giga Pinax from Brave's extensions menu. Pin it if you want its button to remain on the toolbar.

Brave grants access to `numismatics.org` and `nomisma.org` at install.

**Already installed?** Rebuild, then select **Reload** on Giga Pinax at `brave://extensions`. If you loaded an extracted copy, replace its files with the new ZIP's contents first. Reopen the toolbar popup to use the update.

## Test temporarily in Firefox

Use Firefox 142 or later.

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on**.
4. Choose `dist/firefox/manifest.json`, or `dist/giga-pinax-firefox-0.2.0.zip`.
5. Open Giga Pinax from Firefox's extensions menu.

The first time you select **Look up**, Firefox asks whether Giga Pinax may access `numismatics.org` and `nomisma.org`. Allow it; the lookup then runs. If you decline, the popup explains what it needs and you can select **Look up** again.

Firefox removes a temporary add-on when Firefox restarts. Permanent installation needs a Mozilla-signed build; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

**Already installed temporarily?** After rebuilding, select **Reload** for Giga Pinax under **This Firefox** at `about:debugging`, or load the updated ZIP again.

## What to try

- **Price 23**, then **RIC I (2nd edition), Nero 306**.
- A number that doesn't exist, such as **RIC I (2nd edition), Nero 9999999**: the popup says it was not found rather than inventing a result.
- **Price 2**: a short "Did you mean" list appears.
- Close and reopen the popup: your last reference and currency are remembered locally.
- **Type ↗** opens the ANS type page with specimen photographs. **Search on acsearch ↗** opens acsearch with the reference pre-filled; prices there require your own acsearch account.

## Remove

In Brave, open `brave://extensions` and select **Remove**. In Firefox, remove it from `about:debugging`, or close and restart Firefox.
