/**
 * Popup entry point — view router and message dispatcher.
 * Views: list → detail → add/edit
 */

import { MSG } from '../shared/constants.js';
import { sendMessage as send } from '../shared/messages.js';
import { renderProductList } from './views/product-list.js';
import { renderAddProduct } from './views/add-product.js';
import { renderProductDetail } from './views/product-detail.js';

const container = document.getElementById('view-container');
const notifBanner = document.getElementById('notif-banner');
let currentAddProductView = null;
let undoTimer;
async function refreshUndo() {
  const bar = document.getElementById('undo-bar');
  if (!bar) return;
  clearTimeout(undoTimer);
  const { undo } = await send({ type: MSG.GET_UNDO });
  bar.replaceChildren(); bar.classList.toggle('hidden', !undo);
  if (!undo) return;
  const text = document.createElement('span'); text.textContent = `Deleted “${undo.name}”`;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary'; button.textContent = 'Undo';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const { product } = await send({ type: MSG.UNDO_DELETE, token: undo.token });
      await refreshUndo(); await showList();
      container.querySelector(`[data-id="${CSS.escape(product.id)}"] .card-open`)?.focus();
    } catch (err) { showRouteError(err); button.disabled = false; }
  });
  bar.append(text, button);
  undoTimer = setTimeout(() => refreshUndo().catch(showRouteError), Math.max(0, undo.expiresAt - Date.now()));
}
async function deleteFromView(id, version) {
  await send({ type: MSG.DELETE_PRODUCT, id });
  await refreshUndo();
  if (stillHere(version)) { await showList(); container.querySelector('.card-open, input')?.focus(); }
}

// ── Messaging helpers ─────────────────────────────────────────────────────

let routeVersion = 0;
let listState = null;
function beginRoute() { currentAddProductView = null; return ++routeVersion; }
function stillHere(version) { return version === routeVersion; }
function showRouteError(err) {
  const alert = document.createElement('div');
  alert.className = 'action-status'; alert.setAttribute('role', 'alert');
  alert.textContent = err.message || 'Could not load the view. Please try again.';
  container.prepend(alert);
}
function navigate(action) { Promise.resolve().then(action).catch(showRouteError); }
async function showListAfterSave(version) {
  if (!stillHere(version)) return;
  const refreshVersion = routeVersion + 1;
  try { await showList(); }
  catch (err) {
    if (!stillHere(refreshVersion)) return;
    const view = document.createElement('div'); view.className = 'form-view';
    const alert = document.createElement('p'); alert.setAttribute('role', 'alert');
    alert.textContent = `Product saved, but the list could not refresh: ${err.message}`;
    const retry = document.createElement('button'); retry.className = 'btn btn-primary';
    retry.textContent = 'Retry loading'; retry.addEventListener('click', () => navigate(showList));
    view.append(alert, retry); setView(view);
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────

async function applyTheme() {
  const { settings } = await send({ type: MSG.GET_SETTINGS });
  const theme = settings?.theme ?? 'auto';
  if (theme === 'auto') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

// ── Notification permission check ─────────────────────────────────────────

async function checkNotifPermission() {
  if (!('Notification' in globalThis)) return;
  const perm = await chrome.permissions.contains({ permissions: ['notifications'] }).catch(() => true);
  if (perm && Notification.permission === 'denied') {
    notifBanner.classList.remove('hidden');
  }
}

document.getElementById('notif-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ── View: product list ────────────────────────────────────────────────────

async function showList() {
  const version = beginRoute();
  const [{ products }, { settings }] = await Promise.all([
    send({ type: MSG.GET_PRODUCTS }),
    send({ type: MSG.GET_SETTINGS }),
  ]);
  if (!stillHere(version)) return;
  listState ??= { sortBy: settings?.sortBy ?? 'created', filterBy: settings?.filterBy ?? 'all', searchQuery: '', groupBy: '', tagBy: '' };
  const view = renderProductList(products ?? {}, {
    onSelect: (id) => navigate(() => showDetail(id)),
    onAdd: () => navigate(showAdd),
    onDelete: (id) => deleteFromView(id, version),
    onRepair: startRepair,
    onPauseAll: async () => {
      await send({ type: MSG.PAUSE_ALL });
      if (stillHere(version)) await showList();
    },
    onResumeAll: async () => {
      await send({ type: MSG.RESUME_ALL });
      if (stillHere(version)) await showList();
    },
    onCheckAll: async () => {
      await send({ type: MSG.CHECK_ALL });
      if (stillHere(version)) await showList();
    },
    onReorder: async (id, newOrder) => {
      await Promise.all([
        send({ type: MSG.UPDATE_PRODUCT, id, data: { sortOrder: newOrder } }),
        send({ type: MSG.UPDATE_SETTINGS, data: { sortBy: 'manual' } }),
      ]);
      listState.sortBy = 'manual';
      if (stillHere(version)) await showList();
    },
    ...listState,
    onStateChange: (state) => {
      const preferencesChanged = state.sortBy !== listState.sortBy || state.filterBy !== listState.filterBy;
      listState = state;
      if (preferencesChanged) send({ type: MSG.UPDATE_SETTINGS, data: { sortBy: state.sortBy, filterBy: state.filterBy } }).catch(showRouteError);
    },
  });
  setView(view);
}

// ── View: product detail ──────────────────────────────────────────────────

async function showDetail(productId) {
  const version = beginRoute();
  const [{ products }, { points }, { settings }] = await Promise.all([
    send({ type: MSG.GET_PRODUCTS }),
    send({ type: MSG.GET_HISTORY, id: productId }),
    send({ type: MSG.GET_SETTINGS }),
  ]);
  if (!stillHere(version)) return;
  const product = products?.[productId];
  if (!product) return showList();

  const view = renderProductDetail({
    product,
    history: points ?? [],
    settings: settings ?? {},
    onBack: () => navigate(showList),
    onEdit: (id) => showEdit(products[id]),
    onDelete: (id) => deleteFromView(id, version),
    onRepair: startRepair,
    onCheckNow: async (id) => {
      await send({ type: MSG.CHECK_NOW, id });
      if (stillHere(version)) await showDetail(id);
    },
    onToggleEnabled: async (id, enabled) => {
      await send({ type: MSG.UPDATE_PRODUCT, id, data: { enabled } });
      if (stillHere(version)) await showDetail(id);
    },
    onToggleNotification: async (id, notificationEnabled) => {
      await send({ type: MSG.UPDATE_PRODUCT, id, data: { notificationEnabled } });
    },
    onToggleStockCheck: async (id, checkStockEnabled) => {
      await send({ type: MSG.UPDATE_PRODUCT, id, data: { checkStockEnabled } });
    },
    onAddSource: async (productId, url) => {
      const resp = await send({ type: MSG.ADD_SOURCE, productId, url });
      if (stillHere(version)) await showDetail(productId);
      return resp;
    },
    onRemoveSource: async (productId, sourceId) => {
      await send({ type: MSG.REMOVE_SOURCE, productId, sourceId });
      if (stillHere(version)) await showDetail(productId);
    },
  });
  setView(view);
}

// ── View: add product ─────────────────────────────────────────────────────

async function showAdd(prefillSelector = null) {
  const version = beginRoute();
  const [[tab], { settings }] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }), send({ type: MSG.GET_SETTINGS }),
  ]);
  if (!stillHere(version)) return;
  const view = renderAddProduct({
    product: null, settings,
    prefillSelector,
    prefillUrl: tab?.url ?? '',
    prefillName: tab?.title ?? '',
    onSave: async (data) => {
      await send({ type: MSG.ADD_PRODUCT, data });
      await showListAfterSave(version);
    },
    onCancel: () => navigate(showList),
    onStartPicker: startPicker,
  });
  currentAddProductView = view;
  setView(view);
}

// ── View: edit product ────────────────────────────────────────────────────

function showEdit(product, prefillSelector = null) {
  const version = beginRoute();
  const view = renderAddProduct({
    product,
    prefillSelector,
    onSave: async (data) => {
      await send({ type: MSG.UPDATE_PRODUCT, id: product.id, data });
      await showListAfterSave(version);
    },
    onCancel: () => navigate(() => showDetail(product.id)),
    onStartPicker: () => startPicker(product.id),
  });
  currentAddProductView = view;
  setView(view);
}

async function startRepair(productId, sourceId = null) {
  // Opening the source tab closes a real action popup. The worker owns the full
  // loading/injection lifecycle so repair continues after this UI disappears.
  await send({ type: MSG.START_REPAIR, productId, sourceId });
  window.close();
}

// ── Element picker ────────────────────────────────────────────────────────

async function startPicker(editProductId = null) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (editProductId) await chrome.storage.local.set({ _pickerEditId: editProductId });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content/picker.js'],
  });
  window.close();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.PICKER_RESULT && !msg.repairToken && currentAddProductView?._selectorInput) {
    currentAddProductView._selectorInput.value = msg.selector;
  }
});

// ── Header buttons ────────────────────────────────────────────────────────

document.getElementById('btn-add')?.addEventListener('click', () => navigate(showAdd));
document.getElementById('btn-settings')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function setView(el) {
  container.innerHTML = '';
  container.appendChild(el);
}

// ── Init ──────────────────────────────────────────────────────────────────

await checkNotifPermission();
await applyTheme();
await refreshUndo();

const { _repairNotice } = await chrome.storage.local.get('_repairNotice');
const { _pickerResult, _pickerEditId, _notifClick } = await chrome.storage.local.get(['_pickerResult', '_pickerEditId', '_notifClick']);
if (_repairNotice) {
  await chrome.storage.local.remove('_repairNotice');
  await showDetail(_repairNotice.productId);
  const notice = document.createElement('div'); notice.className = 'action-status'; notice.setAttribute('role', 'status'); notice.textContent = _repairNotice.text; container.prepend(notice);
} else if (_notifClick) {
  await chrome.storage.local.remove('_notifClick');
  await showDetail(_notifClick);
} else if (_pickerResult && _pickerEditId) {
  await chrome.storage.local.remove(['_pickerResult', '_pickerEditId']);
  const { products } = await send({ type: MSG.GET_PRODUCTS });
  const product = products?.[_pickerEditId];
  if (product) showEdit(product, _pickerResult);
  else await showAdd(_pickerResult);
} else if (_pickerResult) {
  await chrome.storage.local.remove('_pickerResult');
  await showAdd(_pickerResult);
} else {
  await showList();
}
