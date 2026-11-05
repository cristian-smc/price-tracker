/** User-initiated, bounded free search and product-page inspection. No tracking writes. */
import { getProduct } from '../shared/storage.js';
import { offscreenRequest } from './fetcher.js';
import { normalizeCandidateUrl, compareIdentity, compareVisual, textValue } from '../shared/discovery.js';
const MAX_BYTES = 2 * 1024 * 1024;
const SEARCH_URL = 'https://www.bing.com/search';
async function readBytes(url, accept) {
  const safe = normalizeCandidateUrl(url);
  if (!safe) throw new Error('Use a public HTTP or HTTPS product URL without credentials.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  let reader;
  try {
    // Do not follow a public page's redirect into private/local addresses before
    // validation. Browser opaque redirects cannot be safely inspected: fail closed.
    const response = await fetch(safe, { signal:controller.signal, credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', headers:{ Accept:accept } });
    if (!response.ok) throw new Error(`Page returned HTTP ${response.status}`);
    const finalUrl = normalizeCandidateUrl(response.url || safe);
    if (!finalUrl) throw new Error('Page redirected to an unsupported URL.');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Page or image is too large.');
    reader=response.body?.getReader(); if(!reader) throw new Error('The page response is empty.');
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('Page or image is too large.');chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {bytes,url:finalUrl,type:response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''};
  } finally {clearTimeout(timer);if(reader) await reader.cancel().catch(()=>{});}
}
async function inspectPage(url) {
  const response=await readBytes(url,'text/html,application/xhtml+xml');
  if(!/^(text\/html|application\/xhtml\+xml)$/.test(response.type)) throw new Error('This URL does not return a product page.');
  const result=await offscreenRequest('PARSE_HTML',{html:new TextDecoder().decode(response.bytes),url:response.url});
  const metadata=result.metadata ?? {};
  // Preview/Add must target the exact inspected page. A cross-page canonical
  // claim is not proof that its destination has the pictured product/variant.
  return { ...metadata, url:response.url,
    image:normalizeCandidateUrl(metadata.image,result.url || response.url),
    title:textValue(metadata.title), merchant:new URL(response.url).hostname.replace(/^www\./,''),
    price:result.price ?? null,currency:result.currency ?? null,inStock:result.inStock ?? null,
    observedAt:Date.now(),isProduct:metadata.isProduct === true };
}
async function imageEvidence(url) {
  if(!normalizeCandidateUrl(url))return {hash:null,preview:null};
  try {
    const {bytes,type}=await readBytes(url,'image/png,image/jpeg,image/webp,image/gif,image/avif');
    if(!/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(type))return {hash:null,preview:null};
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return await offscreenRequest('HASH_PRODUCT_IMAGE',{base64:btoa(binary),mime:type});
  } catch {return {hash:null,preview:null};}
}
async function referenceFor(product) {
  const source=product.sources?.[0];
  let reference={title:product.name,image:normalizeCandidateUrl(product.thumbnail,product.url),url:source?.url ?? product.url};
  try {const metadata=await inspectPage(reference.url);reference={...metadata,title:product.name || metadata.title,image:metadata.image || reference.image};}
  catch { /* Current watch remains available when its page is blocked. */ }
  const visual=await imageEvidence(reference.image);
  return {...reference,preview:visual.preview,visual};
}
async function candidateFor(item, reference, manual=false) {
  const candidate=await inspectPage(item.url);
  if(!candidate.isProduct && candidate.price == null && !manual)return null;
  candidate.title ||= item.title || candidate.merchant;
  const image=await imageEvidence(candidate.image);
  const identity=compareIdentity(reference,candidate);
  const visual=compareVisual(reference.visual,image);
  return {...candidate,preview:image.preview,image:null,evidence:identity.evidence,conflict:identity.conflict,
    visual:visual.label,rank:identity.rank+visual.rank};
}
function trackedUrls(product) {
  return new Set([product.url,product.canonicalUrl,...(product.sources??[]).flatMap((s)=>[s.url,s.canonicalUrl])].map((url)=>normalizeCandidateUrl(url)).filter(Boolean));
}
async function currentProduct(id) {const product=await getProduct(id);if(!product)throw new Error('This product was deleted. Return to your watchlist.');return product;}
export async function discoverStores(productId, query) {
  const product=await currentProduct(productId);
  query=textValue(query,240);
  if(query.length<3)throw new Error('Enter a product name or model (at least 3 characters).');
  const reference=await referenceFor(product);
  const url=new URL(SEARCH_URL);url.searchParams.set('format','rss');url.searchParams.set('q',`${query} buy price`);
  const warnings=[];let items=[];
  try {const {bytes}=await readBytes(url.href,'application/rss+xml,application/xml,text/xml');items=(await offscreenRequest('PARSE_SEARCH_RSS',{xml:new TextDecoder().decode(bytes)})).candidates;}
  catch(err){warnings.push(`Free search unavailable: ${err.message} You can paste a store URL below.`);}
  const already=trackedUrls(product);items=items.filter((item)=>!already.has(item.url)).slice(0,8);
  const candidates=[];let next=0;
  await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{
    while(next<items.length){const item=items[next++];try {const candidate=await candidateFor(item,reference);if(candidate)candidates.push(candidate);}
      catch {warnings.push(`Could not inspect ${new URL(item.url).hostname}.`);}}
  }));
  const current=await currentProduct(productId);const currentTracked=trackedUrls(current);const unique=new Map();
  for(const candidate of candidates)if(!currentTracked.has(candidate.url)&&!unique.has(candidate.url))unique.set(candidate.url,candidate);
  const {visual,...safeReference}=reference;
  return {reference:{...safeReference,image:null},candidates:[...unique.values()].sort((a,b)=>b.rank-a.rank),warnings,provider:'Bing RSS (best effort)'};
}
export async function analyzeStoreUrl(productId, url) {
  const product=await currentProduct(productId);url=normalizeCandidateUrl(url);
  if(!url)throw new Error('Enter a public HTTP or HTTPS store product URL.');
  const reference=await referenceFor(product);const candidate=await candidateFor({url},reference,true);
  const current=await currentProduct(productId);
  const {visual,...safeReference}=reference;
  return {reference:{...safeReference,image:null},candidates:[{...candidate,alreadyAdded:trackedUrls(current).has(candidate.url)}],warnings:[],provider:'Store URL'};
}
