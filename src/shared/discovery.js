/** Pure normalization and evidence helpers for user-initiated store discovery. */
export function normalizeCandidateUrl(value, base) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (!host.includes('.') && !host.includes(':') || /(^|\.)(localhost|local|internal)$/.test(host)) return null;
    if (host.includes(':') && (/^(::|fc|fd|fe[89ab])/i.test(host) || /^::ffff:/i.test(host))) return null;
    const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
    if (ip) {
      const [a,b] = ip.slice(1).map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127) return null;
    }
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
export function textValue(value, limit = 180) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}
const identifier = (value) => textValue(value,80).toUpperCase().replace(/[^A-Z0-9]/g,'');
function variantCues(value) {
  const title = textValue(value).toLowerCase();
  return {
    capacity: [...title.matchAll(/\b\d+(?:\.\d+)?\s*(?:gb|tb|ml|litre|liter|inch|inches)\b/g)].map((m)=>m[0].replace(/\s/g,'')),
    condition: /\b(refurbished|renewed|used|pre-owned)\b/.exec(title)?.[1] ?? null,
  };
}
export function compareIdentity(reference, candidate) {
  const evidence = []; let rank = 0; let conflict = false;
  for (const field of ['gtin','mpn']) {
    const left = identifier(reference[field]); const right = identifier(candidate[field]);
    if (!left || !right) continue;
    if (left === right) { evidence.push(`${field.toUpperCase()} agrees`); rank += 5; }
    else { evidence.push(`${field.toUpperCase()} differs — verify the product`); conflict = true; }
  }
  const leftBrand=identifier(reference.brand), rightBrand=identifier(candidate.brand);
  if (leftBrand && rightBrand && leftBrand !== rightBrand) { evidence.push('Brand differs'); conflict=true; }
  const words = (s) => new Set(textValue(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? []);
  const left=words(reference.title), right=words(candidate.title);
  const shared=[...left].filter((w)=>right.has(w));
  if (left.size && shared.length/left.size >= .6) { evidence.push('Product names look similar'); rank+=2; }
  const model = (s) => [...words(s)].filter((w)=>/[a-z]/i.test(w)&&/\d/.test(w));
  const lm=model(reference.title), rm=model(candidate.title);
  if (lm.length && rm.length && !lm.some((v)=>rm.includes(v))) { evidence.push('Model text may differ'); conflict=true; }
  const lv=variantCues(reference.variant || reference.title), rv=variantCues(candidate.variant || candidate.title);
  if (lv.capacity.length && rv.capacity.length && !lv.capacity.some((v)=>rv.capacity.includes(v))) { evidence.push('Size or capacity differs'); conflict=true; }
  if (lv.condition !== rv.condition && (lv.condition || rv.condition)) { evidence.push('Condition may differ (new/used/refurbished)'); conflict=true; }
  if (!evidence.length) evidence.push('Identity not verified — check model and variant');
  return { evidence, conflict, rank: conflict ? -5 : rank };
}
export function hashDistance(left,right) {
  if (!/^[01]{64}$/.test(left ?? '') || !/^[01]{64}$/.test(right ?? '')) return null;
  return [...left].reduce((n,bit,i)=>n+Number(bit!==right[i]),0);
}
export function compareVisual(reference,candidate) {
  const distance=hashDistance(reference?.hash,candidate?.hash);
  if (distance == null) return { label:'Visual comparison unavailable', rank:0 };
  if (distance <= 8) return { label:'Images look similar — not identity proof', rank:2 };
  if (distance >= 24) return { label:'Images look different — verify manually', rank:-1 };
  return { label:'Visual match unclear — verify manually', rank:0 };
}
