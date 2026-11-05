/**
 * Add / Edit product form view.
 *
 * @param {{
 *   product?: import('../../shared/types').Product,
 *   prefillSelector?: string|null,
 *   prefillUrl?: string,
 *   prefillName?: string,
 *   onSave: (data: object) => void,
 *   onCancel: () => void,
 *   onStartPicker: () => void,
 * }} opts
 * @returns {HTMLElement}
 */

import { CHECK_INTERVALS } from '../../shared/constants.js';
import { parsePrice, formatPrice } from '../../shared/currency.js';
import { normalizeOrganization, referenceCurrency } from '../../shared/product-state.js';

export function renderAddProduct({ product, settings = {}, prefillSelector = null, prefillUrl = '', prefillName = '', onSave, onCancel, onStartPicker }) {
  const isEdit = !!product;
  const currency = product ? referenceCurrency(product) : settings.defaultCurrency ?? 'USD';
  const primary = product?.sources?.[0];
  const amountText = (value) => value == null ? '' : new Intl.NumberFormat('en-US', {
    useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value / (parsePrice('1', currency)?.value ?? 100));

  const wrap = document.createElement('form');
  wrap.noValidate = true;
  wrap.className = 'form-view';

  const title = document.createElement('h2');
  title.textContent = isEdit ? 'Edit product' : 'Track new product';
  wrap.appendChild(title);

  // ── Fields ────────────────────────────────────────────────────────────────

  const urlField = makeField('URL', 'url', {
    type: 'url',
    placeholder: 'https://example.com/product',
    value: primary?.url ?? product?.url ?? prefillUrl,
    required: true,
  });

  const nameField = makeField('Name', 'name', {
    type: 'text',
    placeholder: 'e.g. Sony WH-1000XM5',
    value: product?.name ?? prefillName,
    required: true,
  });

  const targetField = makeField('Target price (optional)', 'targetPrice', {
    type: 'text',
    placeholder: 'e.g. $49.99',
    value: amountText(product?.targetPrice),
  });

  const sellField = makeField('Sell alert threshold (optional)', 'sellThreshold', {
    type: 'text',
    placeholder: 'e.g. $89.99 — alert if price rises above this',
    value: amountText(product?.sellThreshold),
  });

  const groupField = makeField('Group (optional)', 'group', { placeholder: 'e.g. Electronics', value: product?.group ?? '' });
  const tagsField = makeField('Tags (optional)', 'tags', { placeholder: 'wishlist, gift, home', value: (product?.tags ?? []).join(', ') });
  const tagsHint = document.createElement('span'); tagsHint.className = 'hint'; tagsHint.textContent = 'Up to 8 tags, separated by commas.';
  tagsField.el.appendChild(tagsHint);

  // Interval select
  const intervalWrap = document.createElement('div');
  intervalWrap.className = 'field';
  const intervalLabel = document.createElement('label');
  intervalLabel.textContent = 'Check every';
  intervalLabel.setAttribute('for', 'field-interval');
  const intervalSelect = document.createElement('select');
  intervalSelect.id = 'field-interval';
  for (const mins of CHECK_INTERVALS) {
    const opt = document.createElement('option');
    opt.value = String(mins);
    let label;
    if (mins >= 1440)     label = `${mins / 1440} day`;
    else if (mins >= 60)  label = `${mins / 60}h`;
    else                  label = `${mins} min`;
    opt.textContent = label;
    if ((product?.intervalMinutes ?? settings.defaultInterval ?? 15) === mins) opt.selected = true;
    intervalSelect.appendChild(opt);
  }
  intervalWrap.appendChild(intervalLabel);
  intervalWrap.appendChild(intervalSelect);

  // Selector field + picker button
  const selectorWrap = document.createElement('div');
  selectorWrap.className = 'field';
  const selectorLabel = document.createElement('label');
  selectorLabel.textContent = 'Price element selector (optional)';
  const selectorRow = document.createElement('div');
  selectorRow.className = 'selector-row';
  const selectorInput = document.createElement('input');
  selectorInput.type = 'text';
  selectorInput.placeholder = '.price, [itemprop="price"], …';
  selectorInput.value = prefillSelector ?? primary?.selectors?.price ?? product?.selectors?.price ?? '';
  selectorLabel.htmlFor = 'field-selector';
  selectorInput.id = 'field-selector';
  const pickerBtn = document.createElement('button');
  pickerBtn.type = 'button';
  pickerBtn.className = 'btn btn-secondary';
  pickerBtn.textContent = 'Pick';
  pickerBtn.title = 'Visually pick the price element on the page';
  pickerBtn.addEventListener('click', onStartPicker);
  selectorRow.appendChild(selectorInput);
  selectorRow.appendChild(pickerBtn);
  const selectorHint = document.createElement('span');
  selectorHint.className = 'hint';
  selectorHint.textContent = 'Leave blank to auto-detect';
  selectorWrap.appendChild(selectorLabel);
  selectorWrap.appendChild(selectorRow);
  selectorWrap.appendChild(selectorHint);

  // Per-product notification toggle
  const notifRow = document.createElement('div');
  notifRow.className = 'toggle-row';
  const notifLabel = document.createElement('span');
  notifLabel.textContent = 'Enable notifications for this product';
  const notifToggle = makeToggle('notif-enabled', product?.notificationEnabled !== false);
  notifToggle.input.setAttribute('aria-label', notifLabel.textContent);
  notifRow.appendChild(notifLabel);
  notifRow.appendChild(notifToggle.el);

  wrap.appendChild(urlField.el);
  wrap.appendChild(nameField.el);
  const currencyHint = document.createElement('span');
  currencyHint.className = 'hint';
  currencyHint.textContent = `Amounts in ${currency} (e.g. ${formatPrice(parsePrice('49', currency).value, currency)}).`;
  targetField.el.appendChild(currencyHint);
  wrap.appendChild(targetField.el);
  wrap.appendChild(sellField.el);
  wrap.appendChild(intervalWrap);
  wrap.appendChild(groupField.el); wrap.appendChild(tagsField.el);
  wrap.appendChild(selectorWrap);
  wrap.appendChild(notifRow);

  // Error display
  const errorEl = document.createElement('div');
  errorEl.className = 'field error';
  errorEl.setAttribute('role', 'alert');
  errorEl.style.display = 'none';
  wrap.appendChild(errorEl);

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', onCancel);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'submit';
  saveBtn.textContent = isEdit ? 'Save' : 'Start tracking';

  let saving = false;
  wrap.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    errorEl.style.display = 'none';
    const url = urlField.input.value.trim();
    const name = nameField.input.value.trim();
    const targetRaw = targetField.input.value.trim();
    const sellRaw = sellField.input.value.trim();

    if (!url) return showError('URL is required', urlField.input);
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { return showError('Enter a valid HTTP or HTTPS URL', urlField.input); }
    if (!name) return showError('Name is required', nameField.input);

    let targetPrice = null;
    if (targetRaw) {
      const parsed = parsePrice(targetRaw, currency);
      if (!parsed || parsed.currency !== currency) return showError(`Enter a positive target price in ${currency}`, targetField.input);
      targetPrice = parsed.value;
    }

    let sellThreshold = null;
    if (sellRaw) {
      const parsed = parsePrice(sellRaw, currency);
      if (!parsed || parsed.currency !== currency) return showError(`Enter a positive sell threshold in ${currency}`, sellField.input);
      sellThreshold = parsed.value;
    }

    let organization;
    try { organization = normalizeOrganization({ group: groupField.input.value, tags: tagsField.input.value.split(',') }); }
    catch (err) { return showError(err.message, tagsField.input); }
    saving = true;
    saveBtn.disabled = true;
    pickerBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await onSave({ url, name, currency, targetPrice, sellThreshold, ...organization,
        intervalMinutes: Number(intervalSelect.value),
        priceSelector: selectorInput.value.trim() || null,
        notificationEnabled: notifToggle.input.checked });
    } catch (err) {
      showError(err.message || 'Could not save. Please try again.');
    } finally {
      saving = false;
      saveBtn.disabled = false;
      pickerBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save' : 'Start tracking';
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);

  function showError(msg, input) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    input?.focus();
  }

  wrap._selectorInput = selectorInput;
  return wrap;
}

function makeField(labelText, id, { type, placeholder, value, required } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.setAttribute('for', `field-${id}`);
  const input = document.createElement('input');
  input.type = type ?? 'text';
  input.id = `field-${id}`;
  input.placeholder = placeholder ?? '';
  input.value = value ?? '';
  if (required) input.required = true;
  wrap.appendChild(label);
  wrap.appendChild(input);
  return { el: wrap, input };
}

function makeToggle(id, checked) {
  const label = document.createElement('label');
  label.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `toggle-${id}`;
  input.checked = checked;
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  label.appendChild(input);
  label.appendChild(slider);
  return { el: label, input };
}
