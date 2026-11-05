/** Pure validation/normalization for current and explicitly recognized legacy backups. */
import { normalizeOrganization, normalizeCurrency } from './product-state.js';
const object = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
function invalid(detail) { throw new Error(`Invalid backup: ${detail}`); }
const safeKey = (key) => !['__proto__', 'constructor', 'prototype'].includes(key);
function webUrl(value) {
  try { return typeof value === 'string' && ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}
function validateProduct(product, id) {
  if (!object(product) || product.id !== id || typeof product.name !== 'string' || !webUrl(product.url)) invalid('product record');
  if (product.enabled != null && typeof product.enabled !== 'boolean') invalid('product enabled flag');
  for (const field of ['currentPrice', 'targetPrice', 'sellThreshold', 'initialPrice', 'lowestPrice', 'highestPrice']) {
    if (product[field] != null && (!Number.isSafeInteger(product[field]) || product[field] < 0)) invalid('product price');
  }
  if (product.intervalMinutes != null && (!Number.isFinite(product.intervalMinutes) || product.intervalMinutes <= 0)) invalid('check interval');
  if (product.sources != null) {
    if (!Array.isArray(product.sources)) invalid('sources');
    const ids = new Set();
    for (const source of product.sources) {
      if (!object(source) || typeof source.id !== 'string' || !source.id || ids.has(source.id) || !webUrl(source.url)) invalid('source record');
      ids.add(source.id);
      if (source.currentPrice != null && (!Number.isSafeInteger(source.currentPrice) || source.currentPrice < 0)) invalid('source price');
      validateSelectors(source.selectors);
    }
  }
  validateSelectors(product.selectors);
  try { normalizeOrganization(product); } catch { invalid('group or tags'); }
  if (product.referenceCurrency != null && !normalizeCurrency(product.referenceCurrency)) invalid('reference currency');
  if (product.lastObserved != null && (!Number.isFinite(product.lastObserved) || product.lastObserved < 0)) invalid('observation time');
}
function validateSelectors(selectors) {
  if (selectors != null && (!object(selectors) || (selectors.price != null && typeof selectors.price !== 'string'))) invalid('price selector');
}
function validateArea(area) {
  if (!object(area)) invalid('storage area must be an object');
  for (const [key, value] of Object.entries(area)) {
    if (!safeKey(key)) invalid('reserved storage key');
    if (key.startsWith('p_')) validateProduct(value, key.slice(2));
    if (key === 'settings') {
      if (!object(value)) invalid('settings');
      if (value.defaultCurrency != null && !/^[A-Z]{3}$/.test(value.defaultCurrency)) invalid('default currency');
      if (value.defaultInterval != null && (!Number.isFinite(value.defaultInterval) || value.defaultInterval <= 0)) invalid('default interval');
      if (value.historyMaxPoints != null && (!Number.isSafeInteger(value.historyMaxPoints) || value.historyMaxPoints < 1 || value.historyMaxPoints > 5000)) invalid('history limit');
      if (value.dailyDigestHour != null && (!Number.isInteger(value.dailyDigestHour) || value.dailyDigestHour < 0 || value.dailyDigestHour > 23)) invalid('digest hour');
      for (const field of ['notificationsEnabled', 'soundEnabled', 'dailyDigestEnabled']) {
        if (value[field] != null && typeof value[field] !== 'boolean') invalid('settings flag');
      }
      for (const field of ['theme', 'sortBy', 'filterBy', 'mobilePushUrl', 'affiliateAmazonTag', 'affiliateSkimlinksId', 'gistToken', 'gistId']) {
        if (value[field] != null && typeof value[field] !== 'string') invalid('settings text');
      }
    }
    if (key.startsWith('history_')) {
      if (!object(value) || value.productId !== key.slice(8) || !Array.isArray(value.points)) invalid('history record');
      for (const point of value.points) {
        if (!object(point) || !Number.isFinite(point.ts) || point.ts < 0 || !Number.isSafeInteger(point.price) || point.price < 0) invalid('history point');
      }
    }
  }
}
export function validateBackup(data) {
  if (!object(data)) invalid('expected a snapshot object');
  let normalized;
  if ('sync' in data || 'local' in data) {
    if (!object(data.sync) || !object(data.local)) invalid('snapshot requires sync and local objects');
    normalized = { sync: data.sync, local: data.local, legacy: false };
  } else if (object(data.products)) {
    const sync = {};
    for (const [id, product] of Object.entries(data.products)) {
      if (!safeKey(id)) invalid('product id');
      validateProduct(product, id); sync[`p_${id}`] = product;
    }
    if ('settings' in data) sync.settings = data.settings;
    const { products: _products, settings: _settings, ...local } = data;
    normalized = { sync, local, legacy: true };
  } else invalid('unrecognized snapshot format');
  validateArea(normalized.sync); validateArea(normalized.local);
  return normalized;
}
export function backupSummary(data) {
  const snapshot = validateBackup(data);
  return { products: Object.keys(snapshot.sync).filter((k) => k.startsWith('p_')).length,
    history: Object.keys(snapshot.local).filter((k) => k.startsWith('history_')).length, legacy: snapshot.legacy };
}
export function checkSyncQuota(data, area) {
  const entries = Object.entries(data);
  if (entries.length > (area.MAX_ITEMS ?? 512)) throw new Error('Backup exceeds sync item quota');
  let bytes = 0;
  const byteLength = (text) => new TextEncoder().encode(text).length;
  for (const [key, value] of entries) {
    const itemBytes = byteLength(key) + byteLength(JSON.stringify(value));
    if (itemBytes > (area.QUOTA_BYTES_PER_ITEM ?? 8192)) throw new Error('Backup sync entry is too large');
    bytes += itemBytes;
  }
  if (bytes > (area.QUOTA_BYTES ?? 102400)) throw new Error('Backup exceeds sync byte quota');
}
