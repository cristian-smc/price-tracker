/** @jest-environment node */
import { jest } from '@jest/globals';
import * as cheerio from '../../companion/node_modules/cheerio/dist/esm/index.js';
const files = new Map();
const exec = jest.fn();
jest.unstable_mockModule('fs', () => ({
  existsSync: (path) => files.has(String(path)),
  readFileSync: (path) => files.get(String(path)),
  writeFileSync: (path, data) => files.set(String(path), data),
  renameSync: (from, to) => { files.set(String(to), files.get(String(from))); files.delete(String(from)); },
}));
jest.unstable_mockModule('child_process', () => ({ execFileSync: exec }));
import { fileURLToPath } from 'node:url';
const productsFile = fileURLToPath(new URL('../../companion/pricewatch.json', import.meta.url));
files.set(productsFile, JSON.stringify({products:[]}));
const companion = await import('../../companion/check.js');
const product = { id: 'test', name: 'Widget', url: 'https://fixture.example/product', currency: 'USD', enabled: true, intervalMinutes: 30, targetPrice: null };
const log = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
beforeEach(() => { files.clear(); exec.mockReset().mockReturnValue(Buffer.from('')); global.fetch = jest.fn(); log.mockClear(); });
afterAll(() => log.mockRestore());

test.each([['JPY','1500',1500],['KRW','12900',12900],['USD','29.99',2999],['EUR','29,99',2999]])('companion structured data uses %s before conversion', (currency, raw, want) => {
  const html = `<script type="application/ld+json">${JSON.stringify({'@type':'Product',offers:{price:raw,priceCurrency:currency}})}</script>`;
  expect(companion.extractPrice(cheerio.load(html))).toMatchObject({price:want,currency});
  expect(companion.extractPrice(cheerio.load(`<meta property="product:price:amount" content="${raw}"><meta property="product:price:currency" content="${currency}">`))).toMatchObject({price:want,currency});
});

test('numeric attribute price uses surrounding RON currency instead of USD fallback',()=>{
  expect(companion.extractPrice(cheerio.load('<div><span class="price" data-price="167">167</span><span>Lei</span></div>'),'.price')).toMatchObject({price:16700,currency:'RON'});
});

test('failed Android price-drop notification retries same observed price', async () => {
  const state = { test: { lastPrice: 5000 } };
  global.fetch.mockImplementation(async () => ({ok:true,status:200,text:async () => '<span class="price">$40.00</span>'}));
  exec.mockImplementationOnce(() => { const error = new Error('timed out'); error.code = 'ETIMEDOUT'; throw error; });
  await companion.checkOneProduct(product,state);
  expect(state.test.lastNotified).toBeUndefined();
  expect(state.test.lastPrice).toBe(4000);
  expect(state.test.pendingPriceDrop).toBe(5000);
  await companion.checkOneProduct(product,state);
  expect(exec).toHaveBeenCalledTimes(2);
  expect(state.test.lastNotified).toBeTruthy();
  expect(state.test.pendingPriceDrop).toBeUndefined();
});

test('one product fetch failure does not prevent subsequent checks', async () => {
  const state = {};
  global.fetch.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce({ok:true,status:200,text:async () => '<span class="price">$29.99</span>'});
  expect(await companion.checkOneProduct(product,state)).toBe(false);
  expect(await companion.checkOneProduct({...product,id:'other'},state)).toBe(true);
  expect(state.other.lastPrice).toBe(2999);
});

test('companion does not compare foreign price to exported reference threshold', async () => {
  const state={test:{lastPrice:5000}};
  fetch.mockResolvedValue({ok:true,status:200,text:async()=>'<span class="price">€1.00</span>'});
  await companion.checkOneProduct({...product,targetPrice:4000,referenceCurrency:'USD'},state);
  expect(exec).not.toHaveBeenCalled(); expect(state.test).toMatchObject({lastPrice:5000,currencyMismatch:true,detectedCurrency:'EUR'});
});

test.each([5000, 7000, null])('companion stock return silently updates above/equal/missing target=%s', async (targetPrice) => {
  const state={test:{lastPrice:7000,inStock:false,pendingStockAlert:true}};
  fetch.mockResolvedValue({ok:true,status:200,text:async()=>'<meta property="product:availability" content="instock"><span class="price">$70.00</span>'});
  await companion.checkOneProduct({...product,targetPrice},state);
  expect(state.test.inStock).toBe(true); expect(state.test.pendingStockAlert).toBeUndefined();
  expect(exec).not.toHaveBeenCalled();
});

test('all paused list is distinguished from an empty list',async()=>{
  files.set(productsFile,JSON.stringify({products:[{...product,enabled:false}]}));await companion.main();
  const output=log.mock.calls.map(([s])=>s).join('');expect(output).toContain('all 1 saved product(s) are paused');expect(output).toContain('SAVED=1');
});
test('malformed export is rejected rather than pretending there are zero products',async()=>{
  files.set(productsFile,JSON.stringify({unrelated:true}));await expect(companion.main()).rejects.toThrow(/valid companion product list/);
  expect(log.mock.calls.map(([s])=>s).join('')).not.toContain('Done.');
});

test('no enabled products still emits valid completion counts', async () => {
  files.set(productsFile, JSON.stringify({products:[]}));
  await companion.main();
  expect(log.mock.calls.map(([s])=>s).join('')).toMatch(/Done\. BELOW_TARGET=0 TOTAL=0/);
});
