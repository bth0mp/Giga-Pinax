// Loop 2 (D-01): four button systems, four control heights and three label sizes became one control layer in design-tokens.css. These checks
// keep it one: every page loads the layer first, the pages draw no control of their own, and the colours the layer hands out keep WCAG AA
// contrast in light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
const PAGES = ['popup.html', 'workspace.html', 'settings.html'];
const PAGE_SHEETS = ['popup.css', 'workspace.css', 'settings.css', 'bid-tools.css', 'companion-popup.css'];

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
  // Fix round: updates.css styled nothing any page carries (the Updates card uses ids), so Settings loads the layer and its own sheet only.
  assert.deepEqual([...read('settings.html').matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]), ['design-tokens.css', 'settings.css']);
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
      // A rule that ends on a kind's own class may place that button, never colour it again: the kind is drawn once, in the layer.
      const last = selector.split(/[\s>+~]+/).pop();
      if (/\.(primary-button|secondary-button|secondary|quiet|danger|button-link|companion-outline-button|companion-save-watchlist)\b/.test(last)) {
        assert.doesNotMatch(body, /(^|;)\s*(color|background|border-color):/, `${sheet} ${selector} redraws its kind`);
      }
    }
  }
});

// Fix round (review Minors 2 and 3): nothing scrolls sideways at 320. A coin whose title does not fit made the coin list's grid track as wide as
// the unbroken title, and the calculator's house-name box was 8 px wider than its fold because its right margin sat outside its 100 %.
test('record lists and the house-name box stay inside their column', () => {
  const workspace = rules(read('workspace.css'));
  assert.match(workspace.filter((rule) => rule.selector === '.record-list').map((rule) => rule.body).join(';'), /grid-template-columns:minmax\(0,1fr\)/);
  const preset = rules(read('bid-tools.css')).find((rule) => rule.selector === '.bid-preset-editor input').body;
  const right = Number(/margin:\d+px (\d+)px/.exec(preset)?.[1] ?? 0);
  assert.match(preset, new RegExp(String.raw`width:min\(260px,\s*100%${right ? String.raw`\s*-\s*${right}px` : ''}\)`));
});

// Fix round (review Minor 4): the layer's labels are 650; the popup's filter checkboxes are not field names. Loop 3 (G-03) made them pills in the
// sales period's row, drawn at the pills' own 400 weight.
test('the popup’s filter checkboxes are not drawn as field labels', () => {
  const popup = rules(read('popup.css'));
  assert.match(popup.filter((rule) => rule.selector === '.filter-pill').map((rule) => rule.body).join(';'), /font-weight:400/);
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

// W-09 / G-14: "Compare coins" repeated the coin list as a second list of checkbox rows. The box sits at the left of each
// coin row instead, shown on hover or focus and while any coin is ticked (always on a touch screen), and a ticked row is
// marked by more than the tick.
test('the compare box sits in each coin row, shows while comparing, and marks the ticked rows', () => {
  const workspace = rules(read('workspace.css'));
  const body = (selector) => workspace.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(';');
  assert.match(body('.compare-box'), /position:absolute/);
  assert.match(body('.compare-box'), /opacity:0/);
  assert.match(body('.coin-row-wrap:hover .compare-box,.compare-box:focus-visible,.comparing .compare-box'), /opacity:1/);
  assert.match(body('.coin-row-wrap:has(.compare-box:checked) .coin-row'), /background:var\(--accent-soft\)/);
  assert.equal(workspace.some((rule) => /#comparison-picker|\.compare-choice/.test(rule.selector)), false, 'no second list is styled');
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

// Fix round: the shared chevron is wider than the ⌄ glyph the popup drew, and at 320 it wrapped under "Sources"; the header's text actions stay
// on one line.
test('the popup header’s text actions never wrap', () => {
  const header = rules(read('popup.css')).find((rule) => rule.selector === '.header-action,.header-actions summary');
  assert.match(header.body, /white-space:nowrap/);
});

// Fix round, found at 320: the phone rule that pulls the sticky Save bar out to the coin panel's 16 px edges came before the base rule's 22 px, so
// the base won and the bar stuck 6 px out of the panel on each side (clipped, but a sideways overflow). The phone rule now comes after it.
test('at phone width the sticky action bar spans the coin panel and no further', () => {
  const bars = rules(read('workspace.css')).filter((rule) => rule.selector === '.action-bar');
  const base = bars.findIndex((rule) => /position:sticky/.test(rule.body));
  const phone = bars.findIndex((rule) => /margin-right:-16px/.test(rule.body));
  assert.ok(base >= 0 && phone > base, `phone rule ${phone}, base rule ${base}`);
});
