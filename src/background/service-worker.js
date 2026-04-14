/**
 * PriceWatch service worker — event router.
 *
 * Handles:
 *  - install / startup  → sync all alarms
 *  - chrome.alarms      → trigger price check
 *  - chrome.notifications.onClicked → open product URL
 *  - chrome.runtime.onMessage → popup API (CRUD products, manual check, history)
 *  - chrome.storage.onChanged → re-sync alarms if settings change
 */

import { syncAllAlarms, syncAlarm, clearAlarm } from './alarm-manager.js';
import { checkProduct } from './check-engine.js';
import { getProducts, getProduct, saveProduct, deleteProduct, getHistory, getSettings, updateSettings } from '../shared/storage.js';
import { generateId, productIdFromAlarm } from '../shared/utils.js';
import { MSG, DEFAULT_SETTINGS, STOCK_STATUS } from '../shared/constants.js';

// ── Lifecycle ─────────────────────────────────────────────────────────────

globalThis.addEventListener('install', () => {
  globalThis.skipWaiting();
});

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim()
      .then(migrateLocalToSync)
      .then(syncAllAlarms)
  );
});

chrome.runtime.onStartup.addListener(syncAllAlarms);

/**
 * One-time migration: if products are still in chrome.storage.local
 * under the old "products" key, move them to chrome.storage.sync.
 */
async function migrateLocalToSync() {
  const local = await chrome.storage.local.get('products');
  const oldProducts = local['products'];
  if (!oldProducts || typeof oldProducts !== 'object') return;

  const entries = Object.values(oldProducts);
  if (entries.length === 0) return;

  // Write each product to sync under its own key
  const toSet = {};
  for (const product of entries) {
    toSet[`p_${product.id}`] = product;
  }
  await chrome.storage.sync.set(toSet);
  // Remove old key so migration doesn't re-run
  await chrome.storage.local.remove('products');
}

// ── Alarms ────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const productId = productIdFromAlarm(alarm.name);
  if (productId) {
    await checkProduct(productId);
  }
});

// ── Notification clicks ───────────────────────────────────────────────────

chrome.notifications.onClicked.addListener(async (notificationId) => {
  // Notification IDs are "price_<productId>_<ts>"
  const parts = notificationId.split('_');
  if (parts.length >= 2) {
    const productId = parts[1];
    const product = await getProduct(productId);
    if (product?.url) {
      await chrome.tabs.create({ url: product.url });
    }
  }
  chrome.notifications.clear(notificationId);
});

// ── Popup message API ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Picker result: stash selector in storage so popup reads it on next open
  if (msg.type === MSG.PICKER_RESULT) {
    if (msg.selector) {
      chrome.storage.local.set({ _pickerResult: msg.selector });
    }
    sendResponse({ ok: true });
    return true;
  }
  handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // async
});

async function handleMessage(msg) {
  switch (msg.type) {
    case MSG.GET_PRODUCTS: {
      const products = await getProducts();
      return { products };
    }

    case MSG.ADD_PRODUCT: {
      const { data } = msg;
      const product = {
        id: generateId(),
        url: data.url,
        name: data.name,
        targetPrice: data.targetPrice ?? null,
        currency: data.currency ?? DEFAULT_SETTINGS.defaultCurrency,
        intervalMinutes: data.intervalMinutes ?? DEFAULT_SETTINGS.defaultInterval,
        enabled: true,
        selectors: { price: data.priceSelector ?? null, stock: null },
        requiresTabExtraction: false,
        currentPrice: null,
        currentStock: STOCK_STATUS.UNKNOWN,
        lastChecked: null,
        lastNotified: null,
        consecutiveErrors: 0,
        consecutiveNulls: 0,
        createdAt: Date.now(),
      };
      await saveProduct(product);
      await syncAlarm(product);
      // Kick off an immediate check
      checkProduct(product.id);
      return { product };
    }

    case MSG.UPDATE_PRODUCT: {
      const existing = await getProduct(msg.id);
      if (!existing) return { error: 'Product not found' };
      const updated = { ...existing, ...msg.data };
      await saveProduct(updated);
      await syncAlarm(updated);
      return { product: updated };
    }

    case MSG.DELETE_PRODUCT: {
      await clearAlarm(msg.id);
      await deleteProduct(msg.id);
      return { ok: true };
    }

    case MSG.CHECK_NOW: {
      const product = await getProduct(msg.id);
      if (!product) return { error: 'Product not found' };
      // Clear cooldown so a manual check always notifies if below target
      await saveProduct({ ...product, lastNotified: null });
      await checkProduct(msg.id);
      return { ok: true };
    }

    case MSG.GET_HISTORY: {
      const points = await getHistory(msg.id);
      return { points };
    }

    case MSG.GET_SETTINGS: {
      const settings = await getSettings();
      return { settings };
    }

    case MSG.UPDATE_SETTINGS: {
      const settings = await updateSettings(msg.data);
      // Re-sync all alarms in case defaultInterval changed
      await syncAllAlarms();
      return { settings };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

// ── Storage change listener — re-sync alarms if a product's interval changed ──

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  for (const [key, { newValue, oldValue }] of Object.entries(changes)) {
    if (!key.startsWith('p_')) continue;
    if (newValue) {
      // Product added or updated — re-sync alarm if interval/enabled changed
      const old = oldValue;
      if (!old || old.intervalMinutes !== newValue.intervalMinutes || old.enabled !== newValue.enabled) {
        await syncAlarm(newValue);
      }
    } else {
      // Product deleted — clear its alarm
      const productId = key.slice(2); // strip "p_"
      await clearAlarm(productId);
    }
  }
});
