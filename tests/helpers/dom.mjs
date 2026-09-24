// A hand-written stand-in for the handful of DOM features the extension's pages use, so a page can
// be loaded in a `vm` sandbox and driven like a page instead of being read back as source text. It
// is not a browser and does not try to be one: it knows only what these pages ask of it, and a page
// that reaches for anything else fails loudly rather than being quietly approximated. No dependency:
// the repo ships none, and a test harness is no reason to start.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

// One simple selector — `#id`, `.class`, `tag`, `[attr]`, `[attr="value"]`, `:checked` or `*`, in any
// combination — matched against one element. No combinators: no page here selects across a
// relationship, and a selector that quietly matched the wrong thing would be worse than none, so
// one that asks for a relationship is refused rather than approximated.
function matchesSimple(element, selector) {
  const trimmed = selector.trim();
  if (/[\s>+~]/.test(trimmed)) throw new Error(`The fake DOM matches simple selectors only: ${selector}`);
  const tokens = trimmed.match(/\*|#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+|[\w-]+/g);
  if (!tokens || !tokens.length) return false;
  return tokens.every((token) => {
    if (token === '*') return true;
    // The one state a page selects by: a checked box or radio.
    if (token === ':checked') return Boolean(element.checked);
    if (token[0] === ':') throw new Error(`The fake DOM matches no ${token} state: ${selector}`);
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
    // Markup's data-* attributes read back through dataset, as a page reads them.
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase())] = String(value);
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

  // An option's value is its attribute, falling back to its text, as a browser reflects it; a
  // page's `option.value = ''` has to survive the form's reset() like the markup's own options do.
  get value() { return this.tagName === 'option' ? this.getAttribute('value') ?? this.textContent : this._value; }

  set value(next) {
    if (this.tagName === 'option') this.setAttribute('value', next);
    else this._value = String(next);
  }

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

  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }

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

  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const rest = parent.childNodes.splice(parent.childNodes.indexOf(this) + 1);
    parent.append(...nodes);
    parent.childNodes.push(...rest);
  }

  // Markup a page writes is parsed like the page's own; it never carries text from a record here.
  set innerHTML(markup) {
    const parsed = parseHtml(`<body>${markup}</body>`).body;
    for (const element of descendants(parsed)) element.ownerDocument = this.ownerDocument;
    this.replaceChildren(...parsed.childNodes);
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

  // --- forms and dialogs --------------------------------------------------------------------------

  // A form's controls by name. Radios sharing a name answer as one group, whose value is the checked one.
  get elements() {
    const byName = {};
    for (const control of this.querySelectorAll('input, select, textarea, button, fieldset, output')) {
      if (control.name) (byName[control.name] ??= []).push(control);
    }
    return Object.fromEntries(Object.entries(byName).map(([name, [first, ...rest]]) => [name, !rest.length ? first : {
      get value() { return [first, ...rest].find((radio) => radio.checked)?.value ?? ''; },
      set value(next) { for (const radio of [first, ...rest]) radio.checked = radio.value === String(next); },
    }]));
  }

  // Back to the markup's own values. Checked state is the attribute here, so it is left as it is.
  reset() {
    for (const control of this.querySelectorAll('input, select, textarea')) {
      if (control.tagName === 'textarea') control.value = control.textContent;
      else if (control.tagName === 'select') {
        const option = control.querySelector('option[selected]') ?? control.querySelector('option');
        control.value = option ? option.getAttribute('value') ?? option.textContent : '';
      } else if (!['radio', 'checkbox'].includes(control.type)) control.value = control.getAttribute('value') ?? '';
    }
  }

  get options() { return this.querySelectorAll('option'); }

  showModal() { this.open = true; }

  close() { this.open = false; }
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
// names as globals - the way tests/popup-research.test.mjs loads extension/popup.js. A dynamic
// import() becomes a call to the sandbox's `importModule`, since vm cannot import without a flag;
// a sandbox that has none fails it the way a page without the module would. An export list naming
// the module's own declarations (`export { a, b };`, no `from`) declares and runs nothing, so it goes.
export function pageSource(url) {
  return readFileSync(url, 'utf8')
    .replace(/^import\b[\s\S]*?';\r?\n/gm, '')
    .replace(/\bimport\((?=['"])/g, 'importModule(')
    .replace(/^export\s*\{[^}]*\};[ \t]*\r?\n/gm, '')
    .replace(/^export\s+(?=(?:default\s+|async\s+)?(?:function|const|let|var|class)\b)/gm, '');
}

// --- A page and the modules it was split into ---------------------------------------------------
//
// A page split into several modules is still one page: the modules it was split into touch its
// document, its storage and its state the way its own code does, so they run with it in its sandbox,
// in the order a browser evaluates them (each one's own page modules first, in import order), rather
// than being imported here, where they would reach Node's globals instead of the page's. These are
// they, by file name beside the pages. Anything else a page imports is handed in as sandbox globals,
// as it always was.
export const PAGE_MODULES = new Set(['popup-access.js', 'popup-drawing.js', 'popup-messages.js', 'popup-shell.js', 'workspace-editing.js', 'workspace-forms.js', 'workspace-views.js']);

// The top-level names a script declares, read the way these files are written: every top-level
// declaration starts at the left margin.
function topLevelNames(source) {
  const names = [];
  for (const [, name] of source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) names.push(name);
  for (const [, name] of source.matchAll(/^(?:export\s+)?(?:const|let|var|class)\s+([\w$]+)/gm)) names.push(name);
  for (const [, list] of source.matchAll(/^(?:export\s+)?(?:const|let|var)\s*\{([^}]*)\}/gm)) {
    names.push(...list.split(',').map((part) => part.split(':').at(-1).trim()).filter(Boolean));
  }
  return names;
}

// Runs a page in a sandbox with its own modules before it. What a sandbox of scripts cannot do the
// way the browser's modules do is refused rather than approximated: an import or export form
// pageSource leaves behind, and one name declared by two of them - a module's names are its own in
// a browser, while here a second function of the same name would quietly replace the first.
export function runPage(context, url, modules = PAGE_MODULES) {
  const declared = new Map();
  const ran = new Set();
  const run = (fileUrl) => {
    if (ran.has(fileUrl.href)) return;
    ran.add(fileUrl.href);
    const text = readFileSync(fileUrl, 'utf8');
    for (const [, specifier] of text.matchAll(/^import\b[^;]*?from\s+'(\.\/[\w.-]+)';/gm)) {
      if (modules.has(specifier.slice(2))) run(new URL(specifier, fileUrl));
    }
    const source = pageSource(fileUrl);
    const leftover = /^(?:import|export)\b.*$/m.exec(source);
    if (leftover) throw new Error(`${fileUrl.pathname} keeps "${leftover[0]}", which a sandbox script cannot run.`);
    for (const name of topLevelNames(source)) {
      if (declared.has(name)) throw new Error(`${name} is declared by both ${declared.get(name)} and ${fileUrl.pathname}.`);
      declared.set(name, fileUrl.pathname);
    }
    vm.runInContext(source, context, { filename: fileUrl.pathname });
  };
  run(url);
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

// --- The workspace page on the real store -------------------------------------------------------
//
// The workspace is only as good as what it does with the store's answers, so here it runs against
// the real command writer (extension/store.js) over an in-memory storage area, reached through the
// real bridge (extension/browser-api.js) loaded in a sandbox of its own. What is fake is only what a
// browser would supply: `runtime.sendMessage`, which hands the command straight to the writer the
// way the background worker does, and `storage.onChanged`, which tells every open page about each
// write on a later turn, as a browser does. Several pages can share one background, which is how a
// second tab writing behind the collector's back is shown.

let uuidCounter = 0;
export const testUuid = () => {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
};

export const settle = async (turns = 10) => {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => { setImmediate(resolve); });
};

// A storage area kept in memory. Every write is announced to the `onChanged` listeners on a later
// turn, never inside the write itself: a page never hears of a write before the writer has finished.
export function memoryStorageArea() {
  const stored = new Map();
  const listeners = new Set();
  return {
    async get(key) { return stored.has(key) ? { [key]: structuredClone(stored.get(key)) } : {}; },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: structuredClone(stored.get(key)), newValue: structuredClone(value) };
        stored.set(key, structuredClone(value));
      }
      setImmediate(() => { for (const listener of [...listeners]) listener(structuredClone(changes), 'local'); });
    },
    onChanged: {
      addListener: (listener) => { listeners.add(listener); },
      removeListener: (listener) => { listeners.delete(listener); },
    },
    read: (key) => structuredClone(stored.get(key)),
  };
}

// The background worker as far as a page sees it: one writer over one storage area. `send` is any
// other view writing — a second workspace tab, the popup — and returns the writer's reply.
export async function createWorkspaceBackground({ now = '2026-09-12T12:00:00.000Z', newId = testUuid } = {}) {
  const { COMMAND_TYPES, createCommandWriter, STORAGE_KEY } = await import('../../extension/store.js');
  const storage = memoryStorageArea();
  const writer = createCommandWriter(storage, { now: () => now, newId });
  const holds = [];
  return {
    storage,
    writer,
    holds,
    commandTypes: COMMAND_TYPES,
    send: (command) => writer.commitCommand({ requestId: testUuid(), ...command }),
    root: () => storage.read(STORAGE_KEY),
    // The next command of this type sent by a page is written, and its reply then waits for
    // `release()`: the save is in flight for the page that sent it while its write is already in
    // storage and on its way to every page's subscription, as it can be in a browser.
    holdReply(type) {
      const hold = { type };
      hold.written = new Promise((resolve) => { hold.markWritten = resolve; });
      hold.released = new Promise((resolve) => { hold.release = resolve; });
      holds.push(hold);
      return hold;
    },
  };
}

// The runtime a page and its bridge are handed: `sendMessage` goes to the background's writer, as
// the worker's message listener sends it, and `storage` is the background's own area.
function fakeExtensionRuntime(background, commands) {
  return {
    runtime: {
      async sendMessage(message) {
        const command = structuredClone(message);
        commands.push(structuredClone(command));
        // The worker answers only the commands it lists; any other message gets no reply, which the
        // browser reports to the sender as an error.
        if (!background.commandTypes.has(command?.type)) throw new Error('The message got no reply: the background worker does not answer this command.');
        const reply = await background.writer.commitCommand(command);
        const index = background.holds.findIndex((hold) => hold.type === command.type);
        if (index >= 0) {
          const [hold] = background.holds.splice(index, 1);
          hold.markWritten(command);
          await hold.released;
        }
        return structuredClone(reply);
      },
    },
    storage: { local: background.storage, onChanged: background.storage.onChanged },
    permissions: { request: async () => false },
  };
}

// The real bridge module, loaded against that runtime.
function loadBridge(browser) {
  const url = new URL('../../extension/browser-api.js', import.meta.url);
  const context = vm.createContext({ browser, crypto: { randomUUID: testUuid }, Promise, Error });
  vm.runInContext(pageSource(url), context, { filename: url.pathname });
  return Object.fromEntries(['sendCommand', 'getSnapshot', 'subscribeToSnapshots', 'requestNotificationPermission']
    .map((name) => [name, context[name]]));
}

// The workspace page, loaded as tests/settings.test.mjs loads Settings: its markup in the fake DOM,
// its imports handed in as sandbox globals. With a `background` it runs against that store; without
// one it runs as the standalone preview a page outside the extension shows.
export async function mountWorkspace({ background = null, hash = '', confirmAnswers = [], language = 'en-US' } = {}) {
  const [money, evidence, projections, sourceLaunchers] = await Promise.all([
    import('../../extension/core/money.js'), import('../../extension/core/evidence.js'),
    import('../../extension/core/projections.js'), import('../../extension/source-launchers.js'),
  ]);
  const document = parseHtmlFile(new URL('../../extension/workspace.html', import.meta.url));
  const prompts = [];
  const commands = [];
  const calculatorValues = [];
  const windowListeners = new Map();
  const browser = background ? fakeExtensionRuntime(background, commands) : null;
  const bridge = browser ? loadBridge(browser) : null;
  const location = { hash };
  const sandbox = {
    ...money, ...evidence, ...projections, ...sourceLaunchers,
    // The calculator, the sources menu and Settings are other pages' concerns, with tests of their own.
    // What the page hands the calculator is recorded, so a test can run it through the calculator's own rules.
    mountBidCalculator: () => ({ setValues(values) { calculatorValues.push(structuredClone(values)); } }), mountSourcesMenu() {}, openSettings() {},
    ...browserGlobals(document, {
      language,
      confirm: (message) => { prompts.push(message); return confirmAnswers.length ? confirmAnswers.shift() : true; },
    }),
    ...(browser ? { browser } : {}),
    crypto: { randomUUID: testUuid },
    // The preferences module is Settings' and the popup's; without it the page reads its snapshot
    // straight from the bridge, the path every other record takes.
    importModule: async (specifier) => {
      if (bridge && specifier === './browser-api.js') return bridge;
      throw new Error(`No module ${specifier} in this sandbox.`);
    },
    requestAnimationFrame: (callback) => callback(),
    location,
    addEventListener(type, listener) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
    Date, JSON, Object, Array, String, Number, Boolean, Math, Promise, Set, Map, RegExp, Intl,
    Error, TypeError, RangeError, BigInt, structuredClone,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  runPage(vm.createContext(sandbox), new URL('../../extension/workspace.js', import.meta.url));
  await settle();
  const $ = (id) => document.getElementById(id);
  const type = async (form, field, value) => {
    const control = $(form).elements[field];
    control.value = value;
    await $(form).emit('input', { target: control });
  };
  return {
    $, document, location, commands, prompts, browser, calculatorValues,
    status: () => $('workspace-status').textContent,
    conflictBanner: () => ($('conflict-note').hidden ? '' : $('conflict-editors').textContent),
    // What the browser's leave-page prompt would do now: true when the page asks to stay.
    blocksUnload() {
      const event = { type: 'beforeunload', defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
      for (const listener of windowListeners.get('beforeunload') ?? []) listener(event);
      return event.defaultPrevented;
    },
    type,
    typeDetails: (field, value) => type('lot-form', field, value),
    // A submit that does not wait: the test decides when the save is allowed to finish.
    startSubmit(form, submitter) { return $(form).emit('submit', submitter ? { submitter } : {}); },
    async submit(form, submitter) { await this.startSubmit(form, submitter); await settle(); },
    saveDetails() { return this.submit('lot-form'); },
    async click(id) { await $(id).click(); await settle(); },
    // Moves to another route the way a link in the page's nav does: the hash changes, then the
    // window hears of it.
    async navigate(hash) {
      location.hash = hash;
      for (const listener of windowListeners.get('hashchange') ?? []) listener({ type: 'hashchange' });
      await settle();
    },
    // Opens a coin from the list by its title, as the collector does.
    async openCoin(title) {
      const row = $('lot-list').children.find((item) => item.textContent.includes(title));
      if (!row) throw new Error(`No coin titled ${title} in the list.`);
      await row.click();
      await settle();
    },
  };
}
