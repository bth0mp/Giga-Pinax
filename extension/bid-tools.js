import {
  CURRENCIES, MAX_INCREMENT_TIERS, calculateAffordableBid, calculateBidCost, formatMoney,
  nextBidOnLadder, parseMoney, parsePercent, parsePremiumPercent, validateIncrementLadder,
} from './core/money.js';
import { housePresetResult } from './core/fields.js';
import { getSnapshot, newRequestId, sendCommand, subscribeToSnapshots } from './browser-api.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const language = () => globalThis.navigator?.language ?? 'en-US';
const presetKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

// A saved amount written back into a field the collector saves again, so it is written the one way
// the money parser reads in every locale: ASCII digits, a point and no grouping. A locale's own
// digits or decimal mark (ar-EG writes ٫, bn-BD its own digits) could not be read back at all. The
// locale is accepted for call-site symmetry with the parser, which does not depend on it either.
export function formatMinorInput(minor, locale = 'en-US') {
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

const LADDER_FORMAT = 'write each tier as the amount it starts at, a colon, and the step from there.';

// One tier per line, `from: step`, in the auction house's own currency. A colon is the separator
// because every other candidate — comma, point, space, apostrophe — is already a digit separator
// somewhere the money parser has to accept. A lone `1,000` is read in the collector's locale, as
// every other amount the collector types is.
export function parseIncrementLadder(text, currency, locale = 'en-US') {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) return { ok: true, value: null };
  if (!CURRENCIES.includes(currency)) {
    return { ok: false, error: { code: 'unsupported-currency', message: 'Choose the currency this house’s increments are written in.', field: 'ladderCurrency' } };
  }
  if (lines.length > MAX_INCREMENT_TIERS) {
    return { ok: false, error: { code: 'invalid-ladder', message: `An increment ladder holds at most ${MAX_INCREMENT_TIERS} tiers.` } };
  }
  const tiers = [];
  for (const [index, line] of lines.entries()) {
    const fail = (message) => ({ ok: false, error: { code: 'invalid-ladder', message: `Line ${index + 1}: ${message}` } });
    const parts = line.split(':');
    if (parts.length !== 2) return fail(LADDER_FORMAT);
    const from = parseMoney(parts[0], currency, locale);
    const step = parseMoney(parts[1], currency, locale);
    if (!from.ok) return fail(from.error.message);
    if (!step.ok) return fail(step.error.message);
    tiers.push({ from: from.value.minor, step: step.value.minor });
  }
  const ladder = { currency, tiers };
  const valid = validateIncrementLadder(ladder);
  if (valid.ok) return { ok: true, value: ladder };
  return { ok: false, error: { code: valid.error.code, message: `Line ${(valid.error.tier ?? 0) + 1}: ${valid.error.message}` } };
}

// Tiers are written with a point and no grouping whatever the collector's locale is: the money
// parser accepts that everywhere, while a locale's own decimal mark it may refuse outright — ar-EG
// writes ٫ — so a localized ladder could not be read back at all.
export function formatIncrementLadder(tiers) {
  if (!Array.isArray(tiers)) return '';
  const plain = (minor) => (Number.isSafeInteger(minor) && minor >= 0
    ? `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
    : '');
  return tiers.map((tier) => `${plain(tier.from)}: ${plain(tier.step)}`).join('\n');
}

// The two house charges a buyer's premium does not cover, by the key a cost estimate and a house
// preset store them under, the field they are typed in and the name their errors use.
const HOUSE_CHARGES = Object.freeze([
  { key: 'premiumVatBps', field: 'premiumVat', subject: 'VAT on premium' },
  { key: 'platformFeeBps', field: 'platformFee', subject: 'Platform fee on hammer' },
]);

// An optional percentage: blank is none at all (null), anything else must read as one.
const optionalPercent = (text, locale, subject) => (typeof text === 'string' && text.trim()
  ? parsePercent(text, locale, subject) : { ok: true, value: null });

// The fee sheet a lot's cost is worked out with, the one set of fields the calculator, the workspace's Bid tab and its
// Outcome tab all show, in this order. Each names the key a cost estimate stores it under; VAT on the premium and a
// platform fee are written only when typed, so an estimate without them keeps the shape earlier versions saved.
export const FEE_SHEET_FIELDS = Object.freeze([
  { name: 'premiumVat', label: 'VAT on premium %', key: 'premiumVatBps', kind: 'percent', subject: 'VAT on premium', optional: true },
  { name: 'platformFee', label: 'Platform fee % on hammer', key: 'platformFeeBps', kind: 'percent', subject: 'Platform fee on hammer', optional: true },
  { name: 'importVat', label: 'Import VAT / duty %', key: 'importVatBps', kind: 'percent', subject: 'Import VAT', optional: true },
  { name: 'shipping', label: 'Shipping', key: 'shippingMinor', kind: 'money' },
  { name: 'paymentPercent', label: 'Payment fee %', key: 'paymentFeeBps', kind: 'percent', subject: 'Payment fee' },
  { name: 'paymentFixed', label: 'Fixed payment fee', key: 'paymentFeeMinor', kind: 'money' },
]);

// The collector's preset for a house, by the house's name as a lot records it: the same name, case and spacing set
// aside, and nothing else - a name that merely looks alike proposes no terms.
export function housePresetFor(presets, houseName) {
  const key = presetKey(houseName);
  return key ? (presets ?? []).find((item) => presetKey(item?.name) === key) ?? null : null;
}

// A fee sheet read from its fields, in the currency of the amount it goes with. Every field blank is no fee sheet at
// all (null): the fees were not recorded, which is not the same as fees of nothing. Once one fee is typed, a blank one
// is none. An error names the field it belongs to.
export function feeSheetEstimate(texts = {}, { currency, locale = 'en-US', incrementMinor = 1, minimumBidMinor = 0 } = {}) {
  if (FEE_SHEET_FIELDS.every(({ name }) => !String(texts[name] ?? '').trim())) return { ok: true, value: null };
  const estimate = { currency, shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor, minimumBidMinor };
  for (const { name, key, kind, subject, optional } of FEE_SHEET_FIELDS) {
    const text = String(texts[name] ?? '');
    if (kind === 'money') {
      if (!text.trim()) continue;
      const parsed = parseMoney(text, currency, locale);
      if (!parsed.ok) return { ok: false, error: { ...parsed.error, field: name } };
      estimate[key] = parsed.value.minor;
    } else {
      const parsed = optionalPercent(text, locale, subject);
      if (!parsed.ok) return { ok: false, error: { ...parsed.error, field: name } };
      if (parsed.value !== null) estimate[key] = parsed.value;
      else if (!optional) estimate[key] = 0;
    }
  }
  return { ok: true, value: estimate };
}

// A saved fee sheet written back into its fields; a key the estimate does not hold leaves its field blank.
export function feeSheetTexts(estimate) {
  return Object.fromEntries(FEE_SHEET_FIELDS.map(({ name, key }) => [name, formatMinorInput(estimate?.[key])]));
}

// The house preset behind one row of the presets editor. It names the field its error belongs to so
// the page can show the message beside that field rather than in a page-wide status line. VAT on the
// premium and a platform fee are written only when typed, so a row without them saves the shape an
// older preset has.
export function presetFromFields({ name, premiumText, premiumVatText, platformFeeText, ladderText, ladderCurrency } = {}, { locale = 'en-US' } = {}) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { ok: false, error: { code: 'missing-name', message: 'Enter an auction house name.', field: 'name' } };
  const premium = parsePremiumPercent(premiumText, locale);
  if (!premium.ok) return { ok: false, error: { ...premium.error, field: 'premium' } };
  const preset = { name: trimmed, buyerPremiumBps: premium.value };
  const texts = { premiumVat: premiumVatText, platformFee: platformFeeText };
  for (const { key, field, subject } of HOUSE_CHARGES) {
    const charge = optionalPercent(texts[field], locale, subject);
    if (!charge.ok) return { ok: false, error: { ...charge.error, field } };
    if (charge.value !== null) preset[key] = charge.value;
  }
  const ladder = parseIncrementLadder(ladderText, ladderCurrency, locale);
  if (!ladder.ok) return { ok: false, error: { field: 'ladder', ...ladder.error } };
  if (ladder.value) preset.incrementLadder = ladder.value;
  return { ok: true, value: preset };
}

// A house's schedule is written in that house's own money. Applied under another currency the tiers
// would be a schedule no house published, so the fixed increment stands in and the page says why.
function ladderForCurrency(ladder, currency) {
  if (!Array.isArray(ladder?.tiers) || ladder.tiers.length === 0) return { tiers: null, notice: '' };
  if (ladder.currency === currency) return { tiers: ladder.tiers, notice: '' };
  return {
    tiers: null,
    notice: `This house’s increments are in ${ladder.currency}; the calculator is set to ${currency}, so the fixed increment is used.`,
  };
}

// House presets as text a collector can hand to another browser or another collector: readable JSON
// that says what it is. Only the keys a preset holds are written.
const PRESETS_FORMAT = 'giga-pinax-house-presets';
const PRESET_KEYS = ['name', 'buyerPremiumBps', 'premiumVatBps', 'platformFeeBps', 'incrementLadder'];
const MAX_PRESETS = 50;
const MAX_PRESETS_TEXT = 200000;
const presetCopy = (preset) => Object.fromEntries(PRESET_KEYS
  .filter((key) => Object.hasOwn(preset, key))
  .map((key) => [key, key === 'incrementLadder'
    ? { currency: preset.incrementLadder.currency, tiers: preset.incrementLadder.tiers.map(({ from, step }) => ({ from, step })) }
    : preset[key]]));

export function housePresetsText(presets) {
  return JSON.stringify({ format: PRESETS_FORMAT, version: 1, presets: (presets ?? []).map(presetCopy) }, null, 2);
}

const PRESET_FIELD_NAMES = {
  name: 'name', buyerPremiumBps: 'premium', premiumVatBps: 'VAT on premium',
  platformFeeBps: 'platform fee', incrementLadder: 'increment tiers',
};

// Text pasted into Settings, read as house presets or refused whole: each preset is held to the rule
// a saved one is, and anything else it carries is left behind. Also takes the bare presets list of a
// backup's preferences.
export function parseHousePresets(text) {
  const refuse = (message) => ({ ok: false, error: { code: 'invalid-presets', message } });
  const source = String(text ?? '');
  if (source.length > MAX_PRESETS_TEXT) return refuse('The pasted text is too long to be house presets.');
  let value;
  try { value = JSON.parse(source); } catch { value = undefined; }
  const presets = Array.isArray(value) ? value : value?.format === PRESETS_FORMAT ? value.presets : undefined;
  if (!Array.isArray(presets)) return refuse('The pasted text is not house presets copied from Giga Pinax.');
  if (presets.length === 0) return refuse('The pasted text holds no house presets.');
  if (presets.length > MAX_PRESETS) return refuse(`The pasted text holds ${presets.length} houses; Settings keeps at most ${MAX_PRESETS}.`);
  const names = new Map();
  const result = [];
  for (const [index, preset] of presets.entries()) {
    const valid = housePresetResult(preset, 'preset');
    if (!valid.ok) {
      const name = typeof preset?.name === 'string' && preset.name.trim() ? ` (${preset.name.trim().slice(0, 120)})` : '';
      const key = String(valid.error.path ?? '').split(/[.[]/)[1];
      const field = PRESET_FIELD_NAMES[key] ?? 'entry';
      return refuse(`House ${index + 1}${name}: its ${field} cannot be read. ${valid.error.message}`);
    }
    const key = presetKey(preset.name);
    if (names.has(key)) return refuse(`The pasted text names ${names.get(key)} twice.`);
    names.set(key, preset.name.trim());
    result.push(presetCopy(preset));
  }
  return { ok: true, value: result };
}

// An amount on a house's schedule, in whole units when it is a whole amount, as schedules are printed.
function tierMoney(minor, currency, locale) {
  if (minor % 100 !== 0) return formatMoney({ currency, minor }, locale);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
    .format(BigInt(minor) / 100n);
}

// The tier of a house's ladder a bid stands on, and its step: "on the €1,000–€2,000 tier, steps of
// €100". The top tier has no end. Nothing when there is no ladder or no bid to place on it.
export function ladderTierText(tiers, minor, currency, locale = 'en-US') {
  if (!Array.isArray(tiers) || tiers.length === 0 || !Number.isSafeInteger(minor) || minor < 0) return '';
  let index = 0;
  while (index + 1 < tiers.length && tiers[index + 1].from <= minor) index += 1;
  const { from, step } = tiers[index];
  const money = (value) => tierMoney(value, currency, locale);
  const next = tiers[index + 1];
  const range = next ? `the ${money(from)}–${money(next.from)} tier` : `the tier from ${money(from)}`;
  return `on ${range}, steps of ${money(step)}`;
}

// The calculator's own preset editor knows the premium, the VAT on it and the platform fee: a charge
// given as a number is written, one given as null (its field left blank) is taken off the preset, and
// one not given at all is left as it was. The rest of the house's preset — its ladder — stays as
// Settings wrote it.
export function presetsWithPremium(presets, name, buyerPremiumBps, charges = {}) {
  const key = presetKey(name);
  const existing = (presets ?? []).find((item) => presetKey(item.name) === key);
  const preset = { ...existing, name: String(name).trim().replace(/\s+/g, ' '), buyerPremiumBps };
  for (const { key: chargeKey } of HOUSE_CHARGES) {
    if (Number.isSafeInteger(charges[chargeKey])) preset[chargeKey] = charges[chargeKey];
    else if (Object.hasOwn(charges, chargeKey) && charges[chargeKey] === null) delete preset[chargeKey];
  }
  return [...(presets ?? []).filter((item) => presetKey(item.name) !== key), preset];
}

// What a save from the calculator wrote, in words: every term of the house as it now stands.
function savedPresetText(preset) {
  const percent = (bps) => `${(bps / 100).toFixed(2)}%`;
  const vat = Number.isSafeInteger(preset.premiumVatBps) ? `VAT on premium ${percent(preset.premiumVatBps)}` : 'no VAT on premium';
  const platform = Number.isSafeInteger(preset.platformFeeBps) ? `platform fee ${percent(preset.platformFeeBps)}` : 'no platform fee';
  const ladder = preset.incrementLadder ? ' Its increment ladder is unchanged.' : '';
  return `Saved ${preset.name}: premium ${percent(preset.buyerPremiumBps)}, ${vat}, ${platform}.${ladder}`;
}

export function buildBidCalculation(input) {
  const optionalMoney = (text, defaultMinor) => typeof text === 'string' && text.trim()
    ? parseMoney(text, input.currency, input.locale)
    : { ok: true, value: { currency: input.currency, minor: defaultMinor } };
  const amount = parseMoney(input.amountText, input.currency, input.locale);
  const premium = parsePremiumPercent(input.premiumText, input.locale);
  const shipping = optionalMoney(input.shippingText, 0);
  const paymentPercent = optionalPercent(input.paymentPercentText, input.locale, 'Payment fee');
  const paymentFixed = optionalMoney(input.paymentFixedText, 0);
  const increment = optionalMoney(input.incrementText, 1);
  const minimum = optionalMoney(input.minimumText, 0);
  const premiumVat = optionalPercent(input.premiumVatText, input.locale, 'VAT on premium');
  const platformFee = optionalPercent(input.platformFeeText, input.locale, 'Platform fee on hammer');
  const importVat = optionalPercent(input.importVatText, input.locale, 'Import VAT');
  const failed = [amount, premium, shipping, paymentPercent, paymentFixed, increment, minimum, premiumVat, platformFee, importVat]
    .find((entry) => !entry.ok);
  if (failed) return failed;
  if (increment.value.minor <= 0) return { ok: false, error: { code: 'invalid-increment', message: 'Enter an increment greater than zero.' } };
  const costEstimate = {
    currency: input.currency, shippingMinor: shipping.value.minor, paymentFeeBps: paymentPercent.value ?? 0,
    paymentFeeMinor: paymentFixed.value.minor, incrementMinor: increment.value.minor, minimumBidMinor: minimum.value.minor,
  };
  // Written only when typed, so an estimate without them keeps the shape earlier versions saved.
  if (premiumVat.value !== null) costEstimate.premiumVatBps = premiumVat.value;
  if (platformFee.value !== null) costEstimate.platformFeeBps = platformFee.value;
  if (importVat.value !== null) costEstimate.importVatBps = importVat.value;
  const options = { ...costEstimate };
  delete options.currency;
  // A house ladder belongs to the house, not to this lot, so it drives the calculation without
  // joining the cost estimate the lot is saved with.
  const ladder = ladderForCurrency(input.ladder, input.currency);
  if (ladder.tiers) options.ladder = ladder.tiers;
  const calculated = input.mode === 'budget'
    ? calculateAffordableBid(amount.value, premium.value, options)
    : calculateBidCost(amount.value, premium.value, options);
  if (!calculated.ok) return calculated;
  // The grid the collector is bidding on: the house ladder, or the fixed increment anchored at the
  // minimum bid. A hammer that is off it — or below where bidding starts — is answered with the
  // next bid the auctioneer would take.
  const grid = ladder.tiers ?? [{ from: minimum.value.minor, step: increment.value.minor }];
  const next = nextBidOnLadder(grid, Math.max(calculated.value.hammer.minor, minimum.value.minor));
  return {
    ...calculated,
    costEstimate,
    buyerPremiumBps: premium.value,
    ladderNotice: ladder.notice,
    nextValidBid: next.ok ? { currency: input.currency, minor: next.value } : calculated.value.hammer,
  };
}

export function snapshotSupersedes(incoming, accepted) {
  const incomingRevision = Number.isInteger(incoming?.revision) ? incoming.revision : null;
  const acceptedRevision = Number.isInteger(accepted?.revision) ? accepted.revision : null;
  if (incomingRevision !== null && acceptedRevision !== null && incomingRevision !== acceptedRevision) {
    return incomingRevision > acceptedRevision;
  }
  const incomingTime = Date.parse(incoming?.updatedAt ?? '');
  const acceptedTime = Date.parse(accepted?.updatedAt ?? '');
  return Number.isFinite(incomingTime) && Number.isFinite(acceptedTime) && incomingTime > acceptedTime;
}

export function createPreferenceRevisionGate(apply, isActive = () => true) {
  let latestRevision = -1;
  let latestSnapshot = null;
  return (snapshot) => {
    const incoming = snapshot?.preferences;
    if (!isActive() || !incoming || !Number.isInteger(incoming.revision)) return false;
    // A reply still in flight when a newer snapshot arrived is stale whatever preferences revision
    // it carries: after a replace import that revision can be higher than the current one.
    if (snapshotSupersedes(latestSnapshot, snapshot)) return false;
    // A replace import restarts the preferences revision, so a lower one is still current when the
    // snapshot that carries it is itself newer than the last one this gate accepted.
    if (incoming.revision <= latestRevision && !snapshotSupersedes(snapshot, latestSnapshot)) return false;
    latestRevision = incoming.revision;
    latestSnapshot = { revision: snapshot.revision, updatedAt: snapshot.updatedAt };
    apply(incoming);
    return true;
  };
}

export function calculatorInputsForLot(values = {}, { loadedLotId, mode = 'total', locale = 'en-US' } = {}) {
  if (values.lotId !== undefined && values.lotId === loadedLotId) return null;
  const estimate = values.costEstimate ?? {};
  const inputs = {
    currency: values.currency ?? null,
    premium: formatMinorInput(values.buyerPremiumBps, locale),
    shipping: formatMinorInput(estimate.shippingMinor, locale),
    paymentPercent: formatMinorInput(estimate.paymentFeeBps, locale),
    paymentFixed: formatMinorInput(estimate.paymentFeeMinor, locale),
    increment: formatMinorInput(estimate.incrementMinor, locale),
    minimum: formatMinorInput(estimate.minimumBidMinor, locale),
    premiumVat: formatMinorInput(estimate.premiumVatBps, locale),
    platformFee: formatMinorInput(estimate.platformFeeBps, locale),
    importVat: formatMinorInput(estimate.importVatBps, locale),
    // A house's tiers belong to that house, not to whichever lot is on screen: leaving them
    // selected would compute this lot's premium and minimum on the last house's schedule. The lot's
    // own saved increment applies until the collector picks a house again.
    preset: '',
    ladder: null,
  };
  // A saved hammer is not a budget: writing it into the budget field would answer a question the
  // collector did not ask.
  if (mode !== 'budget') inputs.amount = formatMinorInput(values.hammerMinor, locale);
  return inputs;
}

export function mountBidCalculator(
  container,
  { currency = 'USD', onUseHammer = null, compact = false } = {},
) {
  if (!container?.replaceChildren) throw new TypeError('Calculator container is required.');
  const root = el('section', { className: `bid-calculator${compact ? ' compact' : ''}` });
  const title = el('h3', { textContent: 'Bid calculator' });
  const mode = el('select');
  mode.append(
    el('option', { value: 'total', textContent: 'Total cost from hammer' }),
    el('option', { value: 'budget', textContent: 'Maximum hammer from budget' }),
  );
  const currencyControl = el('select');
  for (const code of CURRENCIES) {
    currencyControl.append(el('option', { value: code, textContent: code }));
  }
  currencyControl.value = currency;
  const amount = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00' });
  const premium = el('input', { type: 'text', inputMode: 'decimal', placeholder: 'Unknown' });
  const shipping = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00' });
  const paymentPercent = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0' });
  const paymentFixed = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00' });
  const increment = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.01' });
  const minimum = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00' });
  const premiumVat = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0' });
  const platformFee = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0' });
  const importVat = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0' });
  const preset = el('select');
  const fields = el('div', { className: 'bid-calculator-fields' });
  const label = (text, control) => {
    const node = el('label');
    const caption = el('span', { textContent: text });
    node.append(caption, control);
    return { node, caption };
  };
  const modeField = label('Calculation', mode);
  const currencyField = label('Currency', currencyControl);
  const amountField = label('Hammer price', amount);
  const premiumField = label('Buyer premium %', premium);
  const presetField = label('House preset', preset);
  fields.append(
    modeField.node, currencyField.node, amountField.node, premiumField.node, presetField.node,
  );
  const fees = el('details', { className: 'bid-calculator-fees' });
  const feeFields = el('div', { className: 'bid-fees-fields' });
  feeFields.append(
    label('VAT on premium %', premiumVat).node, label('Platform fee % on hammer', platformFee).node,
    label('Import VAT / duty %', importVat).node, label('Shipping', shipping).node, label('Payment fee %', paymentPercent).node,
    label('Fixed payment fee', paymentFixed).node, label('Bid increment', increment).node,
    label('Minimum bid', minimum).node);
  fees.append(el('summary', { textContent: 'Fees and bid increments' }), feeFields);
  const output = el('p', {
    className: 'bid-calculator-output', textContent: 'Enter an amount and buyer premium.',
  });
  const note = el('p', {
    className: 'bid-calculator-note', textContent: 'VAT on premium is charged on the premium alone and a platform fee on the hammer alone, as houses and live-bidding platforms charge them; the percentage payment fee applies to everything else the invoice carries, shipping included. Import VAT or duty, when the coin crosses a border, is charged on hammer, premium and shipping and paid to the carrier or customs, so no payment fee is added to it; Settings can start it at your usual rate for a house in another currency than your default. Bid increment is a fixed grid you enter; a house preset can carry the tiered ladder you copied from that house’s own terms, and that ladder wins while it is selected and this calculator is set to the currency its tiers are written in. VAT on the hammer is excluded, and nothing is estimated where a field is blank.',
  });
  // The explanation folds under its own summary, so the figures above it lead.
  const about = el('details', { className: 'bid-calculator-about' });
  about.append(el('summary', { textContent: 'How the total is counted' }), note);
  const ladderNote = el('p', { className: 'bid-calculator-ladder', hidden: true });
  const status = el('p', {
    className: 'bid-calculator-status', role: 'status', ariaLive: 'polite',
  });
  const actions = el('div', { className: 'bid-calculator-actions' });
  const use = el('button', {
    type: 'button', textContent: 'Use in bid', disabled: true, hidden: typeof onUseHammer !== 'function',
  });
  const editor = el('details', { className: 'bid-preset-editor' });
  const editorSummary = el('summary', { textContent: 'Save these terms for a house' });
  const presetName = el('input', {
    type: 'text', maxLength: 120, placeholder: 'Auction house name',
  });
  const save = el('button', {
    type: 'button', className: 'secondary', textContent: 'Save house preset',
  });
  editor.append(editorSummary, presetName, save);
  actions.append(use);
  root.append(title, fields, fees, output, ladderNote, about, actions, editor, status);
  container.replaceChildren(root);

  let result = null;
  let preferences = null;
  let destroyed = false;
  let loadedLotId;
  let ladder = null;
  const showError = (message) => {
    status.textContent = message;
    status.dataset.error = 'true';
  };
  const renderPresets = () => {
    const selected = preset.value;
    preset.replaceChildren(el('option', { value: '', textContent: 'Choose house preset' }));
    (preferences?.housePremiumPresets ?? []).forEach((item) => {
      const count = item.incrementLadder?.tiers?.length ?? 0;
      const tiers = count ? ` · ${count}-tier ${item.incrementLadder.currency} ladder` : '';
      const percent = (bps) => (bps / 100).toFixed(2);
      const vat = Number.isSafeInteger(item.premiumVatBps) ? ` + ${percent(item.premiumVatBps)}% VAT` : '';
      const platform = Number.isSafeInteger(item.platformFeeBps) ? ` · ${percent(item.platformFeeBps)}% platform fee` : '';
      preset.append(el('option', {
        value: presetKey(item.name),
        textContent: `${item.name} — ${percent(item.buyerPremiumBps)}%${vat}${platform}${tiers}`,
      }));
    });
    if ([...preset.options].some(({ value }) => value === selected)) preset.value = selected;
  };
  // The fixed increment field stays editable while a ladder is in use — it is still what a lot's
  // saved cost estimate carries — so the note says which of the two the bid is standing on.
  // With a hammer worked out, the note says which tier the bid stands on: the hammer's own when it is
  // on the ladder, else the next valid bid's, since that is the bid the house would take.
  const renderLadder = (calculated = null) => {
    ladderNote.hidden = !ladder;
    if (!ladder) return;
    const applied = ladderForCurrency(ladder.record, currencyControl.value);
    const count = ladder.record.tiers.length;
    const tiers = `${ladder.name}: ${count} increment ${count === 1 ? 'tier' : 'tiers'} you entered in Settings.`;
    if (applied.notice) {
      ladderNote.textContent = applied.notice;
    } else if (calculated) {
      const locale = language();
      const onGrid = calculated.nextValidBid.minor === calculated.value.hammer.minor;
      const bid = onGrid ? calculated.value.hammer : calculated.nextValidBid;
      ladderNote.textContent = `${tiers} ${onGrid ? 'The hammer' : 'The next valid bid'}, ${formatMoney(bid, locale)}, is ${ladderTierText(applied.tiers, bid.minor, bid.currency, locale)}.`;
    } else {
      ladderNote.textContent = `${tiers} Bids follow those tiers, not the fixed increment.`;
    }
  };
  const selectedPreset = () => (preset.value === ''
    ? null
    : preferences?.housePremiumPresets?.find((entry) => presetKey(entry.name) === preset.value) ?? null);
  const ladderText = (record) => `${record?.currency ?? ''}\n${formatIncrementLadder(record?.tiers ?? null)}`;
  // Tiers edited in Settings reach an open calculator through the same snapshot the premiums do.
  const selectLadder = () => {
    const item = selectedPreset();
    const record = item?.incrementLadder?.tiers?.length ? item.incrementLadder : null;
    const changed = ladderText(record) !== ladderText(ladder?.record);
    ladder = record ? { name: item.name, record } : null;
    renderLadder();
    return changed;
  };
  const takePreferences = createPreferenceRevisionGate((incoming) => {
    preferences = incoming;
    renderPresets();
    offerImportVat();
    if (selectLadder()) calculate();
  }, () => !destroyed);
  const calculate = () => {
    status.textContent = '';
    status.dataset.error = 'false';
    result = null;
    use.disabled = true;
    // The currency control decides whether the house's tiers apply at all, so the note follows it.
    renderLadder();
    const untouched = amount.value.trim() === '' && premium.value.trim() === '';
    const calculated = buildBidCalculation({ mode: mode.value, amountText: amount.value, premiumText: premium.value,
      shippingText: shipping.value, paymentPercentText: paymentPercent.value, paymentFixedText: paymentFixed.value,
      incrementText: increment.value, minimumText: minimum.value, ladder: ladder?.record ?? null,
      premiumVatText: premiumVat.value, platformFeeText: platformFee.value, importVatText: importVat.value,
      currency: currencyControl.value, locale: language() });
    if (!calculated.ok) {
      output.textContent = 'Enter an amount and buyer premium.';
      if (!untouched) showError(calculated.error.message);
      return;
    }
    const hammer = calculated.value.hammer;
    const locale = language();
    renderLadder(calculated);
    const next = calculated.nextValidBid.minor === hammer.minor
      ? '' : ` · Next valid bid ${formatMoney(calculated.nextValidBid, locale)}`;
    // VAT and a platform fee are named only when entered, so a house without them reads as before.
    const estimate = calculated.costEstimate;
    const vat = Object.hasOwn(estimate, 'premiumVatBps') ? ` + VAT ${formatMoney(calculated.value.premiumVat, locale)}` : '';
    const platform = Object.hasOwn(estimate, 'platformFeeBps') ? ` · Platform fee ${formatMoney(calculated.value.platformFee, locale)}` : '';
    const imported = Object.hasOwn(estimate, 'importVatBps') ? ` · Import VAT ${formatMoney(calculated.value.importVat, locale)}` : '';
    output.textContent = `Hammer ${formatMoney(hammer, locale)} · Premium ${formatMoney(calculated.value.premium, locale)}${vat}${platform}${imported} · Shipping ${formatMoney(calculated.value.shipping, locale)} · Payment fee ${formatMoney(calculated.value.paymentFee, locale)} · Total ${formatMoney(calculated.value.total, locale)}${next}`;
    result = { hammer, buyerPremiumBps: calculated.buyerPremiumBps, costEstimate: calculated.costEstimate, total: calculated.value.total };
    use.disabled = false;
  };
  mode.addEventListener('change', () => {
    amountField.caption.textContent = mode.value === 'budget' ? 'Total budget' : 'Hammer price';
    calculate();
  });
  for (const control of [currencyControl, amount, premium, shipping, paymentPercent, paymentFixed, increment, minimum, premiumVat, platformFee, importVat]) {
    control.addEventListener('input', calculate);
  }
  // Settings' usual import VAT starts the field for a house in another currency than the collector's default, and
  // leaves it again for one in the default; a rate the collector typed or cleared is theirs and is never replaced.
  let importVatOffered = null;
  const offerImportVat = () => {
    if (importVatOffered !== null && importVat.value !== importVatOffered) importVatOffered = null;
    const rate = preferences?.importVatBps;
    const foreign = Number.isSafeInteger(rate) && preferences?.currency && currencyControl.value !== preferences.currency;
    if (foreign && importVat.value.trim() === '') { importVat.value = formatMinorInput(rate); importVatOffered = importVat.value; }
    else if (!foreign && importVatOffered !== null) { importVat.value = ''; importVatOffered = null; }
  };
  importVat.addEventListener('input', () => { importVatOffered = null; });
  currencyControl.addEventListener('input', () => { offerImportVat(); calculate(); });
  preset.addEventListener('change', () => {
    const item = selectedPreset();
    if (preset.value !== '' && !item) return;
    selectLadder();
    // A house's terms are the premium and what it charges on top; a house without VAT or a platform
    // fee clears the one the last house left, which would otherwise count against this one.
    if (item) {
      premium.value = formatMinorInput(item.buyerPremiumBps, language());
      premiumVat.value = formatMinorInput(item.premiumVatBps, language());
      platformFee.value = formatMinorInput(item.platformFeeBps, language());
    }
    calculate();
  });
  use.addEventListener('click', () => {
    if (result && typeof onUseHammer === 'function') {
      onUseHammer({ hammer: result.hammer, buyerPremiumBps: result.buyerPremiumBps, costEstimate: result.costEstimate, total: result.total });
    }
  });
  let presetSavePending = false;
  save.addEventListener('click', async () => {
    if (presetSavePending) return;
    const parsed = parsePremiumPercent(premium.value, language());
    const name = presetName.value.trim();
    if (!parsed.ok || !name) {
      showError(parsed.error?.message || 'Enter an auction house name.');
      return;
    }
    const charges = {};
    for (const [{ key, subject }, control] of [[HOUSE_CHARGES[0], premiumVat], [HOUSE_CHARGES[1], platformFee]]) {
      const charge = optionalPercent(control.value, language(), subject);
      if (!charge.ok) {
        showError(charge.error.message);
        return;
      }
      charges[key] = charge.value;
    }
    presetSavePending = true;
    save.disabled = true;
    try {
      const snapshotReply = await getSnapshot();
      if (!snapshotReply?.ok || !snapshotReply.value?.preferences) {
        throw new Error(snapshotReply?.message || 'Open Settings once before saving house presets.');
      }
      takePreferences(snapshotReply.value);
      // A record without a whole-number revision is one the gate refused: there is nothing to save
      // against, and saying so beats the TypeError reading its revision would throw.
      if (!Number.isInteger(preferences?.revision)) {
        throw new Error('House presets are not ready, so the preset was not saved. Reload the page and try again.');
      }
      const housePremiumPresets = presetsWithPremium(preferences.housePremiumPresets, name, parsed.value, charges);
      const reply = await sendCommand({
        type: 'preferences.save',
        requestId: newRequestId(),
        expectedRevision: preferences.revision,
        preferences: { housePremiumPresets },
      });
      if (!reply.ok) {
        throw new Error(reply.message || reply.error?.message || 'Could not save the preset.');
      }
      takePreferences({ preferences: reply.value });
      presetName.value = '';
      editor.open = false;
      status.textContent = savedPresetText(housePremiumPresets.at(-1));
      status.dataset.error = 'false';
    } catch (error) {
      showError(error.message || 'Could not save the preset.');
    } finally {
      presetSavePending = false;
      save.disabled = false;
    }
  });
  void getSnapshot().then((reply) => {
    if (reply?.ok) {
      takePreferences(reply.value);
    } else {
      showError(reply?.message || 'Could not load house presets.');
    }
  }).catch((error) => showError(error.message || 'Could not load house presets.'));
  let unsubscribe = () => {};
  try { unsubscribe = subscribeToSnapshots(takePreferences); } catch { /* standalone calculator has no extension storage */ }
  return {
    setValues(values = {}) {
      const inputs = calculatorInputsForLot(values, { loadedLotId, mode: mode.value, locale: language() });
      if (!inputs) return;
      loadedLotId = values.lotId;
      if (inputs.currency) currencyControl.value = inputs.currency;
      preset.value = inputs.preset;
      ladder = inputs.ladder;
      if (Object.hasOwn(inputs, 'amount')) amount.value = inputs.amount;
      for (const [control, key] of [[premium, 'premium'], [shipping, 'shipping'], [paymentPercent, 'paymentPercent'],
        [paymentFixed, 'paymentFixed'], [increment, 'increment'], [minimum, 'minimum'],
        [premiumVat, 'premiumVat'], [platformFee, 'platformFee'], [importVat, 'importVat']]) {
        control.value = inputs[key];
      }
      importVatOffered = null;
      offerImportVat();
      calculate();
    },
    destroy() {
      destroyed = true;
      unsubscribe?.();
      container.replaceChildren();
    },
  };
}
