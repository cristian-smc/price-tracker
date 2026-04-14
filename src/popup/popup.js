/**
 * Popup entry point — view router and message dispatcher.
 * Views: list → detail → add/edit
 */

import { MSG } from '../shared/constants.js';
import { renderProductList } from './views/product-list.js';
import { renderAddProduct } from './views/add-product.js';
import { renderProductDetail } from './views/product-detail.js';

const container = document.getElementById('view-container');
const notifBanner = document.getElementById('notif-banner');
let currentAddProductView = null; // holds the rendered add/edit DOM node

// ── Messaging helpers ─────────────────────────────────────────────────────

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ── Notification permission check ─────────────────────────────────────────

async function checkNotifPermission() {
  if (!('Notification' in window)) return;
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
  currentAddProductView = null;
  const { products } = await send({ type: MSG.GET_PRODUCTS });
  const view = renderProductList(products ?? {}, {
    onSelect: showDetail,
    onAdd: showAdd,
  });
  setView(view);
}

// ── View: product detail ──────────────────────────────────────────────────

async function showDetail(productId) {
  const [{ products }, { points }] = await Promise.all([
    send({ type: MSG.GET_PRODUCTS }),
    send({ type: MSG.GET_HISTORY, id: productId }),
  ]);
  const product = products?.[productId];
  if (!product) return showList();

  const view = renderProductDetail({
    product,
    history: points ?? [],
    onBack: showList,
    onEdit: (id) => showEdit(products[id]),
    onDelete: async (id) => {
      await send({ type: MSG.DELETE_PRODUCT, id });
      showList();
    },
    onCheckNow: async (id) => {
      await send({ type: MSG.CHECK_NOW, id });
      // Refresh detail after short delay to show new price
      setTimeout(() => showDetail(id), 2000);
    },
    onToggleEnabled: async (id, enabled) => {
      await send({ type: MSG.UPDATE_PRODUCT, id, data: { enabled } });
      showDetail(id);
    },
  });
  setView(view);
}

// ── View: add product ─────────────────────────────────────────────────────

async function showAdd(prefillSelector = null) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const view = renderAddProduct({
    product: null,
    prefillSelector,
    prefillUrl: tab?.url ?? '',
    prefillName: tab?.title ?? '',
    onSave: async (data) => {
      await send({ type: MSG.ADD_PRODUCT, data });
      showList();
    },
    onCancel: showList,
    onStartPicker: startPicker,
  });
  currentAddProductView = view;
  setView(view);
}

// ── View: edit product ────────────────────────────────────────────────────

function showEdit(product) {
  const view = renderAddProduct({
    product,
    onSave: async (data) => {
      await send({ type: MSG.UPDATE_PRODUCT, id: product.id, data });
      showList();
    },
    onCancel: () => showDetail(product.id),
    onStartPicker: startPicker,
  });
  currentAddProductView = view;
  setView(view);
}

// ── Element picker ────────────────────────────────────────────────────────

async function startPicker() {
  // Inject picker content script into the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content/picker.js'],
  });
  // Close popup so picker overlay is visible
  window.close();
}

// Receive the selector chosen by the picker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.PICKER_RESULT && currentAddProductView?._selectorInput) {
    currentAddProductView._selectorInput.value = msg.selector;
  }
});

// ── Header buttons ────────────────────────────────────────────────────────

document.getElementById('btn-add')?.addEventListener('click', showAdd);
document.getElementById('btn-settings')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function setView(el) {
  container.innerHTML = '';
  container.appendChild(el);
}

// ── Init ──────────────────────────────────────────────────────────────────

checkNotifPermission();

// If the picker just ran, reopen the add form with the captured selector
const { _pickerResult } = await chrome.storage.local.get('_pickerResult');
if (_pickerResult) {
  await chrome.storage.local.remove('_pickerResult');
  await showAdd(_pickerResult);
} else {
  await showList();
}
