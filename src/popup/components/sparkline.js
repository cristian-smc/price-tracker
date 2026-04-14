/**
 * Vanilla SVG sparkline renderer.
 * No external dependencies. MV3 CSP-safe (no eval/innerHTML for scripts).
 *
 * Usage:
 *   const svg = renderSparkline(points, { width: 340, height: 60 });
 *   container.appendChild(svg);
 */

/**
 * @param {{ ts: number, price: number }[]} points  price history (minor units)
 * @param {{ width?: number, height?: number, color?: string, fillColor?: string }} opts
 * @returns {SVGElement}
 */
export function renderSparkline(points, {
  width = 340,
  height = 60,
  color = '#2563eb',
  fillColor = 'rgba(37,99,235,0.08)',
} = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  if (!points || points.length < 2) {
    // Render a flat line for insufficient data
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', height / 2);
    line.setAttribute('x2', width); line.setAttribute('y2', height / 2);
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(line);
    return svg;
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

  // Fill area under the line
  const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const firstX = coords[0][0].toFixed(1);
  const lastX = coords[coords.length - 1][0].toFixed(1);
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

  // Dot on last point
  const [lx, ly] = coords[coords.length - 1];
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', lx.toFixed(1));
  dot.setAttribute('cy', ly.toFixed(1));
  dot.setAttribute('r', '3');
  dot.setAttribute('fill', color);
  svg.appendChild(dot);

  return svg;
}
