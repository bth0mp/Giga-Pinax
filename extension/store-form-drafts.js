// @ts-check
// What a collector has typed into a workspace editor and not yet saved, kept in the page's own session storage so a crash,
// a reload or a browser restart that restores the tab does not take it (X-14, the store side). It is never extension
// storage and never part of a backup: it lives only in this window's tab, for as long as the browser keeps that tab's
// session. Each draft is held to a plain shape - an editor this module knows, text and tick-box values under short names,
// the record it was typed against - and anything else read back is dropped rather than trusted.

export const FORM_DRAFT_PREFIX = 'giga-pinax-form-draft:';
// The editors whose typing is worth keeping: a coin, an auction and a want.
export const FORM_DRAFT_EDITORS = Object.freeze(['lot', 'event', 'want']);
const MAX_FIELDS = 100;
const MAX_NAME = 64;
const MAX_VALUE = 5000;
// A draft older than this is typing the collector has moved on from, and is not offered back.
export const FORM_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const EDITOR_NOUNS = { lot: 'a coin', event: 'an auction', want: 'a want' };

/**
 * @typedef {{ fields: Record<string, string | boolean>, savedAt: number, recordId: string | null, revision: number | null }} FormDraft
 * @typedef {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void }} SessionArea
 */

// The fields held to their shape: short names, text or a tick, and no more of them than a form has.
function cleanFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const entries = Object.entries(fields)
    .filter(([name, value]) => /^[A-Za-z][\w-]*$/.test(name) && name.length <= MAX_NAME &&
      ((typeof value === 'string' && value.length <= MAX_VALUE) || typeof value === 'boolean'));
  if (!entries.length || entries.length > MAX_FIELDS) return null;
  return Object.fromEntries(entries);
}

// Whether anything was typed at all: an editor whose every field is blank or unticked holds nothing worth offering.
const holdsTyping = (fields) => Object.values(fields).some((value) => (typeof value === 'string' ? value.trim() !== '' : value === true));

/**
 * The form drafts of one window, over its session storage. Every call is safe where the browser refuses the storage: it
 * then keeps nothing and reads nothing back.
 * @param {SessionArea | null | undefined} storage the page's `sessionStorage`
 * @param {{ now?: () => number }} [options]
 */
export function createFormDraftStore(storage, { now = () => Date.now() } = {}) {
  const key = (editor) => `${FORM_DRAFT_PREFIX}${editor}`;
  const known = (editor) => FORM_DRAFT_EDITORS.includes(editor);
  return {
    /**
     * Keeps what is typed in one editor, replacing what was kept before; a form with nothing typed clears its draft.
     * @param {string} editor
     * @param {Record<string, string | boolean>} fields
     * @param {{ recordId?: string | null, revision?: number | null }} [basis] the saved record the typing edits, if any
     * @returns {boolean} whether it was kept
     */
    save(editor, fields, { recordId = null, revision = null } = {}) {
      if (!known(editor)) return false;
      const clean = cleanFields(fields);
      try {
        if (!clean || !holdsTyping(clean)) {
          storage?.removeItem(key(editor));
          return false;
        }
        /** @type {FormDraft} */
        const draft = {
          fields: clean, savedAt: now(),
          recordId: typeof recordId === 'string' ? recordId : null,
          revision: Number.isSafeInteger(revision) ? revision : null,
        };
        storage?.setItem(key(editor), JSON.stringify(draft));
        return Boolean(storage);
      } catch {
        return false;
      }
    },
    /**
     * What was typed in one editor and not saved, or null: nothing kept, a draft too old, or one that is not a draft.
     * @param {string} editor
     * @returns {FormDraft | null}
     */
    load(editor) {
      if (!known(editor)) return null;
      let raw;
      try { raw = storage?.getItem(key(editor)) ?? null; } catch { return null; }
      if (typeof raw !== 'string') return null;
      let draft;
      try { draft = JSON.parse(raw); } catch { return null; }
      const fields = cleanFields(draft?.fields);
      if (!fields || !holdsTyping(fields) || !Number.isFinite(draft.savedAt) || now() - draft.savedAt > FORM_DRAFT_MAX_AGE_MS) return null;
      return {
        fields, savedAt: draft.savedAt,
        recordId: typeof draft.recordId === 'string' ? draft.recordId : null,
        revision: Number.isSafeInteger(draft.revision) ? draft.revision : null,
      };
    },
    /**
     * Forgets one editor's draft: it was saved, or the collector said Discard.
     * @param {string} editor
     */
    discard(editor) {
      try { storage?.removeItem(key(editor)); } catch { /* nothing kept to forget */ }
    },
  };
}

/**
 * The offer a page makes with a draft on its next load: "You were adding a coin" or "You were editing “Nero denarius”".
 * @param {string} editor
 * @param {FormDraft} draft
 * @param {string} [title] the saved record's title, when the draft edits one
 * @returns {string}
 */
export function formDraftOfferText(editor, draft, title = '') {
  const noun = EDITOR_NOUNS[editor] ?? 'a record';
  if (!draft.recordId) return `You were adding ${noun}`;
  return title ? `You were editing “${title}”` : `You were editing ${noun}`;
}
