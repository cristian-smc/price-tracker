/**
 * Product list view — renders tracked products as clickable cards.
 * @param {Record<string, import('../../shared/types').Product>} products
 * @param {{ onSelect: (id:string)=>void, onAdd: ()=>void }} handlers
 * @returns {HTMLElement}
 */

import { displayPrice, createStockBadge, createWarningBadge } from '../components/currency-badge.js';

export function renderProductList(products, { onSelect, onAdd }) {
  const entries = Object.values(products);

  if (entries.length === 0) {
    const wrap = document.createElement('div');
    wrap.className = 'empty';
    wrap.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14"/>
      </svg>
      <p>No products tracked yet.<br>Click <strong>+</strong> to add one.</p>
    `;
    return wrap;
  }

  const list = document.createElement('div');
  list.className = 'product-list';

  for (const p of entries.toSorted((a, b) => b.createdAt - a.createdAt)) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const priceStr = displayPrice(p.currentPrice, p.currency);
    const isPriceDrop = p.currentPrice !== null && p.targetPrice !== null && p.currentPrice < p.targetPrice;

    // Row 1: name + price
    const row1 = document.createElement('div');
    row1.className = 'row1';

    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = p.name;
    nameEl.title = p.name;

    const priceEl = document.createElement('span');
    priceEl.className = 'price' + (isPriceDrop ? ' drop' : '');
    priceEl.textContent = priceStr;

    row1.appendChild(nameEl);
    row1.appendChild(priceEl);

    // Row 2: stock badge + last checked + warning badges
    const row2 = document.createElement('div');
    row2.className = 'row2';

    row2.appendChild(createStockBadge(p.currentStock ?? 'unknown'));

    if (p.targetPrice !== null) {
      const target = document.createElement('span');
      target.title = 'Target price';
      target.textContent = `↓ ${displayPrice(p.targetPrice, p.currency)}`;
      target.style.color = isPriceDrop ? 'var(--success)' : 'var(--text-muted)';
      row2.appendChild(target);
    }

    if (p.lastChecked) {
      const when = document.createElement('span');
      when.textContent = formatRelativeTime(p.lastChecked);
      row2.appendChild(when);
    }

    if (p.consecutiveErrors >= 3) {
      row2.appendChild(createWarningBadge('error', p.consecutiveErrors));
    } else if (p.consecutiveNulls >= 2) {
      row2.appendChild(createWarningBadge('drift', p.consecutiveNulls));
    }

    card.appendChild(row1);
    card.appendChild(row2);

    const select = () => onSelect(p.id);
    card.addEventListener('click', select);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') select(); });

    list.appendChild(card);
  }

  return list;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
