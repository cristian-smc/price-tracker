/** Shared watchlist invariants; no Chrome or DOM dependencies. */
export function normalizeCurrency(value) {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}
export function referenceCurrency(product) {
  return normalizeCurrency(product.referenceCurrency) ?? normalizeCurrency(product.currency) ?? 'USD';
}
export function normalizeOrganization({ group = '', tags = [] } = {}) {
  if (typeof group !== 'string' || !Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('Group and tags must be text.');
  group = group.trim();
  if ([...group].length > 40) throw new Error('Group must be 40 characters or fewer.');
  const unique = new Map();
  for (const raw of tags) {
    const tag = raw.trim();
    if ([...tag].length > 32) throw new Error('Each tag must be 32 characters or fewer.');
    if (tag && !unique.has(tag.toLowerCase())) unique.set(tag.toLowerCase(), tag);
  }
  if (unique.size > 8) throw new Error('Use up to 8 tags per product.');
  return { group, tags: [...unique.values()] };
}
export function trackingHealth(record, intervalMinutes = 15, enabled = true, now = Date.now()) {
  if (record.disabledReason === 'errors') return { state: 'repair', label: 'Checks paused', detail: 'Tracking stopped after repeated failures. Resume to retry automatic price detection.' };
  if (!enabled) return { state: 'paused', label: 'Paused', detail: 'Automatic checks are paused.' };
  if (record.checkStatus === 'error') return { state: 'repair', label: 'Check failed', detail: record.lastError || 'The latest check failed. The displayed price may be old.' };
  if (record.checkStatus === 'no_price') return { state: 'repair', label: 'Price unavailable', detail: 'The latest check found no price. Price detection retries automatically on the next scheduled check.' };
  if (record.checkStatus === 'currency_mismatch') return { state: 'mismatch', label: 'Different currency', detail: 'No fresh source price matches the watch currency. Other currencies are not compared.' };
  if (!record.lastObserved) return record.currentPrice != null
    ? { state: 'unknown', label: 'Freshness unknown', detail: 'This saved price has no verified observation time. Run a check to refresh it.' }
    : { state: 'pending', label: 'Not checked', detail: 'Waiting for the first price observation.' };
  if (now - record.lastObserved > Math.max(2 * intervalMinutes, 15) * 60000) return { state: 'stale', label: 'Stale price', detail: 'No recent successful observation. The displayed price may be old.' };
  return { state: 'healthy', label: 'Up to date', detail: 'A price was successfully observed within the expected interval.' };
}
export function isComparablePrice(product, now = Date.now()) {
  if (product.currentPrice == null || normalizeCurrency(product.currency) !== referenceCurrency(product)) return false;
  // Legacy values stay visible but cannot qualify as fresh alerts without evidence.
  if (!product.lastObserved || product.checkStatus !== 'ok') return false;
  return now - product.lastObserved <= Math.max(2 * (product.intervalMinutes ?? 15), 15) * 60000;
}
export function compareWatchPrices(a, b) {
  const currencyOrder = referenceCurrency(a).localeCompare(referenceCurrency(b));
  if (currencyOrder) return currencyOrder;
  const price = (p) => normalizeCurrency(p.currency) === referenceCurrency(p) ? p.currentPrice ?? Infinity : Infinity;
  return price(a) - price(b);
}
export function companionProduct(product) {
  const source = product.sources?.find((s) => s.id === product.bestSourceId) ?? product.sources?.[0];
  return { id: product.id, name: product.name, url: source?.canonicalUrl ?? source?.url ?? product.canonicalUrl ?? product.url,
    targetPrice: product.targetPrice ?? null, currency: referenceCurrency(product), referenceCurrency: referenceCurrency(product),
    enabled: product.enabled, intervalMinutes: product.intervalMinutes,
    priceSelector: source?.selectors?.price ?? product.selectors?.price ?? null };
}
export function trustedHistory(product, points) {
  const currency = referenceCurrency(product);
  return points.filter((point) => point.currency === currency);
}
