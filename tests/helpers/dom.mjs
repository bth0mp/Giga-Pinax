// A hand-written stand-in for the handful of DOM features the extension's pages use, so a page can
// be loaded in a `vm` sandbox and driven like a page instead of being read back as source text. It
// is not a browser and does not try to be one: it knows only what these pages ask of it, and a page
// that reaches for anything else fails loudly rather than being quietly approximated. No dependency:
// the repo ships none, and a test harness is no reason to start.

import { readFileSync } from 'node:fs';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
]);
const RAW_TEXT_TAGS = new Set(['script', 'style']);
// Boolean attributes: present means true, and writing false takes the attribute away again.
const BOOLEAN_ATTRIBUTES = new Set([
  'hidden', 'disabled', 'checked', 'required', 'selected', 'multiple', 'open', 'readonly',
]);
const REFLECTED_ATTRIBUTES = {
  placeholder: 'placeholder', href: 'href', src: 'src', alt: 'alt', title: 'title',
  target: 'target', rel: 'rel', htmlFor: 'for', role: 'role', accept: 'accept',
  download: 'download', maxLength: 'maxlength', inputMode: 'inputmode', rows: 'rows',
  cols: 'cols', lang: 'lang', accessKey: 'accesskey', step: 'step', min: 'min', max: 'max',
};
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(ENTITIES, body.toLowerCase()) ? ENTITIES[body.toLowerCase()] : whole;
  });
}

export class FakeText {
  constructor(data = '') {
    this.nodeType = 3;
    this.data = String(data);
    this.parentNode = null;
  }

  get textContent() { return this.data; }

  set textContent(value) { this.data = String(value); }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null;
  }
}

// One simple selector — `#id`, `.class`, `tag`, `[attr]`, `[attr="value"]` or `*`, in any
// combination — matched against one element. No combinators: no page here selects across a
// relationship, and a selector that quietly matched the wrong thing would be worse than none, so
// one that asks for a relationship is refused rather than approximated.
function matchesSimple(element, selector) {
  const trimmed = selector.trim();
  if (/[\s>+~]/.test(trimmed)) throw new Error(`The fake DOM matches simple selectors only: ${selector}`);
  const tokens = trimmed.match(/\*|#[\w-]+|\.[\w-]+|\[[^\]]+\]|[\w-]+/g);
  if (!tokens || !tokens.length) return false;
  return tokens.every((token) => {
    if (token === '*') return true;
    if (token[0] === '#') return element.id === token.slice(1);
    if (token[0] === '.') return element.classList.contains(token.slice(1));
    if (token[0] === '[') {
      const parsed = /^\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]$/.exec(token);
      if (!parsed) return false;
      const [whole, name, doubled, singled, bare] = parsed;
      const actual = element.getAttribute(name);
      if (actual === null) return false;
      return whole.includes('=') ? actual === (doubled ?? singled ?? bare ?? '') : true;
    }
    return element.tagName === token.toLowerCase();
  });
}

function matchesSelector(element, selector) {
  return String(selector).split(',').some((one) => one.trim() && matchesSimple(element, one));
}

function* descendants(element) {
  for (const child of element.childNodes) {
    if (child.nodeType !== 1) continue;
    yield child;
    yield* descendants(child);
  }
}

export class FakeElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.nodeType = 1;
    this.tagName = String(tagName).toLowerCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.focusCount = 0;
    this.clickCount = 0;
    this._value = '';
  }

  // --- attributes, and the properties that reflect them -----------------------------------------

  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    this.attributes.set(key, String(value));
    if (key === 'value') this._value = String(value);
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }

  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }

  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, '');
    else this.removeAttribute(name);
  }

  get id() { return this.getAttribute('id') ?? ''; }

  set id(value) { this.setAttribute('id', value); }

  get className() { return this.getAttribute('class') ?? ''; }

  set className(value) { this.setAttribute('class', value); }

  get name() { return this.getAttribute('name') ?? ''; }

  set name(value) { this.setAttribute('name', value); }

  get type() { return this.getAttribute('type') ?? ''; }

  set type(value) { this.setAttribute('type', value); }

  get value() { return this._value; }

  set value(next) { this._value = String(next); }

  get classList() {
    const element = this;
    const read = () => element.className.split(/\s+/).filter(Boolean);
    const write = (names) => { element.className = names.join(' '); };
    return {
      contains: (name) => read().includes(name),
      add(...names) { write([...new Set([...read(), ...names])]); },
      remove(...names) { write(read().filter((name) => !names.includes(name))); },
      toggle(name, force) {
        const has = read().includes(name);
        const next = force ?? !has;
        if (next) this.add(name);
        else this.remove(name);
        return next;
      },
    };
  }

  // --- children -------------------------------------------------------------------------------

  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }

  get textContent() { return this.childNodes.map((node) => node.textContent).join(''); }

  set textContent(value) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = String(value) === '' ? [] : [new FakeText(value)];
    for (const node of this.childNodes) node.parentNode = this;
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.remove?.();
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  prepend(...nodes) {
    const existing = this.childNodes;
    this.childNodes = [];
    this.append(...nodes);
    this.childNodes.push(...existing);
  }

  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null;
  }

  contains(node) {
    for (const child of descendants(this)) if (child === node) return true;
    return false;
  }

  // --- finding --------------------------------------------------------------------------------

  matches(selector) { return matchesSelector(this, selector); }

  querySelector(selector) {
    for (const child of descendants(this)) if (matchesSelector(child, selector)) return child;
    return null;
  }

  querySelectorAll(selector) {
    return [...descendants(this)].filter((child) => matchesSelector(child, selector));
  }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (node.nodeType === 1 && matchesSelector(node, selector)) return node;
    }
    return null;
  }

  // --- events and the rest a page touches -------------------------------------------------------

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== listener));
  }

  // How a test reaches the page: the listeners registered for this event, awaited together, so a
  // handler that is async is finished with before the assertions read what it wrote.
  emit(type, detail = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { event.defaultPrevented = true; },
      stopPropagation() {},
      ...detail,
    };
    return Promise.all((this.listeners.get(type) ?? []).map((listener) => listener(event)));
  }

  // As the other half of a page reaches this one: the same listeners, started synchronously.
  dispatchEvent(event) {
    void this.emit(event?.type, event ? { detail: event.detail } : {});
    return true;
  }

  click() {
    this.clickCount += 1;
    return this.emit('click');
  }

  focus() {
    this.focusCount += 1;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null; }

  reportValidity() { return true; }

  scrollIntoView() {}

  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }

  requestSubmit(submitter) { return this.emit('submit', { submitter }); }
}

for (const attribute of BOOLEAN_ATTRIBUTES) {
  Object.defineProperty(FakeElement.prototype, attribute, {
    get() { return this.hasAttribute(attribute); },
    set(value) { this.toggleAttribute(attribute, Boolean(value)); },
    configurable: true,
  });
}

// Properties a page writes that a browser writes straight back out as an attribute, so a test can
// read either one and see the same thing.
for (const [property, attribute] of Object.entries(REFLECTED_ATTRIBUTES)) {
  Object.defineProperty(FakeElement.prototype, property, {
    get() { return this.getAttribute(attribute) ?? ''; },
    set(value) { this.setAttribute(attribute, value); },
    configurable: true,
  });
}

export class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.documentElement = new FakeElement('html', this);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.head, this.body);
  }

  createElement(tagName) { return new FakeElement(tagName, this); }

  createTextNode(data) { return new FakeText(data); }

  getElementById(id) {
    for (const element of descendants(this.documentElement)) if (element.id === id) return element;
    return this.documentElement.id === id ? this.documentElement : null;
  }

  querySelector(selector) {
    return matchesSelector(this.documentElement, selector)
      ? this.documentElement
      : this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    const found = this.documentElement.querySelectorAll(selector);
    return matchesSelector(this.documentElement, selector) ? [this.documentElement, ...found] : found;
  }
}

// What a form hands its submit handler: the successful controls, by name. Radios and checkboxes
// count only while they are checked, as a browser counts them.
export class FakeFormData {
  constructor(form) {
    this.entries = [];
    for (const field of form.querySelectorAll('input, select, textarea')) {
      if (!field.name) continue;
      if ((field.type === 'radio' || field.type === 'checkbox') && !field.checked) continue;
      this.entries.push([field.name, field.value]);
    }
  }

  get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }

  getAll(name) { return this.entries.filter(([key]) => key === name).map(([, value]) => value); }
}

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

export class FakeCustomEvent extends FakeEvent {}

function tagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return source.length;
}

function readAttributes(text) {
  const pattern = /([\w:@.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const found = [];
  let match = pattern.exec(text);
  while (match) {
    const [, name, doubled, singled, bare] = match;
    found.push([name, decodeEntities(doubled ?? singled ?? bare ?? '')]);
    match = pattern.exec(text);
  }
  return found;
}

// Enough of an HTML parser for the extension's own pages: elements, attributes, text, comments, the
// doctype and the raw text inside <script>/<style>. The pages are written by hand in this repo, so
// the parser answers for what they contain and nothing more.
export function parseHtml(source) {
  const document = new FakeDocument();
  const root = new FakeElement('#document', document);
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let index = 0;
  while (index < source.length) {
    const next = source.indexOf('<', index);
    if (next === -1) {
      if (index < source.length) top().append(decodeEntities(source.slice(index)));
      break;
    }
    if (next > index) top().append(decodeEntities(source.slice(index, next)));
    if (source.startsWith('<!--', next)) {
      const close = source.indexOf('-->', next);
      index = close === -1 ? source.length : close + 3;
      continue;
    }
    if (source.startsWith('<!', next) || source.startsWith('<?', next)) {
      index = tagEnd(source, next) + 1;
      continue;
    }
    if (source.startsWith('</', next)) {
      const close = tagEnd(source, next);
      const name = source.slice(next + 2, close).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tagName === name) { stack.length = depth; break; }
      }
      index = close + 1;
      continue;
    }
    const close = tagEnd(source, next);
    const body = source.slice(next + 1, close);
    const name = /^[\w:-]+/.exec(body)?.[0];
    if (!name) { index = close + 1; continue; }
    const element = new FakeElement(name, document);
    for (const [attribute, value] of readAttributes(body.slice(name.length))) {
      element.setAttribute(attribute, value);
    }
    top().append(element);
    index = close + 1;
    if (VOID_TAGS.has(element.tagName) || body.trimEnd().endsWith('/')) continue;
    if (RAW_TEXT_TAGS.has(element.tagName)) {
      const end = source.toLowerCase().indexOf(`</${element.tagName}`, index);
      element.append(source.slice(index, end === -1 ? source.length : end));
      index = end === -1 ? source.length : tagEnd(source, end) + 1;
      continue;
    }
    stack.push(element);
  }
  document.documentElement = root.querySelector('html') ?? root;
  document.documentElement.dataset = {};
  document.head = document.querySelector('head') ?? new FakeElement('head', document);
  document.body = document.querySelector('body') ?? new FakeElement('body', document);
  return document;
}

export function parseHtmlFile(url) {
  return parseHtml(readFileSync(url, 'utf8'));
}

// A page's source with its import statements taken out, ready for a sandbox that is handed the same
// names as globals - the way tests/popup-research.test.mjs loads extension/popup.js.
export function pageSource(url) {
  return readFileSync(url, 'utf8')
    .replace(/^import\b[\s\S]*?';\r?\n/gm, '')
    .replace(/^export\s+(?=(?:default\s+|async\s+)?(?:function|const|let|var|class)\b)/gm, '');
}

// A browser's own globals, as far as a page loaded here uses them.
export function browserGlobals(document, { localStorage, confirm = () => true, downloads = [], language = 'en-US' } = {}) {
  return {
    document,
    localStorage,
    confirm,
    navigator: { language },
    FormData: FakeFormData,
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    Blob: class Blob {
      constructor(parts = [], options = {}) { this.parts = parts; this.type = options.type ?? ''; }
    },
    // Object URLs are the only thing these pages ask of URL, and what they hand it is recorded so a
    // test can see which file the page tried to give the browser.
    URL: {
      createObjectURL: (blob) => {
        downloads.push(blob);
        return `blob:giga-pinax/${downloads.length}`;
      },
      revokeObjectURL() {},
    },
    setTimeout: () => 0,
    clearTimeout() {},
    queueMicrotask,
    console,
  };
}
