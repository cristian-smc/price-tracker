/**
 * JSDoc type definitions — no runtime code.
 * Import these in JSDoc @param/@returns annotations for IDE support.
 *
 * @typedef {{
 *   id: string,
 *   url: string,
 *   name: string,
 *   targetPrice: number|null,
 *   currency: string,
 *   intervalMinutes: number,
 *   enabled: boolean,
 *   selectors: { price: string|null, stock: string|null },
 *   requiresTabExtraction: boolean,
 *   currentPrice: number|null,
 *   currentStock: string,
 *   lastChecked: number|null,
 *   lastNotified: number|null,
 *   consecutiveErrors: number,
 *   consecutiveNulls: number,
 *   createdAt: number
 * }} Product
 *
 * @typedef {{ ts: number, price: number, stock: string }} HistoryPoint
 *
 * @typedef {{
 *   defaultInterval: number,
 *   defaultCurrency: string,
 *   notificationsEnabled: boolean,
 *   stockNotificationsEnabled: boolean,
 *   soundEnabled: boolean,
 *   historyMaxPoints: number
 * }} Settings
 */

export {};
