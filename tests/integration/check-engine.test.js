/**
 * Integration tests for the check-engine cycle.
 * Uses manual mocks for chrome.* APIs and the fetcher.
 *
 * Run with: npx jest tests/integration/check-engine.test.js
 */

import { jest } from '@jest/globals';
import { TextEncoder } from 'node:util';
global.TextEncoder = TextEncoder;

// ── Chrome API mock ───────────────────────────────────────────────────────────
// Products/settings live in chrome.storage.sync, history in chrome.storage.local
// (see src/shared/storage.js) — both need their own backing store.

const syncData = {};
const localData = {};

function makeStorageArea(store) {
  return {
    get: jest.fn(async (keys) => {
      if (keys === null || keys === undefined) return { ...store };
      const result = {};
      const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      for (const k of ks) result[k] = store[k];
      return result;
    }),
    set: jest.fn(async (items) => { Object.assign(store, items); }),
    remove: jest.fn(async (keys) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete store[k];
    }),
    clear: jest.fn(async () => { for (const k of Object.keys(store)) delete store[k]; }),
  };
}

global.chrome = {
  storage: {
    sync: makeStorageArea(syncData),
    local: makeStorageArea(localData),
  },
  notifications: {
    create: jest.fn(async () => {}),
  },
  action: {
    setBadgeText: jest.fn(async () => {}),
    setBadgeBackgroundColor: jest.fn(async () => {}),
  },
  runtime: {
    getURL: (p) => `chrome-extension://test/${p}`,
    sendMessage: jest.fn(async () => {}),
  },
};

// ── Mock fetcher ──────────────────────────────────────────────────────────────
// Native ESM (no babel transform) doesn't hoist jest.mock() above static
// imports, so fetcher.js's real module-level `chrome.runtime.getURL()` call
// would run before the mock registers. unstable_mockModule + dynamic import
// (both after the chrome global above is set up) avoids that ordering issue.

jest.unstable_mockModule('../../src/background/fetcher.js', () => ({
  fetchAndExtract: jest.fn(),
}));
jest.unstable_mockModule('../../src/background/tab-fetcher.js', () => ({
  tabFetchAndExtract: jest.fn(),
}));

const { fetchAndExtract } = await import('../../src/background/fetcher.js');
const { checkProduct } = await import('../../src/background/check-engine.js');
const { saveProduct, getProduct, getHistory, deleteProduct } = await import('../../src/shared/storage.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProduct(overrides = {}) {
  return {
    id: 'test-product-1',
    url: 'https://example.com/product',
    name: 'Test Widget',
    targetPrice: 5000,       // $50.00
    currency: 'USD',
    intervalMinutes: 15,
    enabled: true,
    selectors: { price: null },
    requiresTabExtraction: false,
    currentPrice: 7000,      // $70.00
    inStock: true,
    lastChecked: null,
    lastNotified: null,
    consecutiveErrors: 0,
    consecutiveNulls: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Result shape returned by fetchAndExtract()/tabFetchAndExtract() (see fetcher.js). */
function makeFetchResult(overrides = {}) {
  return {
    price: null, currency: null, strategy: null, selectorUsed: null,
    thumbnail: null, inStock: null, requiresTabExtraction: false,
    canonicalUrl: null, error: null,
    ...overrides,
  };
}

async function setSettings(patch) {
  await chrome.storage.sync.set({ settings: { notificationsEnabled: true, historyMaxPoints: 500, ...patch } });
}

beforeEach(async () => {
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  jest.clearAllMocks();
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkProduct', () => {
  test.each(['delete', 'pause', 'preferences', 'url', 'selector', 'source'])('pending check preserves %s changes', async (change) => {
    const product = makeProduct({ sources: [{
      id: 's1', url: 'https://example.com/product', selectors: { price: '.old' },
      currentPrice: 7000, currency: 'USD', consecutiveErrors: 0,
    }] });
    await saveProduct(product);
    const started = deferred();
    const result = deferred();
    fetchAndExtract.mockImplementation(() => { started.resolve(); return result.promise; });
    const checking = checkProduct(product.id);
    await started.promise;
    if (change === 'delete') await deleteProduct(product.id);
    else {
      const patch = change === 'pause' ? { enabled: false }
        : change === 'preferences' ? { name: 'Edited', targetPrice: 1000, notificationEnabled: false }
        : change === 'url' ? { sources: [{ ...product.sources[0], url: 'https://other.example/new' }] }
        : change === 'selector' ? { sources: [{ ...product.sources[0], selectors: { price: '.new' } }] }
        : { sources: [...product.sources, { id: 's2', url: 'https://other.example/second' }] };
      await saveProduct({ ...product, ...patch });
    }
    result.resolve(makeFetchResult({ price: 4500, currency: 'USD', inStock: true }));
    await checking;
    const saved = await getProduct(product.id);
    if (change === 'delete') expect(saved).toBeNull();
    else if (change === 'pause') expect(saved.enabled).toBe(false);
    else if (change === 'preferences') {
      expect(saved).toMatchObject({ name: 'Edited', targetPrice: 1000, notificationEnabled: false, currentPrice: 4500 });
    } else {
      expect(saved.currentPrice).toBe(7000);
      if (change === 'url') expect(saved.sources[0].url).toBe('https://other.example/new');
      if (change === 'selector') expect(saved.sources[0].selectors.price).toBe('.new');
      if (change === 'source') expect(saved.sources).toHaveLength(2);
    }
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    if (change !== 'preferences') expect(await getHistory(product.id)).toEqual([]);
  });

  test.each(['delete', 'pause', 'target', 'restore'])('notification preparation rechecks %s before dispatch', async (change) => {
    const product = makeProduct(); await saveProduct(product);
    fetchAndExtract.mockResolvedValue(makeFetchResult({ price: 4500, currency: 'USD', inStock: true }));
    const started = deferred(); const settings = deferred();
    const originalGet = chrome.storage.sync.get.getMockImplementation();
    let settingsReads = 0;
    chrome.storage.sync.get.mockImplementation(async (keys) => {
      if (keys === 'settings' && ++settingsReads === 2) {
        started.resolve(); return settings.promise;
      }
      return originalGet(keys);
    });
    const checking = checkProduct(product.id); await started.promise;
    if (change === 'delete') await deleteProduct(product.id);
    else if (change === 'pause') await saveProduct({ ...(await getProduct(product.id)), enabled: false });
    else if (change === 'target') await saveProduct({ ...(await getProduct(product.id)), targetPrice: 1000 });
    else { const { invalidateChecks } = await import('../../src/shared/storage.js'); invalidateChecks(); }
    chrome.storage.sync.get.mockImplementation(originalGet);
    settings.resolve({ settings: { notificationsEnabled: true } }); await checking;
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('restoring data invalidates a pending observation', async () => {
    const product = makeProduct(); await saveProduct(product);
    const started = deferred(); const result = deferred();
    fetchAndExtract.mockImplementation(() => { started.resolve(); return result.promise; });
    const checking = checkProduct(product.id); await started.promise;
    const { importAll } = await import('../../src/shared/storage.js');
    await importAll({ sync: { [`p_${product.id}`]: { ...product, name: 'Restored', currentPrice: 9000 } }, local: {} });
    result.resolve(makeFetchResult({ price: 4500, currency: 'USD', inStock: true })); await checking;
    expect(await getProduct(product.id)).toMatchObject({ name: 'Restored', currentPrice: 9000 });
    expect(await getHistory(product.id)).toEqual([]);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('check after source edit runs one successor using saved configuration', async () => {
    const product = makeProduct({ sources: [{ id: 's1', url: 'https://example.com/old', selectors: { price: '.old' }, currentPrice: 7000 }] });
    await saveProduct(product);
    const started = deferred(); const oldResult = deferred();
    const calls = [];
    fetchAndExtract.mockImplementation((target) => {
      calls.push(target);
      if (calls.length === 1) { started.resolve(); return oldResult.promise; }
      return Promise.resolve(makeFetchResult({ price: 6000, currency: 'USD' }));
    });
    const first = checkProduct(product.id); await started.promise;
    await saveProduct({ ...product, sources: [{ ...product.sources[0], url: 'https://example.com/new', selectors: { price: '.new' } }] });
    const next = checkProduct(product.id); const duplicate = checkProduct(product.id);
    oldResult.resolve(makeFetchResult({ price: 4500, currency: 'USD' }));
    await Promise.all([first, next, duplicate]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ url: 'https://example.com/new', selectors: { price: '.new' } });
    expect((await getProduct(product.id)).currentPrice).toBe(6000);
  });

  test('mixed source currencies never compete or rewrite target units', async () => {
    const product = makeProduct({ referenceCurrency: 'USD', sources: [
      { id:'usd',url:'https://example.com/us',selectors:{price:null},currentPrice:7000,currency:'USD' },
      { id:'eur',url:'https://example.com/eu',selectors:{price:null},currentPrice:100,currency:'EUR' },
    ] });
    await saveProduct(product);
    fetchAndExtract.mockImplementation(async (target) => makeFetchResult({ price: target.url.endsWith('/us') ? 6000 : 100, currency: target.url.endsWith('/us') ? 'USD' : 'EUR', inStock:true }));
    await checkProduct(product.id);
    const saved = await getProduct(product.id);
    expect(saved).toMatchObject({ currentPrice:6000,currency:'USD',referenceCurrency:'USD',targetPrice:5000,bestSourceId:'usd',checkStatus:'ok' });
    expect((await getHistory(product.id))[0]).toMatchObject({ price:6000,currency:'USD' });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('initial failed discovery does not lock fallback currency', async()=>{
    const product=makeProduct({currentPrice:null,targetPrice:null,currency:'USD',sources:[],initialPrice:null}); await saveProduct(product);
    fetchAndExtract.mockResolvedValueOnce(makeFetchResult()).mockResolvedValueOnce(makeFetchResult({price:2500,currency:'EUR'}));
    await checkProduct(product.id); expect((await getProduct(product.id)).referenceCurrency).toBeNull();
    await checkProduct(product.id); expect(await getProduct(product.id)).toMatchObject({referenceCurrency:'EUR',currency:'EUR',currentPrice:2500});
  });

  test('null extraction keeps cached amount but never advances observation or history', async () => {
    const product = makeProduct({lastObserved:100,checkStatus:'ok'}); await saveProduct(product);
    fetchAndExtract.mockResolvedValue(makeFetchResult()); await checkProduct(product.id);
    expect(await getProduct(product.id)).toMatchObject({currentPrice:7000,lastObserved:100,checkStatus:'no_price'});
    expect(await getHistory(product.id)).toEqual([]); expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('only foreign currency result is shown as incomparable without new alert', async () => {
    const product=makeProduct({referenceCurrency:'USD'}); await saveProduct(product);
    fetchAndExtract.mockResolvedValue(makeFetchResult({price:100,currency:'EUR',inStock:true})); await checkProduct(product.id);
    expect(await getProduct(product.id)).toMatchObject({currentPrice:7000,currency:'USD',checkStatus:'currency_mismatch',bestSourceId:null});
    expect(await getHistory(product.id)).toEqual([]); expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('overlapping checks share one extraction and observation', async () => {
    const product = makeProduct({ targetPrice: null });
    await saveProduct(product);
    const started = deferred();
    const result = deferred();
    fetchAndExtract.mockImplementation(() => { started.resolve(); return result.promise; });
    const first = checkProduct(product.id);
    await started.promise;
    const second = checkProduct(product.id);
    result.resolve(makeFetchResult({ price: 6500, currency: 'USD' }));
    await Promise.all([first, second]);
    expect(fetchAndExtract).toHaveBeenCalledTimes(1);
    expect(await getHistory(product.id)).toHaveLength(1);
  });

  test('updates currentPrice and appends history on successful fetch', async () => {
    const product = makeProduct();
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 6500, currency: 'USD', inStock: true, strategy: 2, selectorUsed: 'json-ld',
    }));

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.currentPrice).toBe(6500);
    expect(updated.consecutiveErrors).toBe(0);
    expect(updated.lastChecked).toBeGreaterThan(0);

    const history = await getHistory('test-product-1');
    expect(history.length).toBe(1);
    expect(history[0].price).toBe(6500);
  });

  test('fires notification when price drops below target', async () => {
    const product = makeProduct({ currentPrice: 7000, targetPrice: 5000 });
    await saveProduct(product);
    await setSettings({});

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 4500, currency: 'USD', inStock: true, strategy: 2, selectorUsed: 'json-ld',
    }));

    await checkProduct('test-product-1');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notifId, opts] = chrome.notifications.create.mock.calls[0];
    expect(notifId).toMatch(/^price_test-product-1_/);
    expect(opts.title).toContain('Price drop');
  });

  test('does not fire notification when price is above target', async () => {
    const product = makeProduct({ currentPrice: 7000, targetPrice: 5000 });
    await saveProduct(product);
    await setSettings({});

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 6000, currency: 'USD', inStock: true, strategy: 2,
    }));

    await checkProduct('test-product-1');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('increments consecutiveErrors on fetch error, does not update price', async () => {
    const product = makeProduct({ currentPrice: 7000 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue(makeFetchResult({ error: 'HTTP 503' }));

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.consecutiveErrors).toBe(1);
    expect(updated.currentPrice).toBe(7000); // unchanged
  });

  test('clears selector after DRIFT_STRIKE_LIMIT consecutive nulls', async () => {
    const product = makeProduct({ selectors: { price: '.old-selector' }, consecutiveNulls: 2 });
    await saveProduct(product);

    fetchAndExtract.mockResolvedValue(makeFetchResult());

    await checkProduct('test-product-1');

    const updated = await getProduct('test-product-1');
    expect(updated.sources[0].selectors.price).toBeNull();
    expect(updated.sources[0].consecutiveNulls).toBe(0);
  });

  test('skips disabled products', async () => {
    const product = makeProduct({ enabled: false });
    await saveProduct(product);

    await checkProduct('test-product-1');

    expect(fetchAndExtract).not.toHaveBeenCalled();
  });

  test.each([5000, 7000, null])('stock return at 7000 silently updates when target=%s', async (targetPrice) => {
    await saveProduct(makeProduct({ inStock: false, currentPrice: 7000, targetPrice }));
    await setSettings({});
    fetchAndExtract.mockResolvedValue(makeFetchResult({ price: 7000, currency: 'USD', inStock: true, strategy: 2 }));
    await checkProduct('test-product-1');
    expect((await getProduct('test-product-1')).inStock).toBe(true);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('fires back-in-stock notification', async () => {
    const product = makeProduct({
      inStock: false,
      currentPrice: 7000,
      targetPrice: 9999, // below target: stock-return alert takes precedence
    });
    await saveProduct(product);
    await setSettings({});

    fetchAndExtract.mockResolvedValue(makeFetchResult({
      price: 7000, currency: 'USD', inStock: true, strategy: 2,
    }));

    await checkProduct('test-product-1');

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [, opts] = chrome.notifications.create.mock.calls[0];
    expect(opts.title).toContain('Back in stock');
  });
});
