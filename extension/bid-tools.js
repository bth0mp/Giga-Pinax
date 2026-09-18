import {
  CURRENCIES, MAX_INCREMENT_TIERS, calculateAffordableBid, calculateBidCost, formatMoney,
  nextBidOnLadder, parseMoney, parsePremiumPercent, validateIncrementLadder,
} from './core/money.js';
import { getSnapshot, newRequestId, sendCommand, subscribeToSnapshots } from './browser-api.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const language = () => globalThis.navigator?.language ?? 'en-US';
const presetKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function formatMinorInput(minor, locale = 'en-US') {
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1)
    .find(({ type }) => type === 'decimal')?.value ?? '.';
  return `${Math.floor(minor / 100)}${decimal}${String(minor % 100).padStart(2, '0')}`;
}

const LADDER_FORMAT = 'write each tier as the amount it starts at, a colon, and the step from there.';

// One tier per line, `from: step`, in the auction house's own currency. A colon is the separator
// because every other candidate — comma, point, space, apostrophe — is already a digit separator
// somewhere the money parser has to accept.
export function parseIncrementLadder(text, currency) {
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
    const from = parseMoney(parts[0], currency);
    const step = parseMoney(parts[1], currency);
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

// The house preset behind one row of the presets editor. It names the field its error belongs to so
// the page can show the message beside that field rather than in a page-wide status line.
export function presetFromFields({ name, premiumText, ladderText, ladderCurrency } = {}, { locale = 'en-US' } = {}) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { ok: false, error: { code: 'missing-name', message: 'Enter an auction house name.', field: 'name' } };
  const premium = parsePremiumPercent(premiumText, locale);
  if (!premium.ok) return { ok: false, error: { ...premium.error, field: 'premium' } };
  const ladder = parseIncrementLadder(ladderText, ladderCurrency);
  if (!ladder.ok) return { ok: false, error: { field: 'ladder', ...ladder.error } };
  const preset = { name: trimmed, buyerPremiumBps: premium.value };
  if (ladder.value) preset.incrementLadder = ladder.value;
  return { ok: true, value: preset };
}

// A house's schedule is written in that house's own money. Applied under another currency the tiers
// would be a schedule no house published, so the fixed increment stands in and the page says why.
export function ladderForCurrency(ladder, currency) {
  if (!Array.isArray(ladder?.tiers) || ladder.tiers.length === 0) return { tiers: null, notice: '' };
  if (ladder.currency === currency) return { tiers: ladder.tiers, notice: '' };
  return {
    tiers: null,
    notice: `This house’s increments are in ${ladder.currency}; the calculator is set to ${currency}, so the fixed increment is used.`,
  };
}

// The calculator's own preset editor knows about the premium and nothing else, so it replaces that
// one field and leaves the rest of the house's preset — its ladder — as Settings wrote it.
export function presetsWithPremium(presets, name, buyerPremiumBps) {
  const key = presetKey(name);
  const existing = (presets ?? []).find((item) => presetKey(item.name) === key);
  return [
    ...(presets ?? []).filter((item) => presetKey(item.name) !== key),
    { ...existing, name: String(name).trim().replace(/\s+/g, ' '), buyerPremiumBps },
  ];
}

export function buildBidCalculation(input) {
  const optionalMoney = (text, defaultMinor) => typeof text === 'string' && text.trim()
    ? parseMoney(text, input.currency, input.locale)
    : { ok: true, value: { currency: input.currency, minor: defaultMinor } };
  const amount = parseMoney(input.amountText, input.currency, input.locale);
  const premium = parsePremiumPercent(input.premiumText, input.locale);
  const shipping = optionalMoney(input.shippingText, 0);
  const paymentPercent = typeof input.paymentPercentText === 'string' && input.paymentPercentText.trim()
    ? parsePremiumPercent(input.paymentPercentText, input.locale) : { ok: true, value: 0 };
  const paymentFixed = optionalMoney(input.paymentFixedText, 0);
  const increment = optionalMoney(input.incrementText, 1);
  const minimum = optionalMoney(input.minimumText, 0);
  const failed = [amount, premium, shipping, paymentPercent, paymentFixed, increment, minimum].find((entry) => !entry.ok);
  if (failed) return failed;
  if (increment.value.minor <= 0) return { ok: false, error: { code: 'invalid-increment', message: 'Enter an increment greater than zero.' } };
  const costEstimate = {
    currency: input.currency, shippingMinor: shipping.value.minor, paymentFeeBps: paymentPercent.value,
    paymentFeeMinor: paymentFixed.value.minor, incrementMinor: increment.value.minor, minimumBidMinor: minimum.value.minor,
  };
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
    label('Shipping', shipping).node, label('Payment fee %', paymentPercent).node,
    label('Fixed payment fee', paymentFixed).node, label('Bid increment', increment).node,
    label('Minimum bid', minimum).node);
  fees.append(el('summary', { textContent: 'Fees and bid increments' }), feeFields);
  const output = el('p', {
    className: 'bid-calculator-output', textContent: 'Enter an amount and buyer premium.',
  });
  const note = el('p', {
    className: 'bid-calculator-note', textContent: 'The percentage payment fee applies to hammer, premium and shipping. Bid increment is a fixed grid you enter; a house preset can carry the tiered ladder you copied from that house’s own terms, and that ladder wins while it is selected and this calculator is set to the currency its tiers are written in. Tax is excluded.',
  });
  const ladderNote = el('p', { className: 'bid-calculator-ladder', hidden: true });
  const status = el('p', {
    className: 'bid-calculator-status', role: 'status', ariaLive: 'polite',
  });
  const actions = el('div', { className: 'bid-calculator-actions' });
  const use = el('button', {
    type: 'button', textContent: 'Use in bid', disabled: true, hidden: typeof onUseHammer !== 'function',
  });
  const editor = el('details', { className: 'bid-preset-editor' });
  const editorSummary = el('summary', { textContent: 'Save this premium for a house' });
  const presetName = el('input', {
    type: 'text', maxLength: 120, placeholder: 'Auction house name',
  });
  const save = el('button', {
    type: 'button', className: 'secondary', textContent: 'Save house preset',
  });
  editor.append(editorSummary, presetName, save);
  actions.append(use);
  root.append(title, fields, fees, output, ladderNote, note, actions, editor, status);
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
      preset.append(el('option', {
        value: presetKey(item.name),
        textContent: `${item.name} — ${(item.buyerPremiumBps / 100).toFixed(2)}%${tiers}`,
      }));
    });
    if ([...preset.options].some(({ value }) => value === selected)) preset.value = selected;
  };
  // The fixed increment field stays editable while a ladder is in use — it is still what a lot's
  // saved cost estimate carries — so the note says which of the two the bid is standing on.
  const renderLadder = () => {
    ladderNote.hidden = !ladder;
    if (!ladder) return;
    const applied = ladderForCurrency(ladder.record, currencyControl.value);
    const count = ladder.record.tiers.length;
    ladderNote.textContent = applied.notice
      || `${ladder.name}: ${count} increment ${count === 1 ? 'tier' : 'tiers'} you entered in Settings. Bids follow those tiers, not the fixed increment.`;
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
      currency: currencyControl.value, locale: language() });
    if (!calculated.ok) {
      output.textContent = 'Enter an amount and buyer premium.';
      if (!untouched) showError(calculated.error.message);
      return;
    }
    const hammer = calculated.value.hammer;
    const locale = language();
    const next = calculated.nextValidBid.minor === hammer.minor
      ? '' : ` · Next valid bid ${formatMoney(calculated.nextValidBid, locale)}`;
    output.textContent = `Hammer ${formatMoney(hammer, locale)} · Premium ${formatMoney(calculated.value.premium, locale)} · Shipping ${formatMoney(calculated.value.shipping, locale)} · Payment fee ${formatMoney(calculated.value.paymentFee, locale)} · Total ${formatMoney(calculated.value.total, locale)}${next}`;
    result = { hammer, buyerPremiumBps: calculated.buyerPremiumBps, costEstimate: calculated.costEstimate, total: calculated.value.total };
    use.disabled = false;
  };
  mode.addEventListener('change', () => {
    amountField.caption.textContent = mode.value === 'budget' ? 'Total budget' : 'Hammer price';
    calculate();
  });
  for (const control of [currencyControl, amount, premium, shipping, paymentPercent, paymentFixed, increment, minimum]) {
    control.addEventListener('input', calculate);
  }
  preset.addEventListener('change', () => {
    const item = selectedPreset();
    if (preset.value !== '' && !item) return;
    selectLadder();
    if (item) premium.value = formatMinorInput(item.buyerPremiumBps, language());
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
    presetSavePending = true;
    save.disabled = true;
    try {
      const snapshotReply = await getSnapshot();
      if (!snapshotReply?.ok || !snapshotReply.value?.preferences) {
        throw new Error(snapshotReply?.message || 'Open Settings once before saving house presets.');
      }
      takePreferences(snapshotReply.value);
      const reply = await sendCommand({
        type: 'preferences.save',
        requestId: newRequestId(),
        expectedRevision: preferences.revision,
        preferences: {
          housePremiumPresets: presetsWithPremium(preferences.housePremiumPresets, name, parsed.value),
        },
      });
      if (!reply.ok) {
        throw new Error(reply.message || reply.error?.message || 'Could not save the preset.');
      }
      takePreferences({ preferences: reply.value });
      presetName.value = '';
      editor.open = false;
      status.textContent = 'House preset saved.';
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
        [paymentFixed, 'paymentFixed'], [increment, 'increment'], [minimum, 'minimum']]) {
        control.value = inputs[key];
      }
      calculate();
    },
    destroy() {
      destroyed = true;
      unsubscribe?.();
      container.replaceChildren();
    },
  };
}
