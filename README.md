# PriceWatch

Track prices on any website. Get notified when they drop. Never overpay again.

## Features

- **Track any product** — works on any e-commerce site (Amazon, eBay, Best Buy, Walmart, and more)
- **Automatic price checks** — checks prices in the background at a configurable interval
- **Price drop alerts** — desktop notifications and optional mobile push (via ntfy.sh) when a price falls below your target
- **Price history** — sparkline chart showing price over time for each product
- **Multiple sources** — track the same product across several stores and always see the lowest price
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

### 2.1.0
- Multiple sources per product
- Lowest price tracking across sources

## License

MIT
