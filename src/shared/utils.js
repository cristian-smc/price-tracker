/**
 * Shared utilities: retry, debounce, ID generation.
 */

// ---------- ID generation ----------
// Nanoid-compatible: 21-char URL-safe base64, crypto-random.
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Generates a random URL-safe ID.
 * @param {number} [length=21]
 * @returns {string}
 */
export function generateId(length = 21) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ID_CHARS[b & 63]).join('');
}

// ---------- Retry ----------

/**
 * Retries an async function up to `attempts` times with exponential back-off.
 * Throws the last error if all attempts fail.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function retry(fn, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await sleep(baseDelayMs * 2 ** i);
      }
    }
  }
  throw lastError;
}

// ---------- Sleep ----------

/**
 * Promise-based delay.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Debounce ----------

/**
 * Returns a debounced version of fn that delays invocation until after
 * `wait` ms have elapsed since the last call.
 * @template {(...args: any[]) => any} T
 * @param {T} fn
 * @param {number} wait
 * @returns {T}
 */
export function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ---------- Alarm name helpers ----------

import { ALARM_PREFIX } from './constants.js';

/** @param {string} productId @returns {string} */
export function alarmName(productId) {
  return ALARM_PREFIX + productId;
}

/** @param {string} name @returns {string|null} */
export function productIdFromAlarm(name) {
  return name.startsWith(ALARM_PREFIX) ? name.slice(ALARM_PREFIX.length) : null;
}

// ---------- Time helpers ----------

/**
 * Returns true if the given timestamp is older than `ms` milliseconds ago.
 * @param {number|null} ts
 * @param {number} ms
 */
export function isOlderThan(ts, ms) {
  if (!ts) return true;
  return Date.now() - ts > ms;
}
