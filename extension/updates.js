export function buildUpdateView(manifest = {}) {
  const version = typeof manifest.version === 'string' && manifest.version.trim()
    ? manifest.version.trim()
    : 'unknown';
  const firefox = Boolean(manifest.browser_specific_settings?.gecko);
  // A store writes update_url into the manifest it serves and keeps the extension up to date itself, so the card - whose
  // link hands out a ZIP to install by hand - has nothing to tell that collector. An unpacked or temporary install has
  // no update_url and still needs it.
  const fromStore = Boolean(manifest.update_url);
  return firefox
    ? {
        fromStore,
        versionText: `Installed version ${version}`,
        browserName: 'Firefox',
        downloadUrl: 'https://github.com/bth0mp/Giga-Pinax/releases/latest/download/giga-pinax-firefox.zip',
        instructions: 'Download the Firefox ZIP, then open about:debugging > This Firefox > Load Temporary Add-on and select the downloaded ZIP. Firefox unsigned temporary extensions must be loaded again after Firefox restarts.',
      }
    : {
        fromStore,
        versionText: `Installed version ${version}`,
        browserName: 'Chrome or Brave',
        downloadUrl: 'https://github.com/bth0mp/Giga-Pinax/releases/latest/download/giga-pinax-brave.zip',
        instructions: 'Open chrome://extensions or brave://extensions. Unzip the Chrome or Brave download over the same installed folder, then select Reload.',
      };
}

function initUpdates() {
  const api = globalThis.browser ?? globalThis.chrome;
  const manifest = api?.runtime?.getManifest?.() ?? {};
  const view = buildUpdateView(manifest);
  const card = document.getElementById('updates');
  if (card) card.hidden = view.fromStore;
  const version = document.getElementById('updates-version');
  const browser = document.getElementById('updates-browser');
  const instructions = document.getElementById('updates-instructions');
  const download = document.getElementById('updates-download');
  if (version) version.textContent = view.versionText;
  if (browser) browser.textContent = view.browserName;
  if (instructions) instructions.textContent = view.instructions;
  if (download) download.href = view.downloadUrl;
}

if (typeof document !== 'undefined') initUpdates();
