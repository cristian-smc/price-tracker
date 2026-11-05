import { jest } from '@jest/globals';
let listener;
global.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
await import('../../src/offscreen/offscreen.js');
const parse = (html, userSelector) => new Promise((resolve) => listener({ type: 'PARSE_HTML', html, userSelector }, {}, resolve));
const ld = (offers) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', offers })}</script>`;

test.each([['JPY', '15000', 15000], ['KRW', '12900', 12900], ['USD', '29.99', 2999], ['EUR', '29,99', 2999]])('production JSON-LD uses %s before conversion', async (currency, raw, want) => {
  expect(await parse(ld({ price: raw, priceCurrency: currency }))).toMatchObject({ price: want, currency });
});
test.each(['JPY', 'KRW'])('production metadata/selector uses %s units', async (currency) => {
  const meta = `<meta property="product:price:currency" content="${currency}">`;
  expect(await parse(`${meta}<meta property="product:price:amount" content="15000">`)).toMatchObject({ price: 15000, currency });
  expect(await parse(`${meta}<span class="price" data-price="15000">price</span>`, '.price')).toMatchObject({ price: 15000, currency });
});
test.each([false, true])('price and stock belong to the same offer reversed=%s', async (reverse) => {
  const offers = [{ price: '100', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    { price: '10', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' }];
  expect(await parse(ld(reverse ? offers.reverse() : offers))).toMatchObject({ price: 10000, inStock: true });
});
test('unknown selected offer does not borrow unavailable stock from another offer', async () => {
  expect(await parse(ld([{ price: '100', availability: 'https://schema.org/OutOfStock' }, { price: '10' }]))).toMatchObject({ price: 1000, inStock: null });
});
test('fetched markup is inert and inline handlers are removed without losing extraction data', async () => {
  const query = Document.prototype.querySelectorAll;
  let extractedDocument;
  const spy = jest.spyOn(Document.prototype, 'querySelectorAll').mockImplementation(function (selector) {
    if (this !== document) extractedDocument = this;
    return query.call(this, selector);
  });
  try {
    const html = `<html><head><meta property="og:image" content="https://example.com/thumb.png"></head>
      <body class="shop" onload="throw new Error('untrusted handler')">
      <img src="https://example.com/missing.png" onerror="throw new Error('untrusted handler')">
      <svg onload="throw new Error('untrusted handler')"></svg>
      <span data-test="product-price" onclick="throw new Error('untrusted handler')" data-price="29.99">$29.99</span>
      <button>Add to cart</button></body></html>`;
    expect(await parse(html, 'body.shop [data-test="product-price"]')).toMatchObject({
      price: 2999, currency: 'USD', thumbnail: 'https://example.com/thumb.png', inStock: true,
    });
    expect(extractedDocument.defaultView).toBeNull();
    expect(extractedDocument.querySelectorAll('[onload], [onerror], [onclick]')).toHaveLength(0);
    expect(extractedDocument.querySelector('body.shop [data-test="product-price"]')).not.toBeNull();
  } finally { spy.mockRestore(); }
});

test('malformed structured data falls back to a real selector', async () => {
  expect(await parse('<script type="application/ld+json">{bad</script><span class="price">$29.99</span>')).toMatchObject({ price: 2999, currency: 'USD' });
});
