/**
 * PriceWatch service worker — event router.
 */

import { syncAllAlarms, syncAlarm, clearAlarm } from './alarm-manager.js';
import { checkProduct, ensureSources } from './check-engine.js';
import { updateBadge } from './badge-manager.js';
import { syncDigestAlarm, fireDigest } from './digest.js';
import { getProducts, getProduct, saveProduct, deleteProduct, getHistory, getSettings, updateSettings, withMutation, exportAll, importAll, clearAll, deleteWithUndo, getUndo, undoDelete } from '../shared/storage.js';
import { generateId, productIdFromAlarm } from '../shared/utils.js';
import { MSG, DEFAULT_SETTINGS, ALARM_DIGEST } from '../shared/constants.js';
import { syncToGist } from './gist-sync.js';
import { productIdFromNotification } from './notifier.js';
import { normalizeOrganization, referenceCurrency, normalizeCurrency } from '../shared/product-state.js';
import { checkSyncQuota } from '../shared/backup.js';

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
  try {
    if (alarm.name === ALARM_DIGEST) { await fireDigest(); return; }
    const productId = productIdFromAlarm(alarm.name);
    if (productId) await checkProduct(productId);
  } catch (err) {
    // Prevent an unhandled rejection from silently swallowing this cycle
    // (e.g. a chrome.storage.sync quota error) — the next alarm still fires.
    console.error(`[PriceWatch] alarm handler failed for ${alarm.name}:`, err);
  }
});

// ── Notification clicks ───────────────────────────────────────────────────────

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const productId = productIdFromNotification(notificationId);
  if (productId) {
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

// "View product" button → opens the product page directly in a new tab.
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex !== 0) return;
  const productId = productIdFromNotification(notificationId);
  if (productId) {
    const p = await getProduct(productId);
    if (p?.url) chrome.tabs.create({ url: p.canonicalUrl ?? p.url });
  }
  chrome.notifications.clear(notificationId);
});

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen' || ['PARSE_HTML','PLAY_SOUND'].includes(msg.type)) return false;
  if (msg.type === MSG.PICKER_RESULT) {
    withMutation(() => handlePickerResult(msg, sender)).then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  handleMessage(msg).then(sendResponse).catch((err) => sendResponse({ error: err.message }));
  return true;
});

const MUTATIONS = new Set([
  MSG.ADD_PRODUCT, MSG.UPDATE_PRODUCT, MSG.DELETE_PRODUCT, MSG.PAUSE_ALL,
  MSG.RESUME_ALL, MSG.IMPORT_URLS, MSG.ADD_SOURCE, MSG.REMOVE_SOURCE, MSG.UPDATE_SETTINGS,
  MSG.GET_UNDO, MSG.UNDO_DELETE, MSG.PREPARE_REPAIR, MSG.CANCEL_REPAIR,
]);

async function handleMessage(msg) {
  if (MUTATIONS.has(msg.type)) return withMutation(() => dispatchMessage(msg));
  return dispatchMessage(msg);
}

async function dispatchMessage(msg) {
  switch (msg.type) {
    case MSG.EXPORT_BACKUP: return { snapshot: await withMutation(exportAll) };
    case MSG.IMPORT_BACKUP:
      await importAll(msg.data);
      await reconcileData();
      return { ok: true };
    case MSG.CLEAR_DATA:
      await clearAll();
      await reconcileData();
      return { ok: true };
    case MSG.GET_PRODUCTS:    return { products: await getProducts() };
    case MSG.ADD_PRODUCT:     return handleAddProduct(msg.data);
    case MSG.UPDATE_PRODUCT:  return handleUpdateProduct(msg.id, msg.data);
    case MSG.DELETE_PRODUCT:  return handleDeleteProduct(msg.id);
    case MSG.GET_UNDO: return { undo: await getUndo() };
    case MSG.UNDO_DELETE: {
      const product = await undoDelete(msg.token);
      await syncAlarm(product); await updateBadge(); triggerGistSync();
      return { product };
    }
    case MSG.START_REPAIR: return startSourceRepair(msg);
    case MSG.PREPARE_REPAIR: return prepareRepair(msg);
    case MSG.CANCEL_REPAIR: await chrome.storage.local.remove('_repairSession'); return { ok: true };
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

async function reconcileData() {
  // Remove orphan product alarms even when no storage listener ran (e.g. rollback).
  const products = await getProducts();
  const alarms = await chrome.alarms.getAll();
  for (const alarm of alarms) {
    const id = productIdFromAlarm(alarm.name);
    if (id && !products[id]) await chrome.alarms.clear(alarm.name);
  }
  await syncAllAlarms(); await syncDigestAlarm(); await updateBadge();
}

// ── Message handlers ──────────────────────────────────────────────────────────

/** Fire-and-forget Gist sync — never blocks the caller. */
function triggerGistSync() { syncToGist().catch(() => {}); }

function requireWebUrl(url) {
  try { if (['http:', 'https:'].includes(new URL(url).protocol)) return; } catch { /* invalid */ }
  throw new Error('Enter a valid HTTP or HTTPS product URL');
}

async function handleAddProduct(data) {
  requireWebUrl(data.url);
  const existing = await getProducts();
  const duplicate = Object.values(existing).find((p) => p.url === data.url || p.canonicalUrl === data.url);
  if (duplicate) return { error: 'already_tracked', product: duplicate };

  const settings = await getSettings();
  const organization = normalizeOrganization(data);
  const product = {
    id: generateId(),
    url: data.url, canonicalUrl: null, name: data.name, thumbnail: null, ...organization,
    referenceCurrency: data.targetPrice != null || data.sellThreshold != null ? (normalizeCurrency(data.currency) ?? settings.defaultCurrency) : null,
    targetPrice: data.targetPrice ?? null, sellThreshold: data.sellThreshold ?? null,
    currency: data.currency ?? settings.defaultCurrency,
    intervalMinutes: data.intervalMinutes ?? settings.defaultInterval,
    enabled: true, notificationEnabled: data.notificationEnabled !== false, checkStockEnabled: true,
    selectors: { price: data.priceSelector ?? null },
    requiresTabExtraction: false, sources: [], bestSourceId: null,
    currentPrice: null,
    initialPrice: null, lowestPrice: null, highestPrice: null,
    lastChecked: null, lastNotified: null,
    consecutiveErrors: 0, consecutiveNulls: 0,
    sortOrder: Date.now(), createdAt: Date.now(),
  };
  checkSyncQuota({ ...(await chrome.storage.sync.get(null)), [`p_${product.id}`]: product }, chrome.storage.sync);
  await saveProduct(product);
  await syncAlarm(product);
  checkProduct(product.id);
  triggerGistSync();
  return { product };
}

async function handleUpdateProduct(id, data) {
  if ('url' in data) requireWebUrl(data.url);
  const existing = await getProduct(id);
  if (!existing) return { error: 'Product not found' };
  const { priceSelector, ...patch } = data;
  const organization = normalizeOrganization({ group: data.group ?? existing.group ?? '', tags: data.tags ?? existing.tags ?? [] });
  const reference = referenceCurrency(existing);
  if (data.referenceCurrency != null && normalizeCurrency(data.referenceCurrency) !== reference) throw new Error('The watch currency cannot change while prices or targets are saved.');
  let updated = { ...existing, ...patch, ...organization, id: existing.id, referenceCurrency: reference, currency: reference };
  if ('enabled' in data) updated.disabledReason = null;
  if ('url' in data || 'priceSelector' in data) {
    const primary = ensureSources(existing).sources[0];
    const url = data.url ?? primary.url;
    const selector = 'priceSelector' in data ? priceSelector : primary.selectors?.price ?? null;
    const urlChanged = url !== primary.url;
    const selectorChanged = selector !== (primary.selectors?.price ?? null);
    const source = { ...primary, url, selectors: { ...primary.selectors, price: selector } };
    if (urlChanged || selectorChanged) Object.assign(source, {
      canonicalUrl: null, requiresTabExtraction: false, consecutiveNulls: 0, consecutiveErrors: 0,
    });
    if (urlChanged) Object.assign(source, { label: hostnameOf(url), currentPrice: null, currency: null,
      thumbnail: null, inStock: null, lastChecked: null, lastObserved: null, checkStatus: null, lastError: null });
    updated = { ...updated, url, selectors: source.selectors,
      sources: [source, ...(existing.sources ?? []).slice(1)] };
    if (urlChanged) Object.assign(updated, { canonicalUrl: null, currentPrice: null, thumbnail: null,
      inStock: null, lastChecked: null, lastObserved: null, checkStatus: null, lastError: null,
      initialPrice: null, lowestPrice: null, highestPrice: null });
  }
  checkSyncQuota({ ...(await chrome.storage.sync.get(null)), [`p_${id}`]: updated }, chrome.storage.sync);
  await saveProduct(updated);
  await syncAlarm(updated);
  await updateBadge();
  triggerGistSync();
  return { product: updated };
}

async function handleDeleteProduct(id) {
  const undo = await deleteWithUndo(id);
  await clearAlarm(id); await updateBadge(); triggerGistSync();
  return { ok: true, undo };
}

async function handleCheckNow(id) {
  const found = await withMutation(async () => {
    const product = await getProduct(id);
    if (!product) return false;
    const sources = (product.sources ?? []).map((s) => ({ ...s, consecutiveNulls: 0 }));
    const updated = { ...product, lastNotified: null, consecutiveErrors: 0, enabled: true, disabledReason: null, sources };
    await saveProduct(updated);
    await syncAlarm(updated);
    return true;
  });
  if (!found) return { error: 'Product not found' };
  await checkProduct(id);
  return { ok: true };
}

async function handleCheckAll() {
  const products = await getProducts();
  const enabled = Object.values(products).filter((p) => p.enabled);
  // Run sequentially so only one background tab is open at a time.
  // Concurrent checks race on shared chrome.tabs/scripting APIs and flood the tab bar.
  for (const p of enabled) await checkProduct(p.id);
  return { ok: true, count: enabled.length };
}

async function handlePauseAll() {
  const products = await getProducts();
  const entries = Object.values(products);
  // Batch all writes into a single sync set to avoid quota limits
  const batch = {};
  for (const p of entries) batch[`p_${p.id}`] = { ...p, enabled: false, disabledReason: null };
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
  for (const p of entries) batch[`p_${p.id}`] = { ...p, enabled: true, disabledReason: null };
  await chrome.storage.sync.set(batch);
  await Promise.all(entries.map((p) => syncAlarm({ ...p, enabled: true, disabledReason: null })));
  await updateBadge();
  return { ok: true };
}

async function handleImportUrls(urls) {
  for (const url of urls) requireWebUrl(url);
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
  requireWebUrl(url);
  const product = await getProduct(productId);
  if (!product) return { error: 'Product not found' };
  const withSources = ensureSources(product);
  const withoutFragment = (value) => {
    try { const parsed = new URL(value); parsed.hash = ''; return parsed.href; } catch { return null; }
  };
  const normalized = withoutFragment(url);
  if (withSources.sources.some((s) => [s.url, s.canonicalUrl].some((value) => value && withoutFragment(value) === normalized))) return { error: 'already_added' };
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
  if (product.bestSourceId === sourceId) Object.assign(updated, {
    lastObserved: null, checkStatus: 'no_price', canonicalUrl: null, inStock: null,
  });
  await saveProduct(updated);
  await updateBadge();
  if (product.enabled) checkProduct(productId).catch((err) => console.error('[PriceWatch] source removal check failed:', err.message));
  return { product: updated };
}

async function startSourceRepair(msg) {
  const product = await getProduct(msg.productId);
  const source = msg.sourceId ? product?.sources?.find((s) => s.id === msg.sourceId) : product?.sources?.[0];
  const url = source?.url ?? (!msg.sourceId ? product?.url : null);
  if (!url) throw new Error('Product or source no longer exists.');
  requireWebUrl(url);
  let token;
  try {
    const tabs = await chrome.tabs.query({});
    const found = tabs.find((tab) => tab.url === url);
    const tab = found ? await chrome.tabs.update(found.id, { active: true }) : await chrome.tabs.create({ url, active: true });
    if (tab.status !== 'complete') await waitForRepairTab(tab.id);
    const prepared = await withMutation(() => prepareRepair({ ...msg, tabId: tab.id, sourceUrl: url, allowRedirect: true }));
    token = prepared.session.token;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (value) => { window.__priceWatchRepairToken = value; }, args: [token] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/picker.js'] });
    return { ok: true };
  } catch (err) {
    await withMutation(async () => {
      const { _repairSession: session } = await chrome.storage.local.get('_repairSession');
      if (token && session?.token === token) await chrome.storage.local.remove('_repairSession');
      await chrome.storage.local.set({ _repairNotice: { productId: msg.productId, text: `Repair could not start: ${err.message}` } });
    });
    throw err;
  }
}
function waitForRepairTab(tabId) {
  return new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); chrome.tabs.onRemoved.removeListener(removed); error ? reject(error) : resolve(); };
    const listener = (id, changes) => { if (id === tabId && changes.status === 'complete') finish(); };
    const removed = (id) => { if (id === tabId) finish(new Error('Source tab was closed.')); };
    const timer = setTimeout(() => finish(new Error('Source page took too long to load.')), 30000);
    chrome.tabs.onUpdated.addListener(listener); chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') finish(); }).catch(finish);
  });
}

async function prepareRepair(msg) {
  const original = await getProduct(msg.productId);
  if (!original) throw new Error('Product no longer exists.');
  const product = ensureSources(original);
  const source = msg.sourceId ? product.sources.find((s) => s.id === msg.sourceId) : product.sources[0];
  if (!source) throw new Error('Source no longer exists.');
  requireWebUrl(source.url);
  const tab = await chrome.tabs.get(msg.tabId);
  if (!tab?.id || (!msg.allowRedirect && tab.url !== source.url) ||
      (msg.allowRedirect && msg.sourceUrl !== source.url)) throw new Error('Open the source page before starting repair.');
  requireWebUrl(tab.url);
  await saveProduct(product);
  const session = { token: generateId(), productId: product.id, sourceId: source.id,
    url: source.url, pageUrl: tab.url, selector: source.selectors?.price ?? null, tabId: tab.id, expiresAt: Date.now() + 10 * 60000 };
  await chrome.storage.local.set({ _repairSession: session });
  return { session };
}

async function handlePickerResult(msg, sender) {
  if (!msg.repairToken) {
    if (msg.selector) await chrome.storage.local.set({ _pickerResult: msg.selector });
    return { ok: true };
  }
  const { _repairSession: session } = await chrome.storage.local.get('_repairSession');
  if (!session || session.token !== msg.repairToken || sender.tab?.id !== session.tabId ||
      sender.tab?.url !== (session.pageUrl ?? session.url) || session.expiresAt <= Date.now()) throw new Error('Repair session expired or the page changed. Try repair again.');
  if (msg.cancelled || !msg.selector) {
    await chrome.storage.local.remove('_repairSession');
    await chrome.storage.local.set({ _repairNotice: { productId: session.productId, text: 'Selector repair cancelled.' } });
    return { ok: true };
  }
  const product = await getProduct(session.productId);
  const source = product?.sources?.find((s) => s.id === session.sourceId);
  if (!source || source.url !== session.url || (source.selectors?.price ?? null) !== session.selector) {
    await chrome.storage.local.remove('_repairSession');
    throw new Error('This source changed while the picker was open. Try repair again.');
  }
  if (typeof msg.selector !== 'string' || msg.selector.length > 1000) throw new Error('The selected price selector is invalid.');
  const repaired = { ...source, selectors: { ...source.selectors, price: msg.selector },
    consecutiveErrors: 0, consecutiveNulls: 0, checkStatus: 'no_price', lastError: null, requiresTabExtraction: false };
  const sources = product.sources.map((s) => s.id === source.id ? repaired : s);
  const updated = { ...product, sources, checkStatus: 'no_price', lastError: null, disabledReason: null,
    ...(sources[0].id === source.id ? { selectors: repaired.selectors } : {}) };
  checkSyncQuota({ ...(await chrome.storage.sync.get(null)), [`p_${product.id}`]: updated }, chrome.storage.sync);
  await saveProduct(updated);
  await chrome.storage.local.remove('_repairSession');
  await chrome.storage.local.set({ _repairNotice: { productId: product.id, text: product.enabled ? 'Selector saved. Checking the updated source…' : 'Selector saved. Tracking remains paused.' } });
  if (product.enabled) checkProduct(product.id).catch((err) => console.error('[PriceWatch] repair check failed:', err.message));
  triggerGistSync();
  return { ok: true };
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
