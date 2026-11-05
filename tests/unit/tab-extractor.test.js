import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
// Execute the exact production function body as Chrome serializes it, with no module closure.
const source = readFileSync(new URL('../../src/background/tab-fetcher.js', import.meta.url), 'utf8');
const start = source.indexOf('function tabExtractor(');
const end = source.indexOf('\nfunction timeout(', start);
const extract = new Function(`${source.slice(start, end)}; return tabExtractor;`)();
beforeEach(() => { jest.useFakeTimers(); global.chrome = { runtime: { sendMessage: jest.fn() } }; });
afterEach(() => jest.useRealTimers());
test.each([['JPY', '15000', 15000], ['KRW', '12900', 12900], ['USD', '29.99', 2999]])('serialized tab extraction uses %s units', (currency, raw, want) => {
  document.body.innerHTML = `<meta itemprop="priceCurrency" content="${currency}"><span class="price">${raw}</span>`;
  extract({ tabId: 1, userSelector: '.price', selectors: [] });
  expect(chrome.runtime.sendMessage.mock.calls[0][0]).toMatchObject({ price: want, currency });
  expect(jest.getTimerCount()).toBe(0);
});
