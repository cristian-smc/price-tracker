/**
 * Storage wrappers.
 *
 * Products & settings → chrome.storage.sync  (shared across signed-in devices)
 *   Each product is stored under its own key "p_<id>" to stay within the
 *   8 KB per-item quota. Settings live under "settings".
 *
 * Price history        → chrome.storage.local (too large for sync)
 *   Keyed as "history_<productId>".
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';

const PRODUCT_PREFIX = 'p_';

// ---------- Products (sync) ----------

/** @returns {Promise<Record<string, import('./types').Product>>} */
export async function getProducts() {
  const all = await chrome.storage.sync.get(null);
  const products = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PRODUCT_PREFIX)) {
      products[value.id] = value;
    }
  }
  return products;
}

/** @param {string} id @returns {Promise<import('./types').Product|null>} */
export async function getProduct(id) {
  const result = await chrome.storage.sync.get(PRODUCT_PREFIX + id);
  return result[PRODUCT_PREFIX + id] ?? null;
}

/** @param {import('./types').Product} product */
export async function saveProduct(product) {
  await chrome.storage.sync.set({ [PRODUCT_PREFIX + product.id]: product });
}

/** @param {string} id */
export async function deleteProduct(id) {
  await chrome.storage.sync.remove(PRODUCT_PREFIX + id);
  await chrome.storage.local.remove(STORAGE_KEYS.HISTORY_PREFIX + id);
}

// ---------- History (local) ----------

/** @param {string} productId @returns {Promise<import('./types').HistoryPoint[]>} */
export async function getHistory(productId) {
  const key = STORAGE_KEYS.HISTORY_PREFIX + productId;
  const result = await chrome.storage.local.get(key);
  return result[key]?.points ?? [];
}

/**
 * Appends a new history point and prunes to maxPoints.
 * @param {string} productId
 * @param {{ price: number }} point
 * @param {number} maxPoints
 */
export async function appendHistory(productId, point, maxPoints) {
  const key = STORAGE_KEYS.HISTORY_PREFIX + productId;
  const result = await chrome.storage.local.get(key);
  const existing = result[key]?.points ?? [];

  const newPoint = { ts: Date.now(), price: point.price };
  const updated = [...existing, newPoint];
  const pruned = updated.length > maxPoints
    ? updated.slice(updated.length - maxPoints)
    : updated;

  await chrome.storage.local.set({ [key]: { productId, points: pruned } });
}

// ---------- Settings (sync) ----------

/** @returns {Promise<import('./types').Settings>} */
export async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

/** @param {Partial<import('./types').Settings>} patch */
export async function updateSettings(patch) {
  const current = await getSettings();
  const merged = { ...current, ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

// ---------- Bulk export / import ----------

/** Returns a JSON-serialisable snapshot of all extension data. */
export async function exportAll() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(null),
  ]);
  return { sync: syncData, local: localData };
}

/**
 * Restores from a snapshot produced by exportAll().
 * @param {{ sync: object, local: object }} data
 */
export async function importAll(data) {
  await Promise.all([
    chrome.storage.sync.clear().then(() => chrome.storage.sync.set(data.sync ?? {})),
    chrome.storage.local.clear().then(() => chrome.storage.local.set(data.local ?? {})),
  ]);
}
