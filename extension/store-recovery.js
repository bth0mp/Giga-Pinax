// @ts-check
// The way out of stored records nothing can read (X-02). Every page that finds them unreadable offers the same two
// things, in this order: "Download the stored data", the raw rescue file of whatever storage holds, and "Start fresh,
// keeping a copy", which downloads that file first and resets only once it has been handed to the browser. A Replace
// import of a backup is the third way out, in Settings. Nothing here reads the records themselves: the rescue file is
// the store's own verbatim copy (snapshot.raw), and the reset is the store's to refuse over records it can read.
import { backupFileName, rawExportDocument, setAsideCountText } from './core/backup.js';

/**
 * @typedef {{ sendCommand: (command: *) => Promise<*>, newRequestId: () => string }} Bridge
 * @typedef {{ text: string, name: string, revision: number }} RescueFile
 */

/**
 * Whether a store reply says the records cannot be read at all.
 * @param {*} reply
 * @returns {boolean}
 */
export const isUnreadable = (reply) => reply?.ok === false && reply.reason === 'unreadable';

/**
 * The sentence that says so, with why where the store knows it.
 * @param {*} reply
 * @returns {string}
 */
export function unreadableText(reply) {
  const why = reply?.newerVersion
    ? 'They were written by a newer version of Giga Pinax, so updating the extension may read them again.'
    : 'They are damaged.';
  return `Giga Pinax can’t read the records stored in this browser. ${why} Nothing has been changed. ` +
    'Download the stored data to keep a copy of everything, then start fresh or import a backup with Replace.';
}

/**
 * The rescue file of whatever storage holds, and the revision the store reported with it.
 * @param {Bridge} bridge
 * @param {string} [now]
 * @returns {Promise<RescueFile>}
 */
export async function rescueFile(bridge, now = new Date().toISOString()) {
  const reply = await bridge.sendCommand({ type: 'snapshot.raw', requestId: bridge.newRequestId() });
  if (!reply?.ok) throw new Error(reply?.message || 'The stored data could not be read from storage.');
  return { text: rawExportDocument(reply.value, now), name: backupFileName('giga-pinax-raw', now), revision: reply.revision };
}

/**
 * Start fresh, keeping a copy: the rescue file is downloaded first, the collector says yes knowing its name, and only
 * then is the store asked to reset. A copy that cannot be made resets nothing.
 * @param {{ bridge: Bridge, download: (text: string, name: string) => void, confirm: (message: string) => boolean }} steps
 * @returns {Promise<{ reset: boolean, file: string }>}
 */
export async function startFresh({ bridge, download, confirm }) {
  const file = await rescueFile(bridge);
  download(file.text, file.name);
  const asked = `A copy of the stored data is downloading as ${file.name}. Keep it: it holds everything that was stored.\n\n` +
    'Start fresh? Giga Pinax will begin again with no records. You can import a backup afterwards.';
  if (!confirm(asked)) return { reset: false, file: file.name };
  const reply = await bridge.sendCommand({ type: 'store.reset', requestId: bridge.newRequestId(), expectedRevision: file.revision });
  if (!reply?.ok) throw new Error(reply?.message || 'Giga Pinax could not start fresh.');
  return { reset: true, file: file.name };
}

// A failure's own sentence, then what did not happen - unless it already says so.
const withEnding = (message, ending) => (/nothing was (reset|changed)/i.test(String(message)) ? String(message) : `${message} ${ending}`);

/**
 * A file handed to the browser to save, from a page.
 * @param {Document} document
 * @param {string} text
 * @param {string} name
 */
export function downloadFile(document, text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * The notice at the top of a page's main area, with the two ways out and, away from Settings, the way to the third.
 * @param {{
 *   document: Document, bridge: Bridge, reply: *,
 *   download?: (text: string, name: string) => void, confirm?: (message: string) => boolean, reload?: () => void,
 *   importHint?: 'settings' | 'below',
 * }} options
 * @returns {HTMLElement | null} the notice, or null when the page has no main area to put it in
 */
export function mountRecovery({
  document, bridge, reply,
  download = (text, name) => downloadFile(document, text, name),
  confirm = (message) => globalThis.confirm(message),
  reload = () => globalThis.location.reload(),
  importHint = 'settings',
}) {
  const main = document.querySelector('main');
  if (!main) return null;
  document.getElementById('store-recovery')?.remove();
  const card = document.createElement('section');
  card.id = 'store-recovery';
  card.className = 'store-recovery';
  card.setAttribute('role', 'alert');
  card.setAttribute('aria-labelledby', 'store-recovery-title');
  // The pages' own sheets know nothing of this notice, so it carries the one notice style the tokens give a refusal.
  Object.assign(card.style, {
    margin: '12px', padding: '12px 16px', border: '1px solid var(--error)', borderRadius: 'var(--radius-panel, 8px)',
    background: 'var(--surface)', color: 'var(--ink)', fontSize: 'var(--text-body, 12px)', lineHeight: '1.5',
  });
  const title = document.createElement('h2');
  title.id = 'store-recovery-title';
  title.textContent = 'Your records can’t be read';
  Object.assign(title.style, { margin: '0 0 4px', fontSize: 'var(--text-h4, 14px)', color: 'var(--error)' });
  const text = document.createElement('p');
  text.textContent = unreadableText(reply);
  text.style.margin = '0 0 8px';
  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' });
  const status = document.createElement('p');
  status.id = 'store-recovery-status';
  status.setAttribute('role', 'status');
  status.style.margin = '8px 0 0';
  const say = (message, error = false) => {
    status.textContent = message;
    status.style.color = error ? 'var(--error)' : 'var(--muted)';
  };
  const button = (id, label, kind) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.id = id;
    control.className = kind;
    control.textContent = label;
    actions.append(control);
    return control;
  };
  const save = button('store-recovery-download', 'Download the stored data', 'secondary');
  const fresh = button('store-recovery-reset', 'Start fresh, keeping a copy', 'quiet');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const file = await rescueFile(bridge);
      download(file.text, file.name);
      say(`Download started: ${file.name}. Keep it: it holds everything that was stored.`);
    } catch (error) {
      say(withEnding(error.message, 'Nothing was changed.'), true);
    } finally {
      save.disabled = false;
    }
  });
  fresh.addEventListener('click', async () => {
    fresh.disabled = true;
    try {
      const done = await startFresh({ bridge, download, confirm });
      if (!done.reset) {
        say(`Download started: ${done.file}. Nothing was reset.`);
        return;
      }
      say(`Started fresh. Your stored data was downloaded as ${done.file}.`);
      reload();
    } catch (error) {
      say(withEnding(error.message, 'Nothing was reset.'), true);
    } finally {
      fresh.disabled = false;
    }
  });
  if (importHint === 'settings') {
    const link = document.createElement('a');
    link.href = 'settings.html#backup';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Import a backup in Settings';
    link.style.color = 'var(--accent)';
    actions.append(link);
  } else {
    const hint = document.createElement('span');
    hint.textContent = 'Or import a backup below, under Backup and import, with Replace local records.';
    hint.style.color = 'var(--muted)';
    actions.append(hint);
  }
  card.append(title, text, actions, status);
  main.prepend(card);
  return card;
}

/**
 * The line under the watchlist's count while records are set aside (X-03): "1 coin set aside: fix or remove", the last
 * words a button to where that is done. Drawn again with every snapshot, and gone once nothing is set aside.
 * @param {{ document: Document, quarantine: *, open: () => void, anchorId?: string }} options
 * @returns {HTMLElement | null}
 */
export function mountSetAsideLine({ document, quarantine, open, anchorId = 'lot-count' }) {
  const text = setAsideCountText(quarantine);
  const held = document.getElementById('set-aside-line');
  if (!text) {
    held?.remove();
    return null;
  }
  const anchor = document.getElementById(anchorId);
  if (!anchor) return null;
  const line = held ?? document.createElement('p');
  line.id = 'set-aside-line';
  line.className = 'field-note set-aside-line';
  line.setAttribute('role', 'status');
  line.style.color = 'var(--warning)';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet btn-sm';
  button.textContent = 'fix or remove';
  button.addEventListener('click', () => open());
  line.replaceChildren(document.createTextNode(`${text}: `), button);
  if (!held) anchor.after(line);
  return line;
}
