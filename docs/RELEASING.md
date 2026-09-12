# Publishing a release

Create each release as a draft. Upload the three versioned browser packages and both stable aliases described below. Check that all five assets are present and downloadable before publishing the draft as the latest release. The public downloads require no GitHub account, and end users do not need Python.

Every release body must include brief browser installation and update instructions beside the download information. Copy and update this section as needed:

## Install or update

Under **Assets**, download the ZIP for your browser, not a **Source code** archive.

- **Brave or Chrome:** Unzip the package into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, select **Load Temporary Add-on**, and choose the Firefox ZIP. This unsigned temporary add-on is removed when Firefox restarts.
- **Updating Brave or Chrome:** Overwrite the files in the same folder, then select **Reload** on the extensions page.
- **Updating Firefox:** Load the new Firefox ZIP again.

Release assets must include three versioned browser packages (for example, `giga-pinax-brave-0.27.1.zip`, `giga-pinax-chrome-0.27.1.zip`, and `giga-pinax-firefox-0.27.1.zip`) plus `giga-pinax-brave.zip` and `giga-pinax-firefox.zip`. Make the versioned Chrome ZIP a byte-identical copy of the versioned Brave ZIP. The stable aliases keep the in-extension update links working; see [INSTALL.md](INSTALL.md) for the build details.
