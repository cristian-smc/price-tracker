// Storage keys
export const STORAGE_KEYS = {
  PRODUCTS: 'products',
  SETTINGS: 'settings',
  HISTORY_PREFIX: 'history_',
  DIGEST_LAST: 'digest_last',
};

// Alarm names
export const ALARM_PREFIX  = 'pricecheck_';
export const ALARM_DIGEST  = 'daily_digest';

// Check intervals in minutes (shown in UI)
export const CHECK_INTERVALS = [5, 15, 30, 60, 720, 1440];

// Default settings
export const DEFAULT_SETTINGS = {
  defaultInterval: 15,
  defaultCurrency: 'USD',
  notificationsEnabled: true,
  soundEnabled: false,
  historyMaxPoints: 500,
  theme: 'auto',            // 'auto' | 'light' | 'dark'
  dailyDigestEnabled: false,
  dailyDigestHour: 9,       // 0-23
  sortBy: 'created',        // 'created' | 'name' | 'price' | 'drop'
  filterBy: 'all',          // 'all' | 'below_target' | 'out_of_stock'
  mobilePushUrl: '',        // ntfy.sh topic URL or any POST webhook
  affiliateAmazonTag: '',   // Amazon Associates tag (e.g. "yourname-20")
  affiliateSkimlinksId: '', // Skimlinks publisher ID (e.g. "123456X123456")
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


// Message types (popup ↔ service worker)
export const MSG = {
  GET_PRODUCTS: 'GET_PRODUCTS',
  ADD_PRODUCT: 'ADD_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DELETE_PRODUCT: 'DELETE_PRODUCT',
  CHECK_NOW: 'CHECK_NOW',
  CHECK_ALL: 'CHECK_ALL',
  PAUSE_ALL: 'PAUSE_ALL',
  RESUME_ALL: 'RESUME_ALL',
  GET_HISTORY: 'GET_HISTORY',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  PICKER_RESULT: 'PICKER_RESULT',
  START_PICKER: 'START_PICKER',
  IMPORT_URLS: 'IMPORT_URLS',
  PLAY_SOUND: 'PLAY_SOUND',
  ADD_SOURCE: 'ADD_SOURCE',
  REMOVE_SOURCE: 'REMOVE_SOURCE',
};

// Selector drift recovery: re-run auto-detect after N consecutive null results
export const DRIFT_STRIKE_LIMIT = 3;

// Notification dedup: don't re-notify within intervalMinutes * this multiplier
export const NOTIFY_COOLDOWN_MULTIPLIER = 2;

// Auto-disable after this many consecutive errors
export const AUTO_DISABLE_ERROR_LIMIT = 10;

// User-Agent rotation list for 403/429 retries
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];
