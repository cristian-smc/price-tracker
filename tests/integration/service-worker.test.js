import { jest } from '@jest/globals';
import { TextEncoder } from 'node:util';
global.TextEncoder = TextEncoder;
const sync = {}, local = {};
const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
function area(store) {
  return {
    get: jest.fn(async (keys) => keys == null ? clone(store) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, clone(store[k])]))),
    set: jest.fn(async (items) => Object.assign(store, clone(items))),
    remove: jest.fn(async (keys) => { for (const k of [keys].flat()) delete store[k]; }),
    clear: jest.fn(async () => { for (const k of Object.keys(store)) delete store[k]; }),
  };
}
global.chrome = undefined;
let listener;
const event = () => ({ addListener: jest.fn() });
global.chrome = {
  storage: { sync: area(sync), local: area(local), onChanged: event() },
  runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, onStartup: event(), getURL: (p) => p, sendMessage: jest.fn() },
  alarms: { onAlarm: event(), clear: jest.fn(), get: jest.fn(), create: jest.fn(), getAll: jest.fn(async () => [{ name: 'pricecheck_orphan' }]) },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
  notifications: { onClicked: event(), onButtonClicked: event(), create: jest.fn() },
  tabs: { get: jest.fn(async (id) => ({ id, url: 'https://second.example/item', status: 'complete' })), query: jest.fn(async () => []), create: jest.fn(async ({url}) => ({id:3,url,status:'complete'})), update: jest.fn(), onUpdated: event(), onRemoved: event() },
  scripting: { executeScript: jest.fn(async () => []) },
};
// Network boundaries only: real worker, storage, source migration, alarm and badge code.
jest.unstable_mockModule('../../src/background/fetcher.js', () => ({ fetchAndExtract: jest.fn(async () => ({ price: 2000, currency: 'EUR', error: null })) }));
jest.unstable_mockModule('../../src/background/tab-fetcher.js', () => ({ tabFetchAndExtract: jest.fn() }));
const { fetchAndExtract } = await import('../../src/background/fetcher.js');
await import('../../src/background/service-worker.js');
const { withMutation } = await import('../../src/shared/storage.js');
function send(type, extra = {}, sender = {}) { return new Promise((resolve) => listener({ type, ...extra }, sender, resolve)); }
const product = (extra = {}) => ({ id: 'p1', name: 'Widget', url: 'https://old.example/item', currency: 'USD',
  enabled: false, intervalMinutes: 15, selectors: { price: '.old' }, currentPrice: 5000, ...extra });
beforeEach(async () => { await withMutation(async () => {}); await chrome.storage.sync.clear(); await chrome.storage.local.clear(); jest.clearAllMocks(); });

test.each([false, true])('edit updates extraction fields for source-backed=%s product', async (migrated) => {
  const sources = migrated ? [{ id: 's1', url: 'https://old.example/item', canonicalUrl: 'https://old.example/canonical', selectors: { price: '.old' } },
    { id: 's2', url: 'https://second.example/item', selectors: { price: '.second' } }] : [];
  sync.p_p1 = product({ sources });
  const reply = await send('UPDATE_PRODUCT', { id: 'p1', data: { url: 'https://new.example/item', priceSelector: '.new', name: 'Edited' } });
  expect(reply.error).toBeUndefined();
  expect(sync.p_p1).toMatchObject({ enabled: false, url: 'https://new.example/item', selectors: { price: '.new' } });
  if (migrated) {
    expect(sync.p_p1.sources[0]).toMatchObject({ id: 's1', url: 'https://new.example/item', canonicalUrl: null, selectors: { price: '.new' } });
    expect(sync.p_p1.sources[1]).toEqual(sources[1]);
  }
  await send('CHECK_NOW', { id: 'p1' });
  expect(fetchAndExtract.mock.calls[0][0]).toMatchObject({ url: 'https://new.example/item', selectors: { price: '.new' }, canonicalUrl: null });
  expect(sync.p_p1.url).toBe('https://new.example/item');
});

test('normal creation uses stored defaults and explicit overrides', async () => {
  sync.settings = { defaultInterval: 60, defaultCurrency: 'EUR', notificationsEnabled: false };
  const first = await send('ADD_PRODUCT', { data: { url: 'https://one.example/item', name: 'One' } });
  expect(first.product).toMatchObject({ currency: 'EUR', intervalMinutes: 60 });
  const second = await send('ADD_PRODUCT', { data: { url: 'https://two.example/item', name: 'Two', currency: 'JPY', intervalMinutes: 30 } });
  expect(second.product).toMatchObject({ currency: 'JPY', intervalMinutes: 30 });
  // Await started fire-and-forget checks via the public coalescing boundary.
  const { checkProduct } = await import('../../src/background/check-engine.js');
  await Promise.all([checkProduct(first.product.id), checkProduct(second.product.id)]);
});

test.each(['file:///tmp/product', 'javascript:alert(1)'])('worker refuses non-web product URL %s', async (url) => {
  const response = await send('ADD_PRODUCT', { data: { url, name: 'Widget' } });
  expect(response.error).toMatch(/HTTP|URL/i);
  expect(Object.keys(sync).filter((k) => k.startsWith('p_'))).toEqual([]);
});

test('restore message reconciles orphan alarms and exported data', async () => {
  const data = { sync: { p_p1: product() }, local: {} };
  expect(await send('IMPORT_BACKUP', { data })).toEqual({ ok: true });
  expect(chrome.alarms.clear).toHaveBeenCalledWith('pricecheck_orphan');
  expect(await send('EXPORT_BACKUP')).toEqual({ snapshot: data });
  expect(await send('CLEAR_DATA')).toEqual({ ok: true });
  expect(sync).toEqual({}); expect(local).toEqual({});
});

test('delete/undo restores complete history and paused state without checking', async () => {
  sync.p_p1=product(); local.history_p1={productId:'p1',points:[{ts:100,price:5000,currency:'USD'}]};
  const deleted=await send('DELETE_PRODUCT',{id:'p1'});
  expect(sync.p_p1).toBeUndefined(); expect(local.history_p1).toBeUndefined();
  const recovered=await send('UNDO_DELETE',{token:deleted.undo.token});
  expect(recovered.product.enabled).toBe(false); expect(sync.p_p1.enabled).toBe(false);
  expect(local.history_p1.points).toEqual([{ts:100,price:5000,currency:'USD'}]);
  expect(fetchAndExtract).not.toHaveBeenCalled(); expect(await send('GET_UNDO')).toEqual({undo:null});
});
test('expired undo and ID collision never overwrite a product', async()=>{
  sync.p_p1=product(); const deleted=await send('DELETE_PRODUCT',{id:'p1'});
  local._undoDelete.expiresAt=0;
  expect((await send('UNDO_DELETE',{token:deleted.undo.token})).error).toMatch(/expired/i);
  local._undoDelete.expiresAt=Date.now()+30000; sync.p_p1=product({name:'New'});
  expect((await send('UNDO_DELETE',{token:deleted.undo.token})).error).toMatch(/already exists/i);
  expect(sync.p_p1.name).toBe('New');
});
test('organization persists normalized tags and refuses oversize input',async()=>{
  sync.p_p1=product();
  await send('UPDATE_PRODUCT',{id:'p1',data:{group:' Home ',tags:[' Gift ','gift']}});
  expect(sync.p_p1).toMatchObject({group:'Home',tags:['Gift']});
  expect((await send('UPDATE_PRODUCT',{id:'p1',data:{group:'x'.repeat(41)}})).error).toMatch(/40/);
  expect(sync.p_p1.group).toBe('Home');
});
test('source-specific repair validates sender and preserves primary source/pause',async()=>{
  sync.p_p1=product({sources:[{id:'first',url:'https://old.example/item',selectors:{price:'.old'}},{id:'second',url:'https://second.example/item',selectors:{price:'.second'}}]});
  const {session}=await send('PREPARE_REPAIR',{productId:'p1',sourceId:'second',tabId:3});
  expect(session.sourceId).toBe('second');
  const rejected=await send('PICKER_RESULT',{selector:'.new',repairToken:session.token},{tab:{id:4,url:session.url}});
  expect(rejected.error).toMatch(/expired|changed/);
  expect(await send('PICKER_RESULT',{selector:'.new',repairToken:session.token},{tab:{id:3,url:session.url}})).toEqual({ok:true});
  expect(sync.p_p1.sources[0].selectors.price).toBe('.old'); expect(sync.p_p1.sources[1].selectors.price).toBe('.new'); expect(sync.p_p1.enabled).toBe(false);
  expect(fetchAndExtract).not.toHaveBeenCalled();
});
test('URL replacement clears old successful freshness',async()=>{
  sync.p_p1=product({lastObserved:Date.now(),checkStatus:'ok',sources:[{id:'s',url:'https://old.example/item',selectors:{price:'.old'},lastObserved:Date.now(),checkStatus:'ok'}]});
  await send('UPDATE_PRODUCT',{id:'p1',data:{url:'https://new.example/item'}});
  expect(sync.p_p1.lastObserved).toBeNull(); expect(sync.p_p1.checkStatus).toBeNull(); expect(sync.p_p1.sources[0].lastObserved).toBeNull();
});
test('removing winning source invalidates aggregate freshness',async()=>{
  sync.p_p1=product({bestSourceId:'win',lastObserved:Date.now(),checkStatus:'ok',sources:[{id:'first',url:'https://old.example/item',selectors:{price:'.old'}},{id:'win',url:'https://second.example/item',selectors:{price:'.second'}}]});
  await send('REMOVE_SOURCE',{productId:'p1',sourceId:'win'});
  expect(sync.p_p1.lastObserved).toBeNull(); expect(sync.p_p1.checkStatus).toBe('no_price'); expect(sync.p_p1.bestSourceId).toBeNull();
});
test('cancelled repair leaves source selector unchanged',async()=>{
  sync.p_p1=product({sources:[{id:'s',url:'https://second.example/item',selectors:{price:'.old'}}]});
  const {session}=await send('PREPARE_REPAIR',{productId:'p1',sourceId:'s',tabId:3});
  await send('PICKER_RESULT',{cancelled:true,selector:null,repairToken:session.token},{tab:{id:3,url:session.url}});
  expect(sync.p_p1.sources[0].selectors.price).toBe('.old'); expect(local._repairSession).toBeUndefined();
});

test('mutation queue recovers after a rejected operation', async () => {
  await expect(withMutation(() => { throw new Error('failure'); })).rejects.toThrow('failure');
  await withMutation(() => chrome.storage.sync.set({ recovered: true }));
  expect(sync.recovered).toBe(true);
});
