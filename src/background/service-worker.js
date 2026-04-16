/**
 * PriceWatch service worker — event router.
 */

import { syncAllAlarms, syncAlarm, clearAlarm } from './alarm-manager.js';
import { checkProduct, ensureSources } from './check-engine.js';
import { updateBadge } from './badge-manager.js';
import { syncDigestAlarm, fireDigest } from './digest.js';
import { getProducts, getProduct, saveProduct, deleteProduct, getHistory, getSettings, updateSettings } from '../shared/storage.js';
import { generateId, productIdFromAlarm } from '../shared/utils.js';
import { MSG, DEFAULT_SETTINGS, ALARM_DIGEST } from '../shared/constants.js';
import { syncToGist } from './gist-sync.js';

// ── Lifecycle ─────────────────────────────────────────────────────────────────

globalThis.addEventListener('install', () => { globalThis.skipWaiting(); });

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim()
      .then(migrateLocalToSync)
      .then(syncAllAlarms)
      .then(syncDigestAlarm)
      .then(updateBadge)
  );
});

chrome.runtime.onStartup.addListener(async () => {
  await syncAllAlarms();
  await syncDigestAlarm();
  await updateBadge();
});

// ── Alarms ────────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_DIGEST) { await fireDigest(); return; }
  const productId = productIdFromAlarm(alarm.name);
  if (productId) await checkProduct(productId);
});

// ── Notification clicks ───────────────────────────────────────────────────────

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const parts = notificationId.split('_');
  if (parts.length >= 2) {
    const productId = parts[1];
    // Store the target product ID so the popup can open directly to its detail view
    await chrome.storage.local.set({ _notifClick: productId });
    await chrome.action.openPopup().catch(() => {
      // openPopup() requires a focused window — fall back to opening the product URL
      getProduct(productId).then((p) => {
        if (p?.url) chrome.tabs.create({ url: p.canonicalUrl ?? p.url });
      });
    });
  }
  chrome.notifications.clear(notificationId);
});

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.PICKER_RESULT) {
    if (msg.selector) chrome.storage.local.set({ _pickerResult: msg.selector });
    sendResponse({ ok: true });
    return true;
  }
  handleMessage(msg).then(sendResponse).catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case MSG.GET_PRODUCTS:    return { products: await getProducts() };
    case MSG.ADD_PRODUCT:     return handleAddProduct(msg.data);
    case MSG.UPDATE_PRODUCT:  return handleUpdateProduct(msg.id, msg.data);
    case MSG.DELETE_PRODUCT:  return handleDeleteProduct(msg.id);
    case MSG.CHECK_NOW:       return handleCheckNow(msg.id);
    case MSG.PAUSE_ALL:       return handlePauseAll();
    case MSG.CHECK_ALL:       return handleCheckAll();
    case MSG.RESUME_ALL:      return handleResumeAll();
    case MSG.IMPORT_URLS:     return handleImportUrls(msg.urls);
    case MSG.ADD_SOURCE:      return handleAddSource(msg.productId, msg.url);
    case MSG.REMOVE_SOURCE:   return handleRemoveSource(msg.productId, msg.sourceId);
    case MSG.GIST_SYNC:       return syncToGist();
    case MSG.GET_HISTORY:     return { points: await getHistory(msg.id) };
    case MSG.GET_SETTINGS:    return { settings: await getSettings() };
    case MSG.UPDATE_SETTINGS: {
      const settings = await updateSettings(msg.data);
      await syncAllAlarms();
      await syncDigestAlarm();
      return { settings };
    }
    default: return { error: `Unknown message type: ${msg.type}` };
  }
}

// ── Message handlers ──────────────────────────────────────────────────────────

/** Fire-and-forget Gist sync — never blocks the caller. */
function triggerGistSync() { syncToGist().catch(() => {}); }

async function handleAddProduct(data) {
  const existing = await getProducts();
  const duplicate = Object.values(existing).find((p) => p.url === data.url || p.canonicalUrl === data.url);
  if (duplicate) return { error: 'already_tracked', product: duplicate };

  const product = {
    id: generateId(),
    url: data.url, canonicalUrl: null, name: data.name, thumbnail: null,
    targetPrice: data.targetPrice ?? null, sellThreshold: data.sellThreshold ?? null,
    currency: data.currency ?? DEFAULT_SETTINGS.defaultCurrency,
    intervalMinutes: data.intervalMinutes ?? DEFAULT_SETTINGS.defaultInterval,
    enabled: true, notificationEnabled: data.notificationEnabled !== false,
    selectors: { price: data.priceSelector ?? null },
    requiresTabExtraction: false, sources: [], bestSourceId: null,
    currentPrice: null,
    initialPrice: null, lowestPrice: null, highestPrice: null,
    lastChecked: null, lastNotified: null,
    consecutiveErrors: 0, consecutiveNulls: 0,
    sortOrder: Date.now(), createdAt: Date.now(),
  };
  await saveProduct(product);
  await syncAlarm(product);
  checkProduct(product.id);
  triggerGistSync();
  return { product };
}

async function handleUpdateProduct(id, data) {
  const existing = await getProduct(id);
  if (!existing) return { error: 'Product not found' };
  const updated = { ...existing, ...data };
  await saveProduct(updated);
  await syncAlarm(updated);
  await updateBadge();
  triggerGistSync();
  return { product: updated };
}

async function handleDeleteProduct(id) {
  await clearAlarm(id);
  await deleteProduct(id);
  await updateBadge();
  triggerGistSync();
  return { ok: true };
}

async function handleCheckNow(id) {
  const product = await getProduct(id);
  if (!product) return { error: 'Product not found' };
  // Reset error state and cooldown so the check always runs and notifies, even if
  // the product was auto-disabled or a notification was recently delivered.
  // Also reset consecutiveNulls on each source so the discovery tab-fallback
  // (neverExtracted gate in doFetch) triggers even if previous checks already ran.
  const sources = (product.sources ?? []).map((s) => ({ ...s, consecutiveNulls: 0 }));
  await saveProduct({ ...product, lastNotified: null, consecutiveErrors: 0, enabled: true, sources });
  await syncAlarm({ ...product, enabled: true });
  await checkProduct(id);
  return { ok: true };
}

async function handleCheckAll() {
  const products = await getProducts();
  const enabled = Object.values(products).filter((p) => p.enabled);
  // Fire checks concurrently but don't await — checks run in background
  for (const p of enabled) checkProduct(p.id);
  return { ok: true, count: enabled.length };
}

async function handlePauseAll() {
  const products = await getProducts();
  const entries = Object.values(products);
  // Batch all writes into a single sync set to avoid quota limits
  const batch = {};
  for (const p of entries) batch[`p_${p.id}`] = { ...p, enabled: false };
  await chrome.storage.sync.set(batch);
  await Promise.all(entries.map((p) => clearAlarm(p.id)));
  await updateBadge();
  return { ok: true };
}

async function handleResumeAll() {
  const products = await getProducts();
  const entries = Object.values(products);
  // Batch all writes into a single sync set to avoid quota limits
  const batch = {};
  for (const p of entries) batch[`p_${p.id}`] = { ...p, enabled: true };
  await chrome.storage.sync.set(batch);
  await Promise.all(entries.map((p) => syncAlarm({ ...p, enabled: true })));
  await updateBadge();
  return { ok: true };
}

async function handleImportUrls(urls) {
  const existing = await getProducts();
  const existingUrls = new Set(Object.values(existing).flatMap((p) => [p.url, p.canonicalUrl].filter(Boolean)));
  const settings = await getSettings();
  const added = [];
  for (const url of urls) {
    if (existingUrls.has(url)) continue;
    const product = {
      id: generateId(), url, canonicalUrl: null, name: hostnameOf(url),
      thumbnail: null, targetPrice: null, sellThreshold: null,
      currency: settings.defaultCurrency, intervalMinutes: settings.defaultInterval,
      enabled: true, notificationEnabled: true,
      selectors: { price: null }, requiresTabExtraction: false,
      sources: [], bestSourceId: null,
      currentPrice: null,
      initialPrice: null, lowestPrice: null, highestPrice: null,
      lastChecked: null, lastNotified: null,
      consecutiveErrors: 0, consecutiveNulls: 0,
      sortOrder: Date.now(), createdAt: Date.now(),
    };
    await saveProduct(product);
    await syncAlarm(product);
    checkProduct(product.id);
    added.push(product);
    existingUrls.add(url);
  }
  if (added.length > 0) triggerGistSync();
  return { added: added.length };
}

async function handleAddSource(productId, url) {
  const product = await getProduct(productId);
  if (!product) return { error: 'Product not found' };
  const withSources = ensureSources(product);
  if (withSources.sources.some((s) => s.url === url)) return { error: 'already_added' };
  const newSource = {
    id: generateId(), url, canonicalUrl: null, label: hostnameOf(url),
    selectors: { price: null }, requiresTabExtraction: false,
    currentPrice: null, currency: null, thumbnail: null, lastChecked: null,
    consecutiveErrors: 0, consecutiveNulls: 0,
  };
  const updated = { ...withSources, sources: [...withSources.sources, newSource] };
  await saveProduct(updated);
  checkProduct(productId);
  return { product: updated };
}

async function handleRemoveSource(productId, sourceId) {
  const product = await getProduct(productId);
  if (!product) return { error: 'Product not found' };
  if ((product.sources?.length ?? 0) <= 1) return { error: 'last_source' };
  const sources = (product.sources ?? []).filter((s) => s.id !== sourceId);
  const updated = {
    ...product, sources,
    url: sources[0]?.url ?? product.url,
    bestSourceId: product.bestSourceId === sourceId ? null : product.bestSourceId,
  };
  await saveProduct(updated);
  return { product: updated };
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

// ── Storage sync listener ─────────────────────────────────────────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  for (const [key, { newValue, oldValue }] of Object.entries(changes)) {
    if (!key.startsWith('p_')) continue;
    if (newValue) {
      const old = oldValue;
      if (!old || old.intervalMinutes !== newValue.intervalMinutes || old.enabled !== newValue.enabled) {
        await syncAlarm(newValue);
      }
    } else {
      await clearAlarm(key.slice(2));
    }
  }
});

// ── Migration ─────────────────────────────────────────────────────────────────

async function migrateLocalToSync() {
  const local = await chrome.storage.local.get('products');
  const oldProducts = local['products'];
  if (!oldProducts || typeof oldProducts !== 'object') return;
  const entries = Object.values(oldProducts);
  if (entries.length === 0) return;
  const toSet = {};
  for (const product of entries) toSet[`p_${product.id}`] = product;
  await chrome.storage.sync.set(toSet);
  await chrome.storage.local.remove('products');
}
