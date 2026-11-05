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
import { validateBackup, checkSyncQuota } from './backup.js';
import { generateId } from './utils.js';

const PRODUCT_PREFIX = 'p_';
const TRANSIENT_KEYS = ['_undoDelete', '_repairSession', '_repairNotice', '_pickerResult', '_pickerEditId', '_notifClick'];
const portableLocal = (data) => Object.fromEntries(Object.entries(data).filter(([key]) => !TRANSIENT_KEYS.includes(key)));

// Worker-local coordination only; never hold this queue during network fetching.
let mutationTail = Promise.resolve();
let dataGeneration = 0;
export function withMutation(callback) {
  const result = mutationTail.then(callback);
  mutationTail = result.catch(() => {});
  return result;
}
export function getDataGeneration() { return dataGeneration; }
export function invalidateChecks() { dataGeneration += 1; }


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

// Caller holds withMutation for deletion/undo, matching worker mutation handlers.
export async function deleteWithUndo(id) {
  const product = await getProduct(id);
  if (!product) throw new Error('Product not found');
  const historyKey = STORAGE_KEYS.HISTORY_PREFIX + id;
  const local = await chrome.storage.local.get([historyKey, '_undoDelete']);
  const undo = { token: generateId(), product, history: local[historyKey] ?? null, expiresAt: Date.now() + 30000 };
  await chrome.storage.local.set({ _undoDelete: undo });
  invalidateChecks();
  try { await deleteProduct(id); }
  catch (err) {
    try {
      await saveProduct(product);
      if (undo.history) await chrome.storage.local.set({ [historyKey]: undo.history });
      if (local._undoDelete) await chrome.storage.local.set({ _undoDelete: local._undoDelete });
      else await chrome.storage.local.remove('_undoDelete');
    } catch { throw new Error('Delete failed and recovery failed. Export your data before retrying.'); }
    throw err;
  }
  return { token: undo.token, name: product.name, expiresAt: undo.expiresAt };
}
export async function getUndo() {
  const { _undoDelete: undo } = await chrome.storage.local.get('_undoDelete');
  if (!undo) return null;
  if (undo.expiresAt <= Date.now()) { await chrome.storage.local.remove('_undoDelete'); return null; }
  return { token: undo.token, name: undo.product.name, expiresAt: undo.expiresAt };
}
export async function undoDelete(token) {
  const { _undoDelete: undo } = await chrome.storage.local.get('_undoDelete');
  if (!undo || undo.token !== token || undo.expiresAt <= Date.now()) throw new Error('Undo has expired.');
  if (await getProduct(undo.product.id)) throw new Error('A product with this ID already exists.');
  const current = await chrome.storage.sync.get(null);
  checkSyncQuota({ ...current, [PRODUCT_PREFIX + undo.product.id]: undo.product }, chrome.storage.sync);
  invalidateChecks();
  const historyKey = STORAGE_KEYS.HISTORY_PREFIX + undo.product.id;
  try {
    if (undo.history) await chrome.storage.local.set({ [historyKey]: undo.history });
    await saveProduct(undo.product);
  } catch (err) {
    try { await deleteProduct(undo.product.id); }
    catch { throw new Error('Undo failed and recovery failed. Keep your backup.'); }
    throw err;
  }
  await chrome.storage.local.remove('_undoDelete');
  return undo.product;
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

  const newPoint = { ts: Date.now(), price: point.price, ...(point.currency ? { currency: point.currency } : {}) };
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
export async function exportAll(includeTransient = false) {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(null),
  ]);
  return { sync: syncData, local: includeTransient ? localData : portableLocal(localData) };
}

/**
 * Restores from a snapshot produced by exportAll().
 * @param {{ sync: object, local: object }} data
 */
export async function importAll(data) {
  const normalized = validateBackup(data);
  return withMutation(async () => {
    const before = await exportAll();
    await chrome.storage.local.remove(TRANSIENT_KEYS);
    const sync = normalized.legacy ? { ...before.sync, ...normalized.sync } : normalized.sync;
    checkSyncQuota(sync, chrome.storage.sync);
    invalidateChecks();
    try {
      await replaceArea(chrome.storage.sync, sync);
      await replaceArea(chrome.storage.local, portableLocal(normalized.local));
    } catch {
      const rollback = await Promise.allSettled([
        replaceArea(chrome.storage.sync, before.sync), replaceArea(chrome.storage.local, before.local),
      ]);
      if (rollback.some((r) => r.status === 'rejected')) throw new Error('Import failed; rollback also failed. Keep your backup and retry when storage is available.');
      throw new Error('Import failed; your original data was restored.');
    }
  });
}

async function replaceArea(area, data) {
  const current = await area.get(null);
  const obsolete = Object.keys(current).filter((key) => !Object.hasOwn(data, key));
  let removeFirst = false;
  if (area === chrome.storage.sync) {
    try { checkSyncQuota({ ...current, ...data }, area); }
    catch { removeFirst = true; }
  }
  // Both target snapshots fit. Remove obsolete keys first only if their temporary
  // union would exceed sync quota; the caller retains originals for rollback.
  if (removeFirst && obsolete.length) await area.remove(obsolete);
  await area.set(data);
  if (!removeFirst && obsolete.length) await area.remove(obsolete);
}

export function clearAll() {
  return withMutation(async () => {
    invalidateChecks();
    await Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]);
  });
}
