// Storage keys
export const STORAGE_KEYS = {
  PRODUCTS: 'products',
  SETTINGS: 'settings',
  HISTORY_PREFIX: 'history_',
};

// Alarm name prefix — each product gets alarm: ALARM_PREFIX + productId
export const ALARM_PREFIX = 'pricecheck_';

// Check intervals in minutes (shown in UI)
export const CHECK_INTERVALS = [5, 15, 30, 60];

// Default settings
export const DEFAULT_SETTINGS = {
  defaultInterval: 15,
  defaultCurrency: 'USD',
  notificationsEnabled: true,
  soundEnabled: false,
  historyMaxPoints: 500,
};

// Price extraction selector heuristics (strategy 4)
export const HEURISTIC_SELECTORS = [
  '[itemprop="price"]',
  '[data-testid="price"]',
  '[data-price]',
  '.price',
  '.product-price',
  '.offer-price',
  '.sale-price',
  // Amazon
  '.a-price .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  // eBay
  '.x-price-primary span[itemprop="price"]',
  // Best Buy
  '.priceView-hero-price span',
  // Target
  '[data-test="product-price"]',
  // Walmart
  '[itemprop="price"]',
];

// Stock selector heuristics (strategy 5)
export const STOCK_SELECTORS = [
  '[itemprop="availability"]',
  '.availability',
  '.stock-status',
  '#availability',
  '[data-testid="fulfillment-add-to-cart-button"]',
  '#add-to-cart-button',
  '.add-to-cart',
  'button[data-action="add-to-cart"]',
];

// Stock status values
export const STOCK_STATUS = {
  IN_STOCK: 'in_stock',
  OUT_OF_STOCK: 'out_of_stock',
  UNKNOWN: 'unknown',
};

// Message types (popup ↔ service worker)
export const MSG = {
  GET_PRODUCTS: 'GET_PRODUCTS',
  ADD_PRODUCT: 'ADD_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DELETE_PRODUCT: 'DELETE_PRODUCT',
  CHECK_NOW: 'CHECK_NOW',
  GET_HISTORY: 'GET_HISTORY',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  PICKER_RESULT: 'PICKER_RESULT',
  START_PICKER: 'START_PICKER',
};

// Selector drift recovery: re-run auto-detect after N consecutive null results
export const DRIFT_STRIKE_LIMIT = 3;

// Notification dedup: don't re-notify within intervalMinutes * this multiplier
export const NOTIFY_COOLDOWN_MULTIPLIER = 2;
