/**
 * Vanilla SVG sparkline renderer with hover tooltip.
 * No external dependencies. MV3 CSP-safe (no eval/innerHTML for scripts).
 */

import { formatPrice } from '../../shared/currency.js';

/**
 * @param {{ ts: number, price: number }[]} points
 * @param {{ width?: number, height?: number, color?: string, fillColor?: string, currency?: string }} opts
 * @returns {HTMLElement}  wrapper div containing the SVG + tooltip
 */
export function renderSparkline(points, {
  width = 340,
  height = 60,
  color = '#2563eb',
  fillColor = 'rgba(37,99,235,0.08)',
  currency = 'USD',
} = {}) {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.display = 'block';
  svg.style.width = '100%';

  if (!points || points.length < 2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', height / 2);
    line.setAttribute('x2', width); line.setAttribute('y2', height / 2);
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(line);
    wrap.appendChild(svg);
    return wrap;
  }

  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const pad = 4;
  const usableH = height - pad * 2;
  const usableW = width - pad * 2;

  const toX = (i) => pad + (i / (points.length - 1)) * usableW;
  const toY = (p) => pad + usableH - ((p - minP) / range) * usableH;
  const coords = points.map((pt, i) => [toX(i), toY(pt.price)]);
  const pathData = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  // Fill area
  const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const firstX = coords[0][0].toFixed(1);
  const lastX  = coords.at(-1)[0].toFixed(1);
  fillPath.setAttribute('d', `${pathData} L${lastX},${height} L${firstX},${height} Z`);
  fillPath.setAttribute('fill', fillColor);
  fillPath.setAttribute('stroke', 'none');
  svg.appendChild(fillPath);

  // Stroke line
  const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  linePath.setAttribute('d', pathData);
  linePath.setAttribute('fill', 'none');
  linePath.setAttribute('stroke', color);
  linePath.setAttribute('stroke-width', '1.5');
  linePath.setAttribute('stroke-linejoin', 'round');
  linePath.setAttribute('stroke-linecap', 'round');
  svg.appendChild(linePath);

  // Last-point dot
  const [lx, ly] = coords.at(-1);
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', lx.toFixed(1)); dot.setAttribute('cy', ly.toFixed(1));
  dot.setAttribute('r', '3'); dot.setAttribute('fill', color);
  svg.appendChild(dot);

  // Hover crosshair + tooltip
  const crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  crosshair.setAttribute('y1', '0'); crosshair.setAttribute('y2', height);
  crosshair.setAttribute('stroke', color); crosshair.setAttribute('stroke-width', '1');
  crosshair.setAttribute('stroke-dasharray', '3 2'); crosshair.setAttribute('opacity', '0');
  svg.appendChild(crosshair);

  const hoverDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hoverDot.setAttribute('r', '4'); hoverDot.setAttribute('fill', color);
  hoverDot.setAttribute('stroke', '#fff'); hoverDot.setAttribute('stroke-width', '1.5');
  hoverDot.setAttribute('opacity', '0');
  svg.appendChild(hoverDot);

  // Tooltip DOM element
  const tooltip = document.createElement('div');
  tooltip.className = 'sparkline-tooltip';
  tooltip.style.cssText = 'position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:11px;padding:3px 7px;border-radius:4px;white-space:nowrap;opacity:0;transition:opacity .1s;top:4px';
  wrap.appendChild(tooltip);

  wrap.appendChild(svg);

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (width / rect.width);
    // Find nearest point
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.abs(coords[i][0] - mx);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    const [cx, cy] = coords[best];
    const pt = points[best];

    crosshair.setAttribute('x1', cx.toFixed(1)); crosshair.setAttribute('x2', cx.toFixed(1));
    crosshair.setAttribute('opacity', '0.5');
    hoverDot.setAttribute('cx', cx.toFixed(1)); hoverDot.setAttribute('cy', cy.toFixed(1));
    hoverDot.setAttribute('opacity', '1');

    const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(pt.ts));
    tooltip.textContent = `${formatPrice(pt.price, currency)}  ·  ${date}`;
    tooltip.style.opacity = '1';

    const tooltipX = (cx / width) * rect.width;
    tooltip.style.left = `${Math.min(tooltipX, rect.width - 160)}px`;
  });

  svg.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', '0');
    hoverDot.setAttribute('opacity', '0');
    tooltip.style.opacity = '0';
  });

  return wrap;
}
