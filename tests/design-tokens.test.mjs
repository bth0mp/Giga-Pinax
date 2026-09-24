// Loop 2 (D-01): four button systems, four control heights and three label sizes became one control layer in design-tokens.css. These checks
// keep it one: every page loads the layer first, the pages draw no control of their own, and the colours the layer hands out keep WCAG AA
// contrast in light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
const PAGES = ['popup.html', 'workspace.html', 'settings.html'];
const PAGE_SHEETS = ['popup.css', 'workspace.css', 'settings.css', 'bid-tools.css', 'companion-popup.css', 'updates.css'];

// Every rule of a stylesheet as { selector, body }, media queries flattened; comments dropped.
function rules(css) {
  const out = [];
  const walk = (text) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf('{', index);
      if (open === -1) break;
      const head = text.slice(index, open).trim();
      let depth = 1; let close = open + 1;
      while (depth && close < text.length) { if (text[close] === '{') depth += 1; else if (text[close] === '}') depth -= 1; close += 1; }
      const body = text.slice(open + 1, close - 1);
      if (head.startsWith('@')) walk(body); else out.push({ selector: head, body });
      index = close;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}

test('every page loads the shared layer before its own stylesheets', () => {
  for (const page of PAGES) {
    const sheets = [...read(page).matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
    assert.equal(sheets[0], 'design-tokens.css', page);
  }
  // The workspace's and Settings' bare buttons are primary through the page class on <body>.
  assert.match(read('workspace.html'), /<body class="page-workspace">/);
  assert.match(read('settings.html'), /<body class="page-settings">/);
});

test('the layer defines the scale, the control size and the four button kinds once', () => {
  const css = read('design-tokens.css');
  for (const token of ['--text-meta:11px', '--text-body:12px', '--text-input:13px', '--text-h3:16px', '--text-figure:32px', '--control-h:38px',
    '--control-h-sm:32px', '--radius:6px', '--radius-panel:8px', '--label-weight:650', '--label-gap:6px', '--focus-width:3px']) {
    assert.ok(css.includes(token), token);
  }
  const layer = rules(css);
  // A kind's own rule is the one that starts with its name; the rule before them all is the shared base, which is primary.
  const kind = (name) => layer.find((rule) => rule.selector === name || rule.selector.startsWith(`${name},`))?.body ?? '';
  assert.match(kind('.btn'), /background:var\(--accent\);color:var\(--on-accent\)/);
  assert.match(kind('.secondary'), /border-color:var\(--accent\);background:var\(--card\);color:var\(--accent\)/);
  assert.match(kind('.quiet'), /border-color:var\(--border\);background:transparent;color:var\(--ink\)/);
  assert.match(kind('.danger'), /border-color:var\(--error\);background:transparent;color:var\(--error\)/);
  assert.match(css, /::placeholder\{color:var\(--muted\);opacity:1\}/);
});

// A control's height, corner or kind drawn by a page is what made four systems; the pages keep layout only.
test('no page stylesheet sizes a control or draws a button kind of its own', () => {
  const control = /(^|[\s>+~,(])(button|input|select|textarea)\b|\.(primary-button|secondary-button|secondary|quiet|danger|button|button-link|companion-outline-button|companion-save-watchlist)\b/;
  for (const sheet of PAGE_SHEETS) {
    for (const { selector, body } of rules(read(sheet))) {
      if (!control.test(selector) || /icon-button|svg/.test(selector)) continue;
      // A note box's height is its own; a control's is the layer's.
      if (!/textarea/.test(selector)) assert.doesNotMatch(body, /(^|;)\s*(min-)?height:\s*\d{2,}px/, `${sheet} ${selector}`);
      assert.doesNotMatch(body, /border-radius:\s*\d+px/, `${sheet} ${selector}`);
      if (!/danger/.test(selector)) assert.doesNotMatch(body, /background:\s*var\(--accent\)/, `${sheet} ${selector}`);
    }
  }
});

test('every class a workspace or Settings button carries is styled by a stylesheet the page loads', () => {
  for (const page of ['workspace.html', 'settings.html']) {
    const html = read(page);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => read(match[1])).join('\n');
    const classes = new Set([...html.matchAll(/<button\b[^>]*\bclass="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
    assert.deepEqual([...classes].filter((name) => !new RegExp(String.raw`\.${name}(?![\w-])`).test(sheets)), [], page);
  }
});

// Faded text is faded contrast: an excluded sale at .62 opacity read 2.5:1. It keeps full contrast and says so by striking its amount.
test('an excluded sale is marked without fading its text', () => {
  const popup = rules(read('popup.css'));
  for (const { selector, body } of popup.filter((rule) => /excluded/.test(rule.selector))) assert.doesNotMatch(body, /opacity/, selector);
  assert.ok(popup.some(({ selector, body }) => /li\.excluded strong/.test(selector) && /line-through/.test(body)));
});

// The colours handed out for text, read from the tokens themselves: 4.5:1 for text on every surface, 3:1 for a field's edge.
test('the palette keeps WCAG AA contrast in light and dark', () => {
  const css = read('design-tokens.css');
  const block = (pattern) => Object.fromEntries([...pattern.exec(css)[1].matchAll(/--([\w-]+):(#[0-9a-f]{3,6})/g)].map((match) => [match[1], match[2]]));
  const light = block(/:root\{(color-scheme:light[^}]*)\}/);
  const dark = { ...light, ...block(/:root\[data-theme="dark"\]\{([^}]*)\}/) };
  const channel = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = (short) => { const hex = short.length === 4 ? `#${[...short.slice(1)].map((c) => c + c).join('')}` : short; const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
    for (const surface of ['bg', 'surface', 'card', 'soft', 'accent-soft']) {
      for (const ink of ['ink', 'muted', 'accent', 'error', 'warning']) {
        assert.ok(ratio(tokens[ink], tokens[surface]) >= 4.5, `${theme}: --${ink} on --${surface} is ${ratio(tokens[ink], tokens[surface]).toFixed(2)}:1`);
      }
    }
    for (const surface of ['bg', 'surface', 'card']) assert.ok(ratio(tokens.field, tokens[surface]) >= 3, `${theme}: field edge on --${surface}`);
    for (const face of ['accent', 'accent-hover']) assert.ok(ratio(tokens['on-accent'], tokens[face]) >= 4.5, `${theme}: --on-accent on --${face}`);
  }
});

// W-09 (styling part): "Compare coins" repeated the coin list as a second list of two-line checkbox rows. The picker is a bounded box of
// one-line choices, the chosen ones marked by more than the tick, and an empty picker takes no room.
test('the comparison picker is a short box of one-line choices with the chosen ones marked', () => {
  const workspace = rules(read('workspace.css'));
  const body = (selector) => workspace.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(';');
  assert.match(body('#comparison-picker'), /max-height:\d+px/);
  assert.match(body('#comparison-picker'), /overflow:auto/);
  assert.match(body('.compare-choice'), /white-space:nowrap/);
  assert.match(body('.compare-choice'), /text-overflow:ellipsis/);
  assert.match(body('.compare-choice:has(:checked)'), /background:var\(--accent-soft\)/);
  assert.match(body('#comparison-picker:empty'), /margin:0;padding:0/);
});

// S-01 (what was left): Settings on the shared scale. Its section headings are the workspace's panel headings (16, subsections 14), its prose
// one size, and its everyday actions secondary buttons, with only Clear left quiet beside Copy diagnostics.
test('Settings uses the shared scale and button kinds', () => {
  const settings = rules(read('settings.css'));
  const body = (selector) => settings.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(';');
  assert.match(body('h2'), /font:600 var\(--text-h3\)/);
  assert.match(body('h3'), /font:600 var\(--text-h4\)/);
  assert.match(body('p'), /font-size:13px/);
  const html = read('settings.html');
  for (const id of ['add-premium', 'copy-presets', 'paste-presets', 'export-csv', 'download-quarantine', 'export-raw', 'copy-diagnostics']) {
    assert.match(html, new RegExp(`<button id="${id}" class="secondary"`), id);
  }
  assert.match(html, /<button class="secondary" type="submit">Preview import<\/button>/);
  assert.match(html, /<button id="clear-diagnostics" class="quiet"/);
});
