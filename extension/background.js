import { popupUrlFor, selectionQuery } from './selection.js';

const api = globalThis.browser ?? globalThis.chrome;
const MENU_ID = 'giga-pinax-lookup';

function createMenu() {
  Promise.resolve(api.contextMenus.removeAll()).then(() => {
    api.contextMenus.create({ id: MENU_ID, title: 'Look up “%s” in Giga Pinax', contexts: ['selection'] });
  });
}

api.runtime.onInstalled.addListener(createMenu);
api.runtime.onStartup.addListener(createMenu);

api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!selectionQuery(info.selectionText)) return;
  api.windows.create({ url: api.runtime.getURL(popupUrlFor(info.selectionText)), type: 'popup', width: 440, height: 680 });
});
