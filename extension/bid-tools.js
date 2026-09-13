import {
  calculateMaximumHammer, calculatePremium, formatMoney, parseMoney, parsePremiumPercent,
} from './core/money.js';
import { getSnapshot, newRequestId, sendCommand } from './browser-api.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const language = () => globalThis.navigator?.language ?? 'en-US';

export function formatMinorInput(minor, locale = 'en-US') {
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1)
    .find(({ type }) => type === 'decimal')?.value ?? '.';
  return `${Math.floor(minor / 100)}${decimal}${String(minor % 100).padStart(2, '0')}`;
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
    el('option', { value: 'total', textContent: 'Hammer plus premium' }),
    el('option', { value: 'budget', textContent: 'Maximum hammer from budget' }),
  );
  const currencyControl = el('select');
  for (const code of ['USD', 'EUR', 'GBP', 'CHF']) {
    currencyControl.append(el('option', { value: code, textContent: code }));
  }
  currencyControl.value = currency;
  const amount = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00' });
  const premium = el('input', { type: 'text', inputMode: 'decimal', placeholder: 'Unknown' });
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
  const output = el('p', {
    className: 'bid-calculator-output', textContent: 'Enter an amount and buyer premium.',
  });
  const note = el('p', {
    className: 'bid-calculator-note', textContent: 'Shipping and tax are excluded.',
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
  root.append(title, fields, output, note, actions, editor, status);
  container.replaceChildren(root);

  let result = null;
  let preferences = null;
  const showError = (message) => {
    status.textContent = message;
    status.dataset.error = 'true';
  };
  const renderPresets = () => {
    const selected = preset.value;
    preset.replaceChildren(el('option', { value: '', textContent: 'Choose house premium' }));
    (preferences?.housePremiumPresets ?? []).forEach((item, index) => {
      preset.append(el('option', {
        value: String(index),
        textContent: `${item.name} — ${(item.buyerPremiumBps / 100).toFixed(2)}%`,
      }));
    });
    if ([...preset.options].some(({ value }) => value === selected)) preset.value = selected;
  };
  const calculate = () => {
    status.textContent = '';
    status.dataset.error = 'false';
    result = null;
    use.disabled = true;
    const untouched = amount.value.trim() === '' && premium.value.trim() === '';
    const money = parseMoney(amount.value, currencyControl.value, language());
    const bps = parsePremiumPercent(premium.value, language());
    if (!money.ok || !bps.ok) {
      output.textContent = 'Enter an amount and buyer premium.';
      if (!untouched) showError(!money.ok ? money.error.message : bps.error.message);
      return;
    }
    const calculated = mode.value === 'budget'
      ? calculateMaximumHammer(money.value, bps.value)
      : calculatePremium(money.value, bps.value);
    if (!calculated.ok) {
      showError(calculated.error.message);
      return;
    }
    const hammer = mode.value === 'budget' ? calculated.value.hammer : money.value;
    const locale = language();
    output.textContent = `Hammer ${formatMoney(hammer, locale)} · Premium ${formatMoney(calculated.value.premium, locale)} · Total ${formatMoney(calculated.value.hammerPlusPremium, locale)}`;
    result = { hammer, buyerPremiumBps: bps.value };
    use.disabled = false;
  };
  mode.addEventListener('change', () => {
    amountField.caption.textContent = mode.value === 'budget' ? 'Total budget' : 'Hammer price';
    calculate();
  });
  for (const control of [currencyControl, amount, premium]) {
    control.addEventListener('input', calculate);
  }
  preset.addEventListener('change', () => {
    if (preset.value === '') return;
    const item = preferences?.housePremiumPresets?.[Number(preset.value)];
    if (item) {
      premium.value = formatMinorInput(item.buyerPremiumBps, language());
      calculate();
    }
  });
  use.addEventListener('click', () => {
    if (result && typeof onUseHammer === 'function') {
      onUseHammer({ hammer: result.hammer, buyerPremiumBps: result.buyerPremiumBps });
    }
  });
  save.addEventListener('click', async () => {
    const parsed = parsePremiumPercent(premium.value, language());
    const name = presetName.value.trim();
    if (!parsed.ok || !name) {
      showError(parsed.error?.message || 'Enter an auction house name.');
      return;
    }
    try {
      const snapshotReply = await getSnapshot();
      if (!snapshotReply?.ok || !snapshotReply.value?.preferences) {
        throw new Error(snapshotReply?.message || 'Open Settings once before saving house premiums.');
      }
      preferences = snapshotReply.value.preferences;
      const reply = await sendCommand({
        type: 'preferences.save',
        requestId: newRequestId(),
        expectedRevision: preferences.revision,
        preferences: {
          housePremiumPresets: [
            ...(preferences.housePremiumPresets ?? []), { name, buyerPremiumBps: parsed.value },
          ],
        },
      });
      if (!reply.ok) {
        throw new Error(reply.message || reply.error?.message || 'Could not save the preset.');
      }
      preferences = reply.value;
      renderPresets();
      presetName.value = '';
      editor.open = false;
      status.textContent = 'House premium saved.';
      status.dataset.error = 'false';
    } catch (error) {
      showError(error.message || 'Could not save the preset.');
    }
  });
  void getSnapshot().then((reply) => {
    if (reply?.ok) {
      preferences = reply.value?.preferences;
      renderPresets();
    } else {
      showError(reply?.message || 'Could not load house premiums.');
    }
  }).catch((error) => showError(error.message || 'Could not load house premiums.'));
  return {
    setValues(values = {}) {
      if (values.currency) currencyControl.value = values.currency;
      amount.value = formatMinorInput(values.hammerMinor, language());
      premium.value = formatMinorInput(values.buyerPremiumBps, language());
      calculate();
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
