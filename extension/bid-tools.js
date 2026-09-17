import {
  calculateAffordableBid, calculateBidCost, formatMoney, parseMoney, parsePremiumPercent,
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
  const calculated = input.mode === 'budget'
    ? calculateAffordableBid(amount.value, premium.value, options)
    : calculateBidCost(amount.value, premium.value, options);
  return calculated.ok ? { ...calculated, costEstimate, buyerPremiumBps: premium.value } : calculated;
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
  for (const code of ['USD', 'EUR', 'GBP', 'CHF']) {
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
    className: 'bid-calculator-note', textContent: 'The percentage payment fee applies to hammer, premium and shipping. Bid increment is a fixed grid you enter; it does not follow a house schedule. Tax is excluded.',
  });
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
    type: 'button', className: 'secondary', textContent: 'Save house premium',
  });
  editor.append(editorSummary, presetName, save);
  actions.append(use);
  root.append(title, fields, fees, output, note, actions, editor, status);
  container.replaceChildren(root);

  let result = null;
  let preferences = null;
  let destroyed = false;
  let loadedLotId;
  const showError = (message) => {
    status.textContent = message;
    status.dataset.error = 'true';
  };
  const renderPresets = () => {
    const selected = preset.value;
    preset.replaceChildren(el('option', { value: '', textContent: 'Choose house premium' }));
    (preferences?.housePremiumPresets ?? []).forEach((item) => {
      preset.append(el('option', {
        value: presetKey(item.name),
        textContent: `${item.name} — ${(item.buyerPremiumBps / 100).toFixed(2)}%`,
      }));
    });
    if ([...preset.options].some(({ value }) => value === selected)) preset.value = selected;
  };
  const takePreferences = createPreferenceRevisionGate((incoming) => {
    preferences = incoming;
    renderPresets();
  }, () => !destroyed);
  const calculate = () => {
    status.textContent = '';
    status.dataset.error = 'false';
    result = null;
    use.disabled = true;
    const untouched = amount.value.trim() === '' && premium.value.trim() === '';
    const calculated = buildBidCalculation({ mode: mode.value, amountText: amount.value, premiumText: premium.value,
      shippingText: shipping.value, paymentPercentText: paymentPercent.value, paymentFixedText: paymentFixed.value,
      incrementText: increment.value, minimumText: minimum.value, currency: currencyControl.value, locale: language() });
    if (!calculated.ok) {
      output.textContent = 'Enter an amount and buyer premium.';
      if (!untouched) showError(calculated.error.message);
      return;
    }
    const hammer = calculated.value.hammer;
    const locale = language();
    output.textContent = `Hammer ${formatMoney(hammer, locale)} · Premium ${formatMoney(calculated.value.premium, locale)} · Shipping ${formatMoney(calculated.value.shipping, locale)} · Payment fee ${formatMoney(calculated.value.paymentFee, locale)} · Total ${formatMoney(calculated.value.total, locale)}`;
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
    if (preset.value === '') return;
    const item = preferences?.housePremiumPresets?.find((entry) => presetKey(entry.name) === preset.value);
    if (item) {
      premium.value = formatMinorInput(item.buyerPremiumBps, language());
      calculate();
    }
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
        throw new Error(snapshotReply?.message || 'Open Settings once before saving house premiums.');
      }
      takePreferences(snapshotReply.value);
      const reply = await sendCommand({
        type: 'preferences.save',
        requestId: newRequestId(),
        expectedRevision: preferences.revision,
        preferences: {
          housePremiumPresets: [...(preferences.housePremiumPresets ?? []).filter((item) => presetKey(item.name) !== presetKey(name)), { name: name.replace(/\s+/g, ' '), buyerPremiumBps: parsed.value }],
        },
      });
      if (!reply.ok) {
        throw new Error(reply.message || reply.error?.message || 'Could not save the preset.');
      }
      takePreferences({ preferences: reply.value });
      presetName.value = '';
      editor.open = false;
      status.textContent = 'House premium saved.';
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
      showError(reply?.message || 'Could not load house premiums.');
    }
  }).catch((error) => showError(error.message || 'Could not load house premiums.'));
  let unsubscribe = () => {};
  try { unsubscribe = subscribeToSnapshots(takePreferences); } catch { /* standalone calculator has no extension storage */ }
  return {
    setValues(values = {}) {
      const inputs = calculatorInputsForLot(values, { loadedLotId, mode: mode.value, locale: language() });
      if (!inputs) return;
      loadedLotId = values.lotId;
      if (inputs.currency) currencyControl.value = inputs.currency;
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
