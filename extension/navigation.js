const apiDefault = () => globalThis.browser ?? globalThis.chrome;
const PANEL_URL = 'popup.html?panel=1&window=1';

async function fallbackWindow(api) {
  try {
    const reply = await api?.runtime?.sendMessage?.({
      type: 'giga-pinax-launch-lookup',
      url: PANEL_URL,
    });
    if (reply?.ok) return { ok: true, mode: 'window' };
    return { ok: false, message: reply?.message || 'Unable to open the research panel.' };
  } catch (error) {
    return { ok: false, message: error?.message || 'Unable to open the research panel.' };
  }
}

export function openResearchPanel(api = apiDefault()) {
  let native;
  try {
    if (api?.sidePanel?.open) {
      const windowId = api.windows?.WINDOW_ID_CURRENT ?? globalThis.chrome?.windows?.WINDOW_ID_CURRENT ?? -2;
      native = api.sidePanel.open({ windowId });
    } else if (api?.sidebarAction?.open) {
      native = api.sidebarAction.open();
    } else {
      return fallbackWindow(api);
    }
  } catch {
    return fallbackWindow(api);
  }
  const mode = api.sidePanel?.open ? 'side-panel' : 'sidebar';
  return Promise.resolve(native)
    .then(() => ({ ok: true, mode }))
    .catch(() => fallbackWindow(api));
}

async function openPage(path, api = apiDefault()) {
  try {
    const url = api.runtime.getURL(path);
    await api.tabs.create({ url });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'Unable to open the page.' };
  }
}

export function openSettings(section = '', api = apiDefault()) {
  const fragment = section ? `#${encodeURIComponent(section)}` : '';
  return openPage(`settings.html${fragment}`, api);
}

// queue names a Watchlist queue to open on ("needs-outcome"); the workspace ignores a name its Queue select does not list.
export function openWorkspace(route = 'watchlist', api = apiDefault(), queue = '') {
  return openPage(`workspace.html#${encodeURIComponent(route)}${queue ? `?queue=${encodeURIComponent(queue)}` : ''}`, api);
}
