/**
 * JSDoc type definitions — no runtime code.
 *
 * @typedef {{
 *   id: string,
 *   url: string,
 *   canonicalUrl: string|null,
 *   label: string,
 *   selectors: { price: string|null },
 *   requiresTabExtraction: boolean,
 *   currentPrice: number|null,
 *   currentStock: string,
 *   currency: string|null,
 *   thumbnail: string|null,
 *   lastChecked: number|null,
 *   consecutiveErrors: number,
 *   consecutiveNulls: number,
 * }} Source
 *
 * @typedef {{
 *   id: string,
 *   url: string,
 *   canonicalUrl: string|null,
 *   name: string,
 *   thumbnail: string|null,
 *   targetPrice: number|null,
 *   sellThreshold: number|null,
 *   currency: string,
 *   intervalMinutes: number,
 *   enabled: boolean,
 *   notificationEnabled: boolean,
 *   stockOnly: boolean,
 *   selectors: { price: string|null, stock: string|null },
 *   requiresTabExtraction: boolean,
 *   sources: Source[],
 *   bestSourceId: string|null,
 *   currentPrice: number|null,
 *   currentStock: string,
 *   initialPrice: number|null,
 *   lowestPrice: number|null,
 *   highestPrice: number|null,
 *   lastChecked: number|null,
 *   lastNotified: number|null,
 *   consecutiveErrors: number,
 *   consecutiveNulls: number,
 *   sortOrder: number,
 *   createdAt: number
 * }} Product
 *
 * @typedef {{ ts: number, price: number, stock: string }} HistoryPoint
 *
 * @typedef {{
 *   defaultInterval: number,
 *   defaultCurrency: string,
 *   notificationsEnabled: boolean,
 *   soundEnabled: boolean,
 *   historyMaxPoints: number,
 *   theme: 'auto'|'light'|'dark',
 *   dailyDigestEnabled: boolean,
 *   dailyDigestHour: number,
 *   sortBy: string,
 *   filterBy: string
 * }} Settings
 */
