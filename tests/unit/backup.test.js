import { jest } from '@jest/globals';
import { TextEncoder } from 'node:util';
global.TextEncoder = TextEncoder;
const sync = {}, local = {};
const clone = (v) => JSON.parse(JSON.stringify(v));
function area(store) {
  return {
    QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
    get: jest.fn(async () => clone(store)),
    set: jest.fn(async (items) => Object.assign(store, clone(items))),
    remove: jest.fn(async (keys) => { for (const k of [keys].flat()) delete store[k]; }),
    clear: jest.fn(async () => { for (const k of Object.keys(store)) delete store[k]; }),
  };
}
global.chrome = { storage: { sync: area(sync), local: area(local) } };
const { importAll, exportAll } = await import('../../src/shared/storage.js');
const widget = { id: 'w', name: 'Widget', url: 'https://example.com/item', enabled: true, currency: 'USD', currentPrice: 2999 };
beforeEach(() => {
  for (const k of Object.keys(sync)) delete sync[k]; for (const k of Object.keys(local)) delete local[k];
  Object.assign(sync, { p_w: clone(widget), settings: { defaultCurrency: 'USD' }, untouched: 'keep' });
  Object.assign(local, { history_w: { productId: 'w', points: [{ ts: 100, price: 2999 }] } });
  chrome.storage.sync.set.mockReset().mockImplementation(async (items) => Object.assign(sync, clone(items)));
  chrome.storage.local.set.mockReset().mockImplementation(async (items) => Object.assign(local, clone(items)));
  jest.clearAllMocks();
});
test.each([null, [], {}, { sync: 'bad', local: {} }, { sync: {}, local: [] }, { sync: {} },
  { sync: { p_w: { id: 'wrong', url: 'https://example.com' } }, local: {} },
  { sync: {}, local: { history_w: { productId: 'w', points: [{ ts: 1, price: -10 }] } } },
  { sync: { p_w: { ...widget, url: 'javascript:alert(1)' } }, local: {} }])('invalid snapshot leaves both areas unchanged %#', async (snapshot) => {
  const before = await exportAll();
  await expect(importAll(snapshot)).rejects.toThrow(/backup|invalid/i);
  expect(await exportAll()).toEqual(before);
  expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});
test.each([{ historyMaxPoints: -1 }, { historyMaxPoints: 1.5 }, { dailyDigestHour: 'bad' }, { dailyDigestHour: 24 }])('malformed managed settings rejected before writes %j', async (settings) => {
  const before = await exportAll();
  await expect(importAll({ sync: { settings }, local: {} })).rejects.toThrow(/invalid backup/i);
  expect(await exportAll()).toEqual(before);
});

test('quota-aware rollback restores original data without temporary union overflow', async () => {
  for (const k of Object.keys(sync)) delete sync[k];
  sync.shared = 'a'.repeat(70000); sync.obsolete = 'o'.repeat(10000);
  const before = await exportAll();
  chrome.storage.sync.set.mockImplementation(async (items) => {
    const next = { ...sync, ...clone(items) };
    const bytes = Object.entries(next).reduce((sum, [key, value]) => sum + key.length + JSON.stringify(value).length, 0);
    if (bytes > 102400) throw new Error('QUOTA_BYTES');
    Object.assign(sync, clone(items));
  });
  chrome.storage.local.set.mockRejectedValueOnce(new Error('local failure'));
  chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 100000;
  try {
    await expect(importAll({ sync: { shared: 'b'.repeat(10000), incoming: 'i'.repeat(70000) }, local: {} })).rejects.toThrow(/original data was restored/);
    expect(await exportAll()).toEqual(before);
  } finally { chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 8192; }
});

test('valid disjoint replacement fits without union quota failure', async () => {
  for (const k of Object.keys(sync)) delete sync[k]; sync.old = 'a'.repeat(70000);
  chrome.storage.sync.set.mockImplementation(async (items) => {
    const next = { ...sync, ...clone(items) };
    if (JSON.stringify(next).length > 102400) throw new Error('QUOTA_BYTES');
    Object.assign(sync, clone(items));
  });
  const snapshot = { sync: { next: 'b'.repeat(70000) }, local: {} };
  // Large individual fields model many valid per-item entries in a total-quota-only mock.
  chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 100000;
  try { await importAll(snapshot); expect(await exportAll()).toEqual(snapshot); }
  finally { chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 8192; }
});

test('oversize sync entry rejected before writes', async () => {
  const before = await exportAll();
  await expect(importAll({ sync: { huge: 'x'.repeat(9000) }, local: {} })).rejects.toThrow(/quota|large/i);
  expect(await exportAll()).toEqual(before);
});
test('current export restores products/history and unknown fields', async () => {
  const snapshot = { sync: { p_w: { ...widget, future: { a: 1 } }, feature: 'future' }, local: { history_w: { productId: 'w', points: [{ ts: 200, price: 2500 }] }, future: true } };
  await importAll(snapshot);
  expect(await exportAll()).toEqual(snapshot);
});
test('legacy local product snapshot migrates products but retains absent sync area', async () => {
  await importAll({ products: { w: { ...widget, name: 'Legacy' } }, history_w: { productId: 'w', points: [] }, futureLocal: 42 });
  expect(sync.untouched).toBe('keep');
  expect(sync.settings.defaultCurrency).toBe('USD');
  expect(sync.p_w.name).toBe('Legacy');
  expect(local.futureLocal).toBe(42);
  expect(local.products).toBeUndefined();
});
test('partial local failure restores the original sync and local areas', async () => {
  const before = await exportAll();
  chrome.storage.local.set.mockRejectedValueOnce(new Error('local write failed'));
  await expect(importAll({ sync: { replacement: true }, local: { replacement: true } })).rejects.toThrow(/restored/i);
  expect(await exportAll()).toEqual(before);
});
test('rollback failure is reported explicitly', async () => {
  chrome.storage.local.set.mockRejectedValue(new Error('unavailable'));
  await expect(importAll({ sync: {}, local: { new: true } })).rejects.toThrow(/rollback.*failed/i);
});
