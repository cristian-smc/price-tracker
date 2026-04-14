# PriceWatch Chrome Extension — Implementation Plan

## Overview

A Chrome Extension (Manifest V3) that tracks product prices from any e-commerce page, sends desktop notifications when prices drop below a user-defined target, and checks prices/stock automatically every 5/15/30 minutes in the background.

---

## Architecture

### Core Constraint: MV3 Service Workers Are Ephemeral
Service workers sleep when idle — they cannot use persistent backgrounds. `chrome.alarms` wakes the worker on schedule, runs the check, then lets it sleep. Chrome restarts the worker automatically when an alarm fires.

### Price Extraction Pipeline (5 strategies, in priority order)
1. User-defined CSS selector (from visual element picker)
2. JSON-LD structured data (`application/ld+json` → `offers.price`) — covers Shopify, WooCommerce, BigCommerce
3. Open Graph meta tags (`product:price:amount`)
4. Common CSS selector heuristics (`[itemprop="price"]`, Amazon patterns, etc.)
5. Add-to-cart button presence/disabled state (for stock detection)

### JS-Rendered SPAs
Raw `fetch()` won't execute JavaScript. Detection: if price fails AND page has `<div id="root">` with no text, escalate to tab-based fallback (create hidden tab + MutationObserver + auto-close). Flag stored as `requiresTabExtraction: true`.

---

## File Structure

```
price_tracker/
├── manifest.json
├── PLAN.md                          ← this file
├── src/
│   ├── background/
│   │   ├── service-worker.js        # Event router (alarms, messages, notifications)
│   │   ├── alarm-manager.js         # Per-product alarm registration + sync
│   │   ├── check-engine.js          # Orchestrates full price check cycle
│   │   ├── fetcher.js               # fetch() + offscreen bridge + retry logic
│   │   ├── notifier.js              # Desktop notification dispatch
│   │   └── history-manager.js       # Price history append + prune
│   ├── offscreen/
│   │   ├── offscreen.html           # Minimal shell (required for DOMParser)
│   │   └── offscreen.js             # DOMParser + all 5 selector strategies
│   ├── content/
│   │   └── picker.js                # Visual element picker (injected on demand)
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js                 # View router + message dispatcher
│   │   ├── popup.css
│   │   ├── views/
│   │   │   ├── product-list.js      # Tracked product cards
│   │   │   ├── add-product.js       # Add/edit product form
│   │   │   └── product-detail.js    # Sparkline + full history view
│   │   └── components/
│   │       ├── sparkline.js         # Vanilla SVG sparkline renderer
│   │       └── currency-badge.js    # Price formatting + display
│   ├── options/
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   └── shared/
│       ├── storage.js               # Typed wrappers over chrome.storage.local
│       ├── currency.js              # Price string parser (all formats/currencies)
│       ├── constants.js             # Alarm names, storage keys, selector lists
│       └── utils.js                 # Retry, debounce, nanoid-compatible ID gen
├── assets/
│   └── icons/
│       ├── icon-16.png
│       ├── icon-32.png
│       ├── icon-48.png
│       └── icon-128.png
└── tests/
    ├── unit/
    │   ├── currency.test.js
    │   ├── extractor.test.js
    │   └── history-manager.test.js
    └── integration/
        └── check-engine.test.js
```

---

## Data Model

### Product Record (`chrome.storage.local` key: `"products"`)
Map keyed by `productId`.

```json
{
  "id": "abc123",
  "url": "https://example.com/product",
  "name": "Product Name",
  "targetPrice": 7999,
  "currency": "USD",
  "intervalMinutes": 15,
  "enabled": true,
  "selectors": {
    "price": ".a-price .a-offscreen",
    "stock": null
  },
  "requiresTabExtraction": false,
  "currentPrice": 8999,
  "currentStock": "in_stock",
  "lastChecked": 1713100000000,
  "lastNotified": null,
  "consecutiveErrors": 0,
  "createdAt": 1713000000000
}
```

All prices stored as **integer minor units** (cents) — no IEEE 754 float drift.

### Price History (`chrome.storage.local` key: `"history_<productId>"`)
```json
{
  "productId": "abc123",
  "points": [
    { "ts": 1713100000000, "price": 8999, "stock": "in_stock" }
  ]
}
```
Capped at 500 points per product (configurable). At 5-min intervals = ~41h of history.

### Settings (`chrome.storage.local` key: `"settings"`)
```json
{
  "defaultInterval": 15,
  "defaultCurrency": "USD",
  "notificationsEnabled": true,
  "soundEnabled": false,
  "historyMaxPoints": 500
}
```

---

## manifest.json (key sections)

```json
{
  "manifest_version": 3,
  "permissions": ["alarms", "storage", "notifications", "offscreen", "activeTab", "scripting", "unlimitedStorage"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "src/background/service-worker.js", "type": "module" },
  "action": { "default_popup": "src/popup/popup.html" }
}
```

---

## Key Design Decisions

| Problem | Solution | Why |
|---|---|---|
| Background persistence | `chrome.alarms` API | Survives worker termination; Chrome restarts worker on alarm |
| HTML parsing in worker | Offscreen Document (DOM_PARSER) | No visible tab needed; no UX disruption |
| JS-rendered SPAs | Tab-based fallback + MutationObserver | Only option for real JS execution in extensions |
| Price arithmetic | Integer minor units (cents) | No IEEE 754 rounding errors |
| Sparkline chart | Vanilla SVG | No external deps; MV3 CSP-safe (no eval) |
| Per-product intervals | One alarm per product | Allows different intervals; spreads fetch load |
| Selector drift recovery | 3-strike null-result → re-run auto-detect | Silent recovery without user intervention |
| Notification dedup | `lastNotified` + `intervalMinutes * 2` cooldown | Prevents alert spam on threshold bounce |

---

## Implementation Phases

### Phase 1 — Foundation
- [ ] `manifest.json`
- [ ] `src/shared/constants.js`
- [ ] `src/shared/storage.js`
- [ ] `src/shared/currency.js` + `tests/unit/currency.test.js`
- [ ] `src/shared/utils.js`

### Phase 2 — Offscreen Parser
- [ ] `src/offscreen/offscreen.html`
- [ ] `src/offscreen/offscreen.js` (all 5 selector strategies)
- [ ] `tests/unit/extractor.test.js`

### Phase 3 — Service Worker Core
- [ ] `src/background/service-worker.js`
- [ ] `src/background/alarm-manager.js`
- [ ] `src/background/fetcher.js`
- [ ] `src/background/history-manager.js`
- [ ] `src/background/notifier.js`
- [ ] `src/background/check-engine.js`
- [ ] `tests/integration/check-engine.test.js`

### Phase 4 — Popup UI
- [ ] `src/popup/popup.html` + `popup.css`
- [ ] `src/popup/components/sparkline.js`
- [ ] `src/popup/components/currency-badge.js`
- [ ] `src/popup/views/product-list.js`
- [ ] `src/popup/views/add-product.js`
- [ ] `src/popup/views/product-detail.js`
- [ ] `src/popup/popup.js`

### Phase 5 — Element Picker
- [ ] `src/content/picker.js`
- [ ] Wire into add-product form

### Phase 6 — Options & Polish
- [ ] `src/options/` (html, js, css)
- [ ] Settings → alarm re-sync via `chrome.storage.onChanged`
- [ ] Export/import JSON
- [ ] Notification permission detection + popup banner
- [ ] Product card warning badges (drift, errors)

### Phase 7 — SPA Fallback
- [ ] Tab-based fallback in `fetcher.js`
- [ ] `requiresTabExtraction` detection in `check-engine.js`

### Phase 8 — Testing & Hardening
- [ ] End-to-end install → add product → alarm → notification
- [ ] Alarm survival across browser restart
- [ ] Load test: 20 products at 5-min intervals
- [ ] CSP audit (no eval anywhere)

---

## Currency Parsing Rules (currency.js)

Handles all major formats:
- `$1,299.99` → `{ value: 129999, currency: "USD" }`
- `€ 1.299,99` → `{ value: 129999, currency: "EUR" }` (comma-as-decimal)
- `1 299,99 zł` → `{ value: 129999, currency: "PLN" }` (space thousands)
- `JPY 15000` → `{ value: 15000, currency: "JPY" }` (zero-decimal currency)
- `from $29.99` / `Sale $89.99` → strip leading/trailing words
- `$29.99 – $49.99` (range) → take lower value
- `<del>$99</del> <ins>$79</ins>` (was/now) → take `<ins>` value

Detection logic: last separator with exactly 2 following digits = decimal point.

---

## Notification Strategy

- Price drop: fires when `newPrice < targetPrice` AND `newPrice < currentPrice`
- Back in stock: fires when stock transitions `out_of_stock → in_stock`
- Dedup cooldown: no re-notify within `intervalMinutes * 2` minutes
- Notification click: opens `record.url` in new tab
- Notification IDs: `"price_<productId>_<timestamp>"` — unique per event

---

## Critical Files (by risk/impact)

1. **`service-worker.js`** — every feature path flows through here
2. **`offscreen.js`** — correctness determines whether any price is ever extracted
3. **`currency.js`** — subtle bugs silently corrupt all stored prices
4. **`check-engine.js`** — alarms, errors, notifications, and history all converge here
5. **`storage.js`** — single interface to all persisted state; every module depends on it
