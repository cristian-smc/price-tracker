/**
 * Orchestrates a full price-check cycle for a single product.
 *
 * Multi-source support: a product can have multiple source URLs.
 * All sources are checked on each alarm; the best price (lowest) wins.
 * Legacy products (no sources array) are migrated lazily on first check.
 */

import { getProduct, saveProduct, withMutation, getDataGeneration } from '../shared/storage.js';
import { fetchAndExtract } from './fetcher.js';
import { tabFetchAndExtract } from './tab-fetcher.js';
import { recordObservation } from './history-manager.js';
import { maybeNotify } from './notifier.js';
import { updateBadge } from './badge-manager.js';
import { generateId } from '../shared/utils.js';
import { DRIFT_STRIKE_LIMIT, AUTO_DISABLE_ERROR_LIMIT } from '../shared/constants.js';
import { referenceCurrency, normalizeCurrency } from '../shared/product-state.js';

const inFlight = new Map();

export async function checkProduct(productId) {
  const generation = getDataGeneration();
  const product = await getProduct(productId);
  if (!product?.enabled) return;
  const key = `${generation}:${productId}`;
  const config = extractionConfig(product);
  const existing = inFlight.get(key);
  if (existing) {
    if (existing.config === config) return existing.promise;
    // Source edits need a successor, not the old check whose result is discarded.
    await existing.promise.catch(() => {});
    return checkProduct(productId);
  }
  const checking = runCheck(productId, generation).finally(() => inFlight.delete(key));
  inFlight.set(key, { config, promise: checking });
  return checking;
}

function extractionConfig(product) {
  const sources = product.sources?.length ? product.sources : [{
    url: product.url, selectors: product.selectors, requiresTabExtraction: product.requiresTabExtraction,
  }];
  return JSON.stringify({ reference: referenceCurrency(product), sources: sources.map((s) => ({
    id: s.id ?? null, url: s.url, selector: s.selectors?.price ?? null,
    requiresTabExtraction: s.requiresTabExtraction ?? false,
  })) });
}

async function runCheck(productId, generation) {
  const original = await getProduct(productId);
  if (original?.enabled !== true) return;
  const config = extractionConfig(original);
  const product = ensureSources(original);
  const updatedSources = [];
  for (const source of product.sources) updatedSources.push(await checkOneSource(source));
  const anySucceeded = updatedSources.some((s) => s.checkStatus === 'ok');

  const accepted = await withMutation(async () => {
    const current = await getProduct(productId);
    if (generation !== getDataGeneration() || !current?.enabled || extractionConfig(current) !== config) return null;
    let reference = referenceCurrency(current);
    if (!current.referenceCurrency && current.currentPrice == null && current.targetPrice == null &&
        current.sellThreshold == null && current.initialPrice == null && updatedSources[0]?.checkStatus === 'ok') {
      reference = normalizeCurrency(updatedSources[0].currency) ?? reference;
    }
    const bestSource = pickBestSource(updatedSources, reference);
    if (!bestSource) {
      const allErrored = updatedSources.every((s) => s.checkStatus === 'error');
      const consecutiveErrors = allErrored ? (current.consecutiveErrors ?? 0) + 1 : 0;
      const disabled = consecutiveErrors >= AUTO_DISABLE_ERROR_LIMIT;
      await saveProduct({ ...current, referenceCurrency: current.referenceCurrency ?? (current.currentPrice != null || current.targetPrice != null || current.sellThreshold != null ? reference : null), sources: updatedSources, bestSourceId: null,
        consecutiveErrors, enabled: !disabled, disabledReason: disabled ? 'errors' : null,
        checkStatus: anySucceeded ? 'currency_mismatch' : allErrored ? 'error' : 'no_price',
        lastError: allErrored ? updatedSources[0]?.lastError : null, lastChecked: Date.now() });
      return null;
    }
    const newPrice = bestSource.currentPrice;
    const baseline = current.statsCurrency === reference ? current : { ...current, initialPrice: null, lowestPrice: null, highestPrice: null };
    const updated = { ...current, sources: updatedSources, referenceCurrency: reference,
      bestSourceId: bestSource.id, url: updatedSources[0]?.url ?? current.url,
      canonicalUrl: bestSource.canonicalUrl ?? current.canonicalUrl,
      currentPrice: newPrice, currency: reference, statsCurrency: reference,
      thumbnail: bestSource.thumbnail ?? current.thumbnail, inStock: bestSource.inStock ?? null,
      lastChecked: Date.now(), lastObserved: bestSource.lastObserved, checkStatus: 'ok', lastError: null,
      disabledReason: null, consecutiveErrors: 0, consecutiveNulls: 0,
      ...computePriceFields(baseline, newPrice) };
    await saveProduct(updated);
    await recordObservation(productId, { price: newPrice, currency: reference });
    return { product: updated, previousPrice: current.currentPrice, previousInStock: current.inStock ?? null };
  });

  if (accepted && generation === getDataGeneration()) {
    const current = await getProduct(productId);
    if (current?.enabled && current.lastChecked === accepted.product.lastChecked &&
        extractionConfig(current) === extractionConfig(accepted.product)) {
      const notifId = await maybeNotify(current, accepted.previousPrice, accepted.previousInStock, (latest) =>
        generation === getDataGeneration() && latest.lastChecked === accepted.product.lastChecked &&
        extractionConfig(latest) === extractionConfig(accepted.product));
      if (notifId) await withMutation(async () => {
        const latest = await getProduct(productId);
        if (latest && generation === getDataGeneration()) await saveProduct({ ...latest, lastNotified: Date.now() });
      });
    }
  }
  await updateBadge();
}

// ── Source migration ──────────────────────────────────────────────────────────

/**
 * Wraps a legacy product (no sources) into the multi-source shape.
 * Exported for use in service-worker ADD_SOURCE handler.
 * @param {import('../shared/types').Product} product
 */
export function ensureSources(product) {
  if (product.sources?.length) return product;
  const source = {
    id: generateId(),
    url: product.url,
    canonicalUrl: product.canonicalUrl ?? null,
    label: hostnameOf(product.url),
    selectors: { price: product.selectors?.price ?? null },
    requiresTabExtraction: product.requiresTabExtraction ?? false,
    currentPrice: product.currentPrice,
    currency: product.currency ?? null,
    thumbnail: product.thumbnail ?? null,
    lastChecked: product.lastChecked ?? null,
    consecutiveErrors: product.consecutiveErrors ?? 0,
    consecutiveNulls: product.consecutiveNulls ?? 0,
  };
  return { ...product, sources: [source], bestSourceId: source.id };
}

// ── Per-source check ──────────────────────────────────────────────────────────

async function checkOneSource(source) {
  const target = {
    url: source.url,
    canonicalUrl: source.canonicalUrl,
    selectors: source.selectors ?? { price: null },
    requiresTabExtraction: source.requiresTabExtraction ?? false,
    // True only on the first attempt when we've never extracted a price — used by
    // doFetch to trigger a one-shot tab discovery for dynamic sites (e.g. Google
    // Flights) whose raw HTML fetch won't contain prices regardless of SPA detection.
    neverExtracted: source.currentPrice == null && (source.consecutiveNulls ?? 0) === 0,
  };

  let result = await doFetch(target);
  let autoDetected = Boolean(target.selectors?.price && result.price != null && result.strategy !== 1);
  if (result.price == null && !result.error && target.selectors?.price) {
    // One bounded recovery attempt, not a loop: rediscover after selector drift.
    // Never treat network blocking as a selector problem or change paused state.
    const recovered = await doFetch({ ...target, selectors: { price: null } });
    if (recovered.price != null && !recovered.error) { result = recovered; autoDetected = true; }
  }

  if (result.error) {
    return {
      ...source,
      consecutiveErrors: (source.consecutiveErrors ?? 0) + 1,
      lastChecked: Date.now(), checkStatus: 'error', lastError: String(result.error).slice(0, 160),
    };
  }

  const selectorSource = autoDetected ? { ...source, selectors: { ...source.selectors, price: null } } : source;
  const { selectors, consecutiveNulls } = resolveSelectorsForSource(selectorSource, result);

  return {
    ...source,
    canonicalUrl: result.canonicalUrl ?? source.canonicalUrl,
    selectors,
    requiresTabExtraction: result.requiresTabExtraction ?? source.requiresTabExtraction,
    currentPrice: result.price ?? source.currentPrice,
    currency: result.price != null ? normalizeCurrency(result.currency) : source.currency,
    thumbnail: result.thumbnail ?? source.thumbnail,
    inStock: result.inStock ?? null,
    lastChecked: Date.now(),
    lastObserved: result.price != null ? Date.now() : source.lastObserved ?? null,
    checkStatus: result.price != null ? 'ok' : 'no_price', lastError: null,
    consecutiveErrors: 0,
    consecutiveNulls,
  };
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function doFetch(target) {
  // Always attempt the cheap HTTP path first — even when requiresTabExtraction is
  // stored on the source. This auto-clears stale flags (set by old discovery logic)
  // for server-rendered sites, and avoids opening a tab unless truly necessary.
  // Pass requiresTabExtraction:false so fetchAndExtract doesn't short-circuit.
  const result = await fetchAndExtract({ ...target, requiresTabExtraction: false });

  // HTTP found a price — done, no tab needed. Return with flag cleared.
  if (result.price !== null) {
    return { ...result, requiresTabExtraction: false };
  }

  // Open a tab only when the response proves a real browser is required:
  // • fetchAndExtract detected an SPA shell (looksLikeSpa), or
  // • HTTP errored on a source already confirmed to need a browser.
  if (result.requiresTabExtraction || (result.error && target.requiresTabExtraction)) {
    return tabFetchAndExtract({ ...target, requiresTabExtraction: true });
  }

  return result;
}

// ── Selector drift ────────────────────────────────────────────────────────────

function resolveSelectorsForSource(source, result) {
  let selectors = { ...source.selectors };
  let consecutiveNulls = source.consecutiveNulls ?? 0;

  if (result.price === null) {
    consecutiveNulls += 1;
    if (consecutiveNulls >= DRIFT_STRIKE_LIMIT) {
      selectors = { price: null };
      consecutiveNulls = 0;
    }
  } else {
    consecutiveNulls = 0;
    if (result.selectorUsed && result.selectorUsed !== '_text_scan' && result.strategy === 4 && selectors.price == null) {
      selectors.price = result.selectorUsed;
    }
  }
  return { selectors, consecutiveNulls };
}

// ── Best source selection ─────────────────────────────────────────────────────

function pickBestSource(sources, reference) {
  const withPrice = sources.filter((s) => s.currentPrice != null && s.checkStatus === 'ok' && normalizeCurrency(s.currency) === reference);
  if (withPrice.length === 0) return null;

  const lowest = (arr) => arr.reduce((best, s) => s.currentPrice < best.currentPrice ? s : best);

  // Prefer confirmed in-stock, then unknown, then OOS as last resort
  const inStock  = withPrice.filter((s) => s.inStock === true);
  if (inStock.length > 0)  return lowest(inStock);

  const unknown  = withPrice.filter((s) => s.inStock == null);
  if (unknown.length > 0)  return lowest(unknown);

  return lowest(withPrice); // all OOS — still surface the lowest price
}

// ── Price stats ───────────────────────────────────────────────────────────────

function computePriceFields(product, newPrice) {
  const initialPrice = product.initialPrice ?? newPrice;
  const lowestPrice  = newPrice == null ? product.lowestPrice  : Math.min(newPrice, product.lowestPrice  ?? newPrice);
  const highestPrice = newPrice == null ? product.highestPrice : Math.max(newPrice, product.highestPrice ?? newPrice);
  return { initialPrice, lowestPrice, highestPrice };
}

// ── History recording ─────────────────────────────────────────────────────────

async function maybeRecord(productId, newPrice) {
  if (newPrice == null) return;
  await recordObservation(productId, { price: newPrice });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}
