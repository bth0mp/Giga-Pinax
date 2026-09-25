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
 *   importHint?: 'settings' | 'below', after?: Element | null,
 * }} options
 * @returns {HTMLElement | null} the notice, or null when the page has no main area to put it in
 */
export function mountRecovery({
  document, bridge, reply,
  download = (text, name) => downloadFile(document, text, name),
  confirm = (message) => globalThis.confirm(message),
  reload = () => globalThis.location.reload(),
  importHint = 'settings',
  after = null,
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
  // Under a header the page gives (the popup's, whose skip link sits above it), otherwise first in main (review Minor 7).
  if (after?.parentNode === main) after.after(card);
  else main.prepend(card);
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

// The workspace address that opens a capture of each kind, as the context menu opens it.
export const CAPTURE_ROUTES = Object.freeze({ 'auction-capture': 'event-draft', 'research-highlight': 'research-draft', 'current-lot': 'lot-draft' });
const CAPTURE_WHAT = { 'auction-capture': 'an auction', 'research-highlight': 'research text', 'current-lot': 'a lot' };

// A span of time as the collector reads it beside a capture: "12 min", "3 h".
function spanText(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * One waiting capture as a line (X-08): what it holds, where from, how long ago, and how long it is still kept.
 * @param {*} draft
 * @param {string} now
 * @returns {string}
 */
export function waitingCaptureText(draft, now) {
  const page = draft?.payload?.pageUrl ?? draft?.payload?.auctionContext?.pageUrl;
  let host = '';
  try { host = page ? new URL(page).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
  const age = Date.parse(now) - Date.parse(draft?.createdAt);
  const left = Date.parse(draft?.expiresAt) - Date.parse(now);
  const when = !Number.isFinite(age) ? '' : age < 60000 ? ' just now' : ` ${spanText(age)} ago`;
  const kept = Number.isFinite(left) ? ` · kept ${spanText(left)} more` : '';
  return `Captured ${CAPTURE_WHAT[draft?.kind] ?? 'a page'}${host ? ` from ${host}` : ''}${when}${kept}`;
}

/**
 * The captures waiting to be used, first on the page while there are any (X-08): each with Use and Discard. A capture
 * the page already has open (named in its address) is not listed again.
 * @param {{ document: Document, drafts: *, now: string, openId?: string | null, use: (draft: *) => void, discard: (draft: *) => void }} options
 * @returns {HTMLElement | null}
 */
export function mountWaitingCaptures({ document, drafts, now, openId = null, use, discard }) {
  const waiting = (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => draft?.expiresAt > now && draft.id !== openId && Object.hasOwn(CAPTURE_ROUTES, draft.kind));
  const held = document.getElementById('waiting-captures');
  if (!waiting.length) {
    held?.remove();
    return null;
  }
  const main = document.querySelector('main');
  if (!main) return null;
  const section = held ?? document.createElement('section');
  section.id = 'waiting-captures';
  section.className = 'waiting-captures';
  section.setAttribute('aria-label', 'Page captures waiting to be used');
  Object.assign(section.style, {
    margin: '12px', padding: '8px 16px', border: '1px solid var(--warning)', borderRadius: 'var(--radius-panel, 8px)',
    background: 'var(--accent-soft)', fontSize: 'var(--text-body, 12px)',
  });
  const rows = waiting.map((draft) => {
    const row = document.createElement('p');
    row.className = 'waiting-capture';
    row.style.margin = '4px 0';
    const text = document.createElement('span');
    text.textContent = `${waitingCaptureText(draft, now)} · `;
    const button = (label, kind, act) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = `${kind} btn-sm`;
      control.textContent = label;
      control.addEventListener('click', () => act(draft));
      return control;
    };
    row.append(text, button('Use', 'secondary', use), document.createTextNode(' '), button('Discard', 'quiet', discard));
    return row;
  });
  section.replaceChildren(...rows);
  if (!held) main.prepend(section);
  return section;
}

// Why the last page capture was not saved, kept in session storage by the background for the workspace to say (X-15).
export const CAPTURE_FAILURE_KEY = 'gigaPinax:captureFailure';

/**
 * The reason class of a refused capture: the store full, the records unreadable, or anything else.
 * @param {*} reply
 * @returns {'full' | 'unreadable' | 'failed'}
 */
export function captureFailureReason(reply) {
  if (reply?.reason === 'unreadable') return 'unreadable';
  if (reply?.error?.code === 'storage-bound') return 'full';
  return 'failed';
}

const CAPTURE_FAILURE_TEXT = {
  full: 'A page capture could not be saved because your records fill the storage. Open Settings to make room, then capture the page again.',
  unreadable: 'A page capture could not be saved because your records can’t be read. Open Settings to recover them, then capture the page again.',
  failed: 'A page capture could not be saved. Capture the page again; if it fails again, Settings › Diagnostics has the reason.',
};

/**
 * Says once, first on the page, why the last capture was not saved, and forgets it (X-15).
 * @param {{ document: Document, session: *, open: () => void }} options
 * @returns {Promise<HTMLElement | null>}
 */
export async function mountCaptureFailure({ document, session, open }) {
  if (!session?.get) return null;
  let note;
  try { note = (await session.get(CAPTURE_FAILURE_KEY))?.[CAPTURE_FAILURE_KEY]; } catch { return null; }
  const text = CAPTURE_FAILURE_TEXT[note?.reason];
  if (!text) return null;
  try { await session.remove(CAPTURE_FAILURE_KEY); } catch { /* said again next time */ }
  const main = document.querySelector('main');
  if (!main) return null;
  const line = document.createElement('p');
  line.id = 'capture-failure';
  line.setAttribute('role', 'alert');
  Object.assign(line.style, {
    margin: '12px', padding: '8px 16px', border: '1px solid var(--error)', borderRadius: 'var(--radius-panel, 8px)',
    background: 'var(--surface)', color: 'var(--ink)', fontSize: 'var(--text-body, 12px)',
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet btn-sm';
  button.textContent = 'Open Settings';
  button.addEventListener('click', () => open());
  line.append(document.createTextNode(`${text} `), button);
  main.prepend(line);
  return line;
}
