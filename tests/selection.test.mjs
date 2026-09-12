import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SELECTION, MAX_LOT, LOOKUP_MESSAGE, LOOKUP_LAUNCH_MESSAGE, isLookupWindowUrl, lookupLaunchSucceeded, selectionQuery, popupUrlFor, queryFromSearch, cardUrlFor, cardFromSearch, showInWindow } from '../extension/selection.js';

test('selectionQuery collapses whitespace and trims; a lot is capped at 3,000 characters, cut at a word boundary, never inside a character', () => {
  assert.equal(selectionQuery('  RIC I²\n Nero\t306  '), 'RIC I² Nero 306');
  assert.equal(selectionQuery(''), '');
  assert.equal(selectionQuery(undefined), '');
  assert.equal(MAX_SELECTION, 120);
  assert.equal(MAX_LOT, 3000);
  assert.equal(selectionQuery('x'.repeat(200)), 'x'.repeat(200));
  assert.equal(selectionQuery('x'.repeat(4000)).length, MAX_LOT);
  assert.equal(selectionQuery(`${'1'.repeat(2999)}😀tail`), `${'1'.repeat(2999)}😀`);
  assert.equal(selectionQuery(`${'word '.repeat(700)}RIC 972`), 'word '.repeat(600).trim());
});

test('a lot selection keeps the whole description, with every reference in it', () => {
  const lot = 'TITUS, AD 69-79. AR, Denarius. Rome. Obv: T CAESAR VESPASIANVS. Head of Titus, laureate, right. Rev: ANNONA AVG. Ref: RIC 972; Cohen 17; BMC 319.';
  assert.equal(selectionQuery(`  ${lot.replace(/\. /g, '.\n')}  `), lot);
  assert.equal(selectionQuery('RIC 972; Cohen 17'), 'RIC 972; Cohen 17');
  assert.equal(queryFromSearch(popupUrlFor(lot).slice('popup.html'.length)), lot);
  // A reference line without its full stop still ends at the break, so the weight on the next line is not read into it.
  assert.equal(selectionQuery('Titus, as Caesar. AR Denarius\nRIC 1073\n18 mm, 3.42 g'), 'Titus, as Caesar. AR Denarius. RIC 1073. 18 mm, 3.42 g');
});

test('the hidden characters dealer pages add are dropped before the cap, and a lone surrogate never makes the window URL throw', () => {
  assert.equal(selectionQuery('\u200bRIC\u00ad 972\ufeff'), 'RIC 972');
  assert.equal(selectionQuery(`${'\u200b'.repeat(200)}Crawford 44/5`), 'Crawford 44/5');
  assert.equal(queryFromSearch('?q=%E2%80%8BPrice%2023%C2%AD'), 'Price 23');
  assert.doesNotThrow(() => selectionQuery('\uD800Price 23'));
  assert.equal(popupUrlFor('\uD800Price 23'), 'popup.html?window=1&q=%EF%BF%BDPrice%2023');
});

test('a list of references longer than 120 characters reads as a lot and is kept whole', () => {
  const references = ['HGC 4, 1218', 'BCD Boiotia 174b', 'SNG Copenhagen 123', 'SNG München 456', 'Traité IV 1234', 'Jameson 1234', 'Babelon 1830', 'Rosen 567'];
  const text = `${references.join('; ')}.`;
  assert.ok(text.length > MAX_SELECTION);
  assert.equal(selectionQuery(text), text);
  assert.equal(selectionQuery(references.slice(0, 3).join(';\n')), references.slice(0, 3).join('; '));
});

test('the pop-out names the card it shows by corpus and id, never by its title, and the window reads them back', () => {
  for (const card of [{ corpus: 'pella', id: 'price.P1' }, { corpus: 'ocre', id: 'ric.1(2).ner.306' }, { corpus: 'bigr', id: 'bigr.philoxenus.7.1' },
    { corpus: 'sco', id: 'sc.1.689.10.' }, { corpus: 'other', id: 'BCD Boiotia 174b; HGC 4, 1218 & 5+6' }]) {
    const url = cardUrlFor({ ...card, label: 'Title' });
    assert.ok(url.startsWith('popup.html?window=1&') && !url.includes('Title'), url);
    assert.deepEqual(cardFromSearch(url.slice('popup.html'.length)), card);
    assert.equal(queryFromSearch(url.slice('popup.html'.length)), '');
  }
  assert.equal(cardUrlFor({ corpus: 'pella', id: 'price.P1', label: 'Price P1' }), 'popup.html?window=1&corpus=pella&id=price.P1');
  assert.equal(cardUrlFor(null), 'popup.html?window=1');
  for (const search of ['', '?window=1', '?window=1&q=RIC%20972', '?corpus=pella', '?id=price.23', '?corpus=&id=price.23']) assert.equal(cardFromSearch(search), null, search);
});

test('popupUrlFor opens the resizable window on the cleaned selection, and on no reference when there is none', () => {
  assert.equal(popupUrlFor(' Crawford 44/5 '), 'popup.html?window=1&q=Crawford%2044%2F5');
  assert.equal(popupUrlFor('<img src=x onerror=alert(1)>'), 'popup.html?window=1&q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  for (const nothing of ['', '  ', undefined, null]) assert.equal(popupUrlFor(nothing), 'popup.html?window=1', String(nothing));
  assert.equal(queryFromSearch(popupUrlFor('HGC 4, 1218; BCD Boiotia 174b').slice('popup.html'.length)), 'HGC 4, 1218; BCD Boiotia 174b');
});

test('one lookup window: an open one is sent the address and brought forward; with none, a 440×680 window opens on it', async () => {
  const fakeApi = (answer) => {
    const calls = [];
    return { calls,
      runtime: { getURL: (path) => `chrome-extension://id/${path}`, sendMessage: async (message) => { calls.push(['send', message]); return answer(); } },
      windows: { create: async (options) => { calls.push(['create', options]); }, update: async (id, options) => { calls.push(['update', id, options]); } } };
  };
  const url = popupUrlFor('RIC 972');
  const sent = ['send', { type: LOOKUP_MESSAGE, url }];
  const open = fakeApi(() => ({ windowId: 7 }));
  await showInWindow(open, url);
  assert.deepEqual(open.calls, [sent, ['update', 7, { focused: true }]]);
  for (const none of [() => { throw new Error('Could not establish connection. Receiving end does not exist.'); }, () => undefined]) {
    const api = fakeApi(none);
    await showInWindow(api, url);
    assert.deepEqual(api.calls, [sent, ['create', { url: `chrome-extension://id/${url}`, type: 'popup', width: 440, height: 680 }]]);
  }
  // A window that took the lookup but couldn't name itself is not doubled.
  const unnamed = fakeApi(() => ({}));
  await showInWindow(unnamed, url);
  assert.deepEqual(unnamed.calls, [sent]);
  assert.equal(LOOKUP_MESSAGE, 'giga-pinax-lookup');
});

test('rapid launches create one window on the latest query while creation is pending', async () => {
  const calls = [];
  let releaseSend;
  const firstSend = new Promise((resolve) => { releaseSend = resolve; });
  let sends = 0;
  const api = {
    runtime: {
      getURL: (path) => `chrome-extension://id/${path}`,
      sendMessage: async (message) => { calls.push(['send', message]); sends += 1; if (sends === 1) await firstSend; },
    },
    windows: {
      create: async (options) => { calls.push(['create', options]); return { id: 12 }; },
      update: async (id, options) => { calls.push(['update', id, options]); },
    },
  };
  const first = showInWindow(api, popupUrlFor('Price 23'));
  const second = showInWindow(api, popupUrlFor('RIC 972'));
  releaseSend();
  await Promise.all([first, second]);
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  assert.equal(calls.find(([kind]) => kind === 'create')[1].url, 'chrome-extension://id/popup.html?window=1&q=RIC%20972');
});

test('a newer query arriving during an existing-window response is delivered before the shared launch completes', async () => {
  const sent = [];
  let releaseFirst;
  const firstReply = new Promise((resolve) => { releaseFirst = resolve; });
  const api = {
    runtime: {
      getURL: (path) => `chrome-extension://id/${path}`,
      sendMessage: async (message) => { sent.push(message.url); if (sent.length === 1) return firstReply; return { windowId: 7 }; },
    },
    windows: { create: async () => assert.fail('the open window should be reused'), update: async () => {} },
  };
  const first = showInWindow(api, popupUrlFor('Price 23'));
  await new Promise((resolve) => setImmediate(resolve));
  const second = showInWindow(api, popupUrlFor('RIC 972'));
  releaseFirst({ windowId: 7 });
  await Promise.all([first, second]);
  assert.deepEqual(sent, [popupUrlFor('Price 23'), popupUrlFor('RIC 972')]);
});

test('a newer query received while windows.create is pending replaces the created tab URL', async () => {
  let releaseCreate;
  const creating = new Promise((resolve) => { releaseCreate = resolve; });
  const tabUpdates = [];
  const api = {
    runtime: { getURL: (path) => `chrome-extension://id/${path}`, sendMessage: async () => undefined },
    windows: { create: async () => { await creating; return { id: 12, tabs: [{ id: 34 }] }; }, update: async () => {} },
    tabs: { update: async (id, options) => { tabUpdates.push([id, options]); } },
  };
  const first = showInWindow(api, popupUrlFor('Price 23'));
  await new Promise((resolve) => setImmediate(resolve));
  const second = showInWindow(api, popupUrlFor('RIC 972'));
  releaseCreate();
  await Promise.all([first, second]);
  assert.deepEqual(tabUpdates, [[34, { url: 'chrome-extension://id/popup.html?window=1&q=RIC%20972' }]]);
});

test('an invalid or closed responder window is ignored and recovered with a new lookup window', async () => {
  for (const answer of [{ windowId: '7' }, { windowId: 7 }]) {
    const creates = [];
    const api = {
      runtime: { getURL: (path) => `chrome-extension://id/${path}`, sendMessage: async () => answer },
      windows: {
        update: async () => { throw new Error('No window with id'); },
        create: async (options) => { creates.push(options); return { id: 9 }; },
      },
    };
    await showInWindow(api, popupUrlFor('SC 1266.2'));
    assert.equal(creates.length, 1);
  }
});

test('queryFromSearch reads and cleans q, and is empty without it', () => {
  assert.equal(queryFromSearch('?q=SC%201266.2'), 'SC 1266.2');
  assert.equal(queryFromSearch(`?q=${encodeURIComponent('  Price   23 ')}`), 'Price 23');
  assert.equal(queryFromSearch(''), '');
  assert.equal(queryFromSearch('?other=1'), '');
});

test('central lookup launch messages accept only bounded local popup window URLs', () => {
  assert.equal(LOOKUP_LAUNCH_MESSAGE, 'giga-pinax-launch-lookup');
  for (const url of [popupUrlFor('RIC 972'), cardUrlFor({ corpus: 'pella', id: 'price.23' }), 'popup.html?window=1']) assert.equal(isLookupWindowUrl(url), true, url);
  for (const url of ['https://evil.example/popup.html?window=1', 'popup.html?q=RIC+972', 'workspace.html?window=1', '', null, `popup.html?window=1&q=${'x'.repeat(4000)}`]) assert.equal(isLookupWindowUrl(url), false, String(url));
});

test('a pop-out closes only after the background confirms the lookup launch', () => {
  assert.equal(lookupLaunchSucceeded({ ok: true }), true);
  for (const reply of [{ ok: false, message: 'Window failed' }, undefined, null, {}, true]) assert.equal(lookupLaunchSucceeded(reply), false);
});
