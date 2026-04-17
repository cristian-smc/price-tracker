# PriceWatch

Track prices on any website. Get notified when they drop. Never overpay again.

## Features

- **Track any product** — works on any e-commerce site (Amazon, eBay, Best Buy, Walmart, and more)
- **Automatic price checks** — checks prices in the background at a configurable interval
- **Price drop alerts** — desktop notifications and optional mobile push (via ntfy.sh) when a price falls below your target
- **Price history** — sparkline chart showing price over time for each product
- **Multiple sources** — track the same product across several stores and always see the lowest available price
- **Stock awareness** — in-stock / out-of-stock status shown per source; price-drop alerts suppressed when the item is out of stock; notified when it comes back in stock
- **Daily digest** — optional morning summary of products below target
- **GitHub Gist sync** — back up and sync your tracked products across devices
- **Dark / light / auto theme**
- **Drag-to-reorder** — arrange cards in any order you like

## Installation

### From the Chrome Web Store

Search for **PriceWatch** or install directly from the listing page.

### Load unpacked (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repo folder (the one containing `manifest.json`).

## How to Use

### Add a product

1. Navigate to the product page you want to track.
2. Click the PriceWatch icon in the Chrome toolbar (or press `Alt+P`).
3. Click the **+** button. The URL and page title are pre-filled.
4. Optionally set a **target price** — you will be notified when the price drops below this value.
5. Click **Save**.

PriceWatch immediately checks the price in the background and will keep checking at the configured interval.

### Pick a price selector (advanced)

If PriceWatch cannot detect the price automatically, use the **element picker**:

1. Open the add/edit form for a product.
2. Click **Pick element** — the popup closes and the picker activates on the current tab.
3. Click the price element on the page.
4. The popup re-opens with the CSS selector pre-filled.

### Reorder cards

Hover over a card to reveal the drag handle (⠿) on the right side. Drag cards into your preferred order. The sort mode switches to **Custom order** automatically and is saved across sessions. You can revert to any other sort via the dropdown in the search bar.

### Configure notifications

Open **Options** (gear icon) to:

- Enable/disable desktop notifications and notification sound
- Set up **mobile push notifications** via [ntfy.sh](https://ntfy.sh) — enter your topic URL (e.g. `https://ntfy.sh/my-topic`)
- Enable the **daily digest** and choose what time it fires
- Set the default check interval and currency

### Pause / resume tracking

- Click **Pause all** or **Resume all** in the product list toolbar.
- To pause a single product, open its detail view and toggle the switch.

### GitHub Gist sync

In Options, enter a GitHub Personal Access Token (with `gist` scope only) to enable automatic backup and cross-device sync of your tracked products.

## Privacy

PriceWatch does not collect or transmit any personal data. All product data is stored locally in `chrome.storage.sync` (synced to your own Google account). Network requests go directly from your browser to the product URLs you have chosen to track. See [privacy policy](docs/privacy.html) for full details.

## Keyboard shortcut

`Alt+P` — open the PriceWatch popup (configurable via `chrome://extensions/shortcuts`).

## Changelog

### 2.3.0
- **Stock awareness** — each source now shows an in-stock or out-of-stock badge in the product detail view
- **Smarter best-source selection** — the extension picks the lowest price among in-stock sources, not just the overall lowest
- **Suppressed false alerts** — price-drop notifications are not sent when the item is out of stock
- **Back-in-stock notification** — get alerted the moment a tracked product comes back into stock
- **Accurate badge count** — the icon badge only counts products that are below target price AND available to buy
- **Companion app stock support** — the Termux companion also detects stock and suppresses out-of-stock price-drop alerts

### 2.2.0
- **Drag-to-reorder fix** — drop indicator now shows above/below the target card; cards land in the correct position in both directions
- **Check all fix** — products are now checked one at a time, eliminating the background tab flood and race conditions that caused some sources to be skipped
- **Prices refresh immediately** after "Check all" completes — no need to reopen the popup
- **No tabs for non-SPA sites** — plain HTML pages are always fetched headlessly; a tab only opens when the page is detected as a JavaScript SPA
- **Product detail: larger image** — thumbnail is now shown at 108×108 px
- **Product detail: site favicon fallback** — products without a scraped thumbnail show the site's logo instead of a blank placeholder
- **Product detail: URL points to the lowest-price source** — the link and copy button reflect the cheapest store, not the first one added
- **Sources sorted by price** — cheapest source listed first in the detail view
- **Gist sync: auto-clear invalid token** — a 401 from GitHub now removes the stored token so future syncs silently skip instead of retrying with bad credentials

### 2.1.2
- Fix drag-to-reorder: reordering now persists and renders correctly in all cases
- Fix drag handle click inadvertently opening product detail
- Improve price detection for Google Flights and other `c-wiz` SPA sites
- One-shot tab-extraction fallback for sites that never yielded a price via fetch

### 2.1.1
- Background tab fetch to eliminate popup flash on manual check

### 2.1.0
- Mobile push notification support (ntfy.sh)
- Improved tab fetching logic
- Multiple sources per product
- Lowest price tracking across sources

## License

MIT
