# Install the Coin Lookup test build

Version **0.1.1** fixes the toolbar popup collapsing into a narrow strip. This package is a local test build. It uses bundled fictional sample data and makes no automated requests to acsearch, catalogue sites or auction services. Its links open acsearch sign-in and official coin-type pages when clicked. Its manifest requests no browser, host, cookie, tab or scripting permissions.

## Build the packages

From the repository root, run:

```powershell
python scripts/build.py
```

The command creates these unpacked directories and matching ZIP archives:

```text
dist/brave/
dist/firefox/
dist/coin-lookup-brave-0.1.1.zip
dist/coin-lookup-firefox-0.1.1.zip
```

Run the same command again whenever an extension asset or manifest changes. You can build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

## Test in Brave

Brave supports Chromium-compatible extensions, according to the [Brave Help Center](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave). To load this local build:

1. Use `dist/brave`, or unzip `dist/coin-lookup-brave-0.1.1.zip` into its own folder.
2. Open `brave://extensions` in Brave.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder that contains `manifest.json`.
5. Open the extension from Brave's extensions menu. Pin it if you want its button to remain on the toolbar.

The unpacked-extension workflow follows the Chromium developer instructions for [loading an extension locally](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

**Already installed?** If you loaded the project's `dist/brave` folder, rebuild it and select **Reload** on Coin Lookup at `brave://extensions`. If you loaded an extracted copy, replace the files in that same folder with the new ZIP's contents, then select **Reload**. Reopen the toolbar popup to use the update.

## Test temporarily in Firefox

Use Firefox 142 or later for this test build.

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on**.
4. Choose `dist/firefox/manifest.json`. Firefox also accepts `dist/coin-lookup-firefox-0.1.1.zip` in this temporary testing flow.
5. Open the extension from Firefox's extensions menu.

Firefox removes a temporary add-on when Firefox restarts. Mozilla documents both the accepted folder/ZIP inputs and restart behavior in [Temporary installation in Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

**Already installed temporarily?** After rebuilding `dist/firefox` or replacing the files in the folder you loaded, select **Reload** for Coin Lookup under **This Firefox** at `about:debugging`. For a ZIP installation, use **Load Temporary Add-on** to load the updated ZIP. Reopen the toolbar popup after updating.

## Firefox distribution beyond testing

The Firefox ZIP is an unsigned test artifact. It is deliberately not named `.xpi` and will not install permanently in normal Firefox release or beta builds. Private or public distribution later requires submission to Mozilla for signing; Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) explains the listed and self-distributed options.

The Firefox manifest declares a stable extension ID and `data_collection_permissions.required` as `none`. Mozilla now requires the data-collection declaration for new AMO submissions and documents this field in [`browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).

## What to try

- Open Coin Lookup from the toolbar, then choose **Explore sample prices**.
- Try **Price 23**, or **RIC I (2nd edition), Nero 306**.
- Change currency, close the popup, and reopen it: your choice is remembered locally.
- Expand **Inspect sample sales** to see the nine fictional amounts.
- The popup follows the browser's light/dark preference.
- **Sign in to acsearch** opens the official login page. Signing in does not connect this test build to live prices, and it never claims to verify your account.

The test build only contains those two reference examples. Other inputs receive an explanation instead of fabricated matching results. Currency switching changes sample formatting; it is not a currency conversion.

## Remove the test build

In Brave, open `brave://extensions` and select **Remove** on the test extension. In Firefox, remove it from `about:debugging`, or close and restart Firefox.
