# Chrome Web Store listing copy (draft)

Paste these into the Developer Dashboard → Store listing. Not read from the repo automatically — nothing here ships until you paste it in and submit for review.

## Title (max 75 characters)

**Decided:** `PriceWatch – Price Tracker & Drop Alerts` (42) — now set in `manifest.json`.

Other options considered:

- `PriceWatch: Price Tracker & Alerts` (35)
- `PriceWatch – Amazon Price Tracker & Alerts` (43)

## Summary / short description (max 132 characters)

Shown directly under the title in search results — highest-leverage field after the title.

`Free price tracker for Amazon, Walmart, Best Buy, eBay & more. Get a Chrome alert the moment a price drops. No account needed.` (128 chars)

## Detailed description

Front-load keywords in the first 2 lines — Google truncates and indexes this part most heavily.

```
PriceWatch is a free price tracker that watches product prices on Amazon, Walmart, Best Buy, eBay, Target, and thousands of other online stores — then sends you a Chrome notification the moment the price drops.

No account. No subscription. No server. Everything stays in your browser.

FEATURES
• Track any product on any e-commerce site — not limited to a fixed store list
• Automatic price checks in the background (every 5/15/30 min, hourly, or daily)
• Desktop price-drop notifications, plus optional mobile push via ntfy.sh
• Price history chart for every product, so you know if a "deal" is really a deal
• Track the same product across multiple stores — PriceWatch always shows the lowest in-stock price
• Stock-aware alerts — no false price-drop pings when an item is out of stock, plus a back-in-stock alert
• Daily digest email-style summary of everything currently below your target price
• Visual element picker for sites where automatic price detection needs a manual assist
• Dark / light / auto theme
• Optional GitHub Gist sync to back up your tracked products across devices

PRIVACY
PriceWatch does not collect, sell, or transmit your personal data. There are no analytics and no accounts. All tracked products and price history are stored locally in your browser. Full privacy policy: https://cristian-smc.github.io/price-tracker/privacy.html

HOW IT WORKS
1. Install PriceWatch from the Chrome Web Store
2. Browse to any product page (Amazon, Walmart, Best Buy, eBay, or almost any online store)
3. Click the PriceWatch icon and set your target price
4. Get notified the instant the price drops

Perfect for anyone who wants an Amazon price tracker, a Walmart price drop alert, or a general-purpose price monitor that isn't locked to a single retailer.
```

## Category

`Shopping` (recommended over "Productivity" — better matches search intent for "price tracker" queries)

## Search terms / keywords field (if the dashboard exposes one)

price tracker, price drop alert, amazon price tracker, price monitor, deal alert, price history, price watch, buy alert

## Screenshots — cleanup note

`docs/store-screenshots/` currently has two generations of assets:
- Mockup-style: `1-product-list.png`, `2-product-detail.png`, `3-add-product.png`, `4-options.png`
- Real 1280×800 captures: `product-list-real-1280x800.png`, `add-product-real-1280x800.png`, `add-product-with-page-1280x800.png`

Only 3 of the 4 flows have a "real" screenshot (no real capture of product-detail or options). Recommend capturing real 1280×800 screenshots for those two before replacing the mockups in the live listing — left untouched here since it's unclear which set is currently live. Web Store allows up to 5 screenshots; a good spread is product-list, add-product, product-detail (with price history chart visible — visually distinctive), options, and one "notification" moment if you can stage it.

## Ratings

Rating count/score is a significant Web Store search ranking factor. Confirm the in-app rate-us prompt (added in the latest commit) fires at a moment of genuine delight — e.g. right after a price-drop notification lands — rather than on first install.
