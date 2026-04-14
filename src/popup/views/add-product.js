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
import { parsePrice } from '../../shared/currency.js';

export function renderAddProduct({ product, prefillSelector = null, prefillUrl = '', prefillName = '', onSave, onCancel, onStartPicker }) {
  const isEdit = !!product;

  const wrap = document.createElement('div');
  wrap.className = 'form-view';

  const title = document.createElement('h2');
  title.textContent = isEdit ? 'Edit product' : 'Track new product';
  wrap.appendChild(title);

  // ── Fields ────────────────────────────────────────────────────────────────

  const urlField = makeField('URL', 'url', {
    type: 'url',
    placeholder: 'https://example.com/product',
    value: product?.url ?? prefillUrl,
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
    value: product?.targetPrice != null ? (product.targetPrice / 100).toFixed(2) : '',
  });

  const sellField = makeField('Sell alert threshold (optional)', 'sellThreshold', {
    type: 'text',
    placeholder: 'e.g. $89.99 — alert if price rises above this',
    value: product?.sellThreshold != null ? (product.sellThreshold / 100).toFixed(2) : '',
  });

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
    opt.textContent = mins >= 60 ? `${mins / 60}h` : `${mins} min`;
    if ((product?.intervalMinutes ?? 15) === mins) opt.selected = true;
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
  selectorInput.value = prefillSelector ?? product?.selectors?.price ?? '';
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

  // Stock-only toggle
  const stockOnlyRow = document.createElement('div');
  stockOnlyRow.className = 'toggle-row';
  const stockOnlyLabel = document.createElement('span');
  stockOnlyLabel.textContent = 'Track stock only (ignore price)';
  const stockOnlyToggle = makeToggle('stock-only', product?.stockOnly ?? false);
  stockOnlyRow.appendChild(stockOnlyLabel);
  stockOnlyRow.appendChild(stockOnlyToggle.el);

  // Per-product notification toggle
  const notifRow = document.createElement('div');
  notifRow.className = 'toggle-row';
  const notifLabel = document.createElement('span');
  notifLabel.textContent = 'Enable notifications for this product';
  const notifToggle = makeToggle('notif-enabled', product?.notificationEnabled !== false);
  notifRow.appendChild(notifLabel);
  notifRow.appendChild(notifToggle.el);

  wrap.appendChild(urlField.el);
  wrap.appendChild(nameField.el);
  wrap.appendChild(targetField.el);
  wrap.appendChild(sellField.el);
  wrap.appendChild(intervalWrap);
  wrap.appendChild(selectorWrap);
  wrap.appendChild(stockOnlyRow);
  wrap.appendChild(notifRow);

  // Error display
  const errorEl = document.createElement('div');
  errorEl.className = 'field error';
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
  saveBtn.type = 'button';
  saveBtn.textContent = isEdit ? 'Save' : 'Start tracking';

  saveBtn.addEventListener('click', () => {
    const url = urlField.input.value.trim();
    const name = nameField.input.value.trim();
    const targetRaw = targetField.input.value.trim();
    const sellRaw = sellField.input.value.trim();

    if (!url) return showError('URL is required');
    try { new URL(url); } catch { return showError('Enter a valid URL'); }
    if (!name) return showError('Name is required');

    let targetPrice = null;
    if (targetRaw) {
      const parsed = parsePrice(targetRaw);
      if (!parsed) return showError('Could not parse target price — try e.g. $49.99');
      targetPrice = parsed.value;
    }

    let sellThreshold = null;
    if (sellRaw) {
      const parsed = parsePrice(sellRaw);
      if (!parsed) return showError('Could not parse sell threshold — try e.g. $89.99');
      sellThreshold = parsed.value;
    }

    onSave({
      url,
      name,
      targetPrice,
      sellThreshold,
      intervalMinutes: Number(intervalSelect.value),
      priceSelector: selectorInput.value.trim() || null,
      stockOnly: stockOnlyToggle.input.checked,
      notificationEnabled: notifToggle.input.checked,
    });
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
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
