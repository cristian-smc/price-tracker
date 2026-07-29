/**
 * Tests for src/shared/currency.js
 * Run with: node --experimental-vm-modules node_modules/.bin/jest tests/unit/currency.test.js
 * (or: npx jest tests/unit/currency.test.js after installing jest)
 */

import { parsePrice, formatPrice } from '../../src/shared/currency.js';

describe('parsePrice', () => {
  // --- USD dot-decimal ---
  test('$1,299.99 → 129999 USD', () => {
    expect(parsePrice('$1,299.99')).toEqual({ value: 129999, currency: 'USD' });
  });

  test('$29.99 → 2999 USD', () => {
    expect(parsePrice('$29.99')).toEqual({ value: 2999, currency: 'USD' });
  });

  test('US$99.00 → 9900 USD', () => {
    expect(parsePrice('US$99.00')).toEqual({ value: 9900, currency: 'USD' });
  });

  test('USD 49.95 → 4995 USD', () => {
    expect(parsePrice('USD 49.95')).toEqual({ value: 4995, currency: 'USD' });
  });

  // --- EUR comma-decimal ---
  test('€ 1.299,99 → 129999 EUR', () => {
    expect(parsePrice('€ 1.299,99')).toEqual({ value: 129999, currency: 'EUR' });
  });

  test('€29,99 → 2999 EUR', () => {
    expect(parsePrice('€29,99')).toEqual({ value: 2999, currency: 'EUR' });
  });

  test('EUR 1.299,99 → 129999 EUR', () => {
    expect(parsePrice('EUR 1.299,99')).toEqual({ value: 129999, currency: 'EUR' });
  });

  // --- PLN space-thousands ---
  test('1 299,99 zł → 129999 PLN', () => {
    expect(parsePrice('1 299,99 zł')).toEqual({ value: 129999, currency: 'PLN' });
  });

  test('29,99 zł → 2999 PLN', () => {
    expect(parsePrice('29,99 zł')).toEqual({ value: 2999, currency: 'PLN' });
  });

  // --- JPY zero-decimal ---
  test('JPY 15000 → 15000 JPY', () => {
    expect(parsePrice('JPY 15000')).toEqual({ value: 15000, currency: 'JPY' });
  });

  test('¥1,299 → 1299 JPY', () => {
    expect(parsePrice('¥1,299')).toEqual({ value: 1299, currency: 'JPY' });
  });

  test('￥15000 → 15000 JPY', () => {
    expect(parsePrice('￥15000')).toEqual({ value: 15000, currency: 'JPY' });
  });

  // --- KRW zero-decimal ---
  test('₩12,900 → 12900 KRW', () => {
    expect(parsePrice('₩12,900')).toEqual({ value: 12900, currency: 'KRW' });
  });

  // --- GBP ---
  test('£19.99 → 1999 GBP', () => {
    expect(parsePrice('£19.99')).toEqual({ value: 1999, currency: 'GBP' });
  });

  // --- Leading/trailing word stripping ---
  test('from $29.99 → 2999 USD', () => {
    expect(parsePrice('from $29.99')).toEqual({ value: 2999, currency: 'USD' });
  });

  test('Sale $89.99 → 8999 USD', () => {
    expect(parsePrice('Sale $89.99')).toEqual({ value: 8999, currency: 'USD' });
  });

  test('Only $14.99 left → 1499 USD', () => {
    expect(parsePrice('Only $14.99')).toEqual({ value: 1499, currency: 'USD' });
  });

  // --- Price ranges → lower value ---
  test('$29.99 – $49.99 → 2999 USD', () => {
    expect(parsePrice('$29.99 – $49.99')).toEqual({ value: 2999, currency: 'USD' });
  });

  test('$29.99—$49.99 → 2999 USD', () => {
    expect(parsePrice('$29.99—$49.99')).toEqual({ value: 2999, currency: 'USD' });
  });

  // --- Was/Now markup ---
  test('<del>$99</del> <ins>$79</ins> → 7900 USD', () => {
    expect(parsePrice('<del>$99</del> <ins>$79</ins>')).toEqual({ value: 7900, currency: 'USD' });
  });

  test('<ins class="new">$54.99</ins> → 5499 USD', () => {
    expect(parsePrice('<ins class="new">$54.99</ins>')).toEqual({ value: 5499, currency: 'USD' });
  });

  // --- Whole-dollar prices (no cents) ---
  test('$100 → 10000 USD', () => {
    expect(parsePrice('$100')).toEqual({ value: 10000, currency: 'USD' });
  });

  // --- Edge cases ---
  test('null → null', () => {
    expect(parsePrice(null)).toBeNull();
  });

  test('empty string → null', () => {
    expect(parsePrice('')).toBeNull();
  });

  test('no digits → null', () => {
    expect(parsePrice('no price here')).toBeNull();
  });

  test('zero value → null', () => {
    expect(parsePrice('$0.00')).toBeNull();
  });
});

describe('formatPrice', () => {
  test('formats USD cents', () => {
    expect(formatPrice(129999, 'USD', 'en-US')).toBe('$1,299.99');
  });

  test('formats JPY (zero-decimal)', () => {
    expect(formatPrice(15000, 'JPY', 'en-US')).toBe('¥15,000');
  });

  test('formats EUR', () => {
    // en-US locale formats EUR differently than de-DE — just check it contains "1,299"
    const result = formatPrice(129999, 'EUR', 'en-US');
    expect(result).toContain('1,299.99');
  });

  test('formats GBP', () => {
    const result = formatPrice(1999, 'GBP', 'en-US');
    expect(result).toContain('19.99');
  });
});
