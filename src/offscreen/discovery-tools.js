import { normalizeCandidateUrl, textValue } from '../shared/discovery.js';
function firstProduct(value, depth=0) {
  if (depth>8 || !value || typeof value!=='object') return null;
  if (Array.isArray(value)) { for(const node of value){const result=firstProduct(node,depth+1);if(result)return result;} return null; }
  if ([value['@type']].flat().some((type)=>typeof type==='string'&&/^(Product|ProductModel)$/i.test(type))) return value;
  return firstProduct(value['@graph'],depth+1);
}
export function extractProductMetadata(doc, base) {
  let product=null;
  for(const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { product=firstProduct(JSON.parse(script.textContent)); if(product)break; } catch { /* malformed metadata */ }
  }
  const og=(property)=>doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content');
  const image=Array.isArray(product?.image)?product.image[0]:product?.image;
  const rawImage=typeof image==='string'?image:image?.url ?? image?.contentUrl;
  const brand=typeof product?.brand==='string'?product.brand:product?.brand?.name;
  const title=textValue(product?.name || og('og:title') || doc.title);
  return { title, brand:textValue(brand,80), mpn:textValue(product?.mpn,80),
    gtin:textValue(product?.gtin ?? product?.gtin13 ?? product?.gtin14 ?? product?.gtin12 ?? product?.gtin8,80),
    sku:textValue(product?.sku,80), variant:textValue([product?.model,product?.size,product?.color].filter((v)=>typeof v==='string').join(' ')),
    image:normalizeCandidateUrl(rawImage || doc.querySelector('[itemprop="image"]')?.getAttribute('src') || og('og:image'),base),
    productImage:Boolean(rawImage), isProduct:Boolean(product),
    canonicalUrl:normalizeCandidateUrl(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),base),
  };
}
export function parseSearchRss(xml) {
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror')||!doc.querySelector('rss > channel')) throw new Error('Free search is blocked or unavailable. Try pasting a store product URL.');
  const candidates=[];const seen=new Set();
  for(const item of doc.querySelectorAll('channel > item')) {
    const url=normalizeCandidateUrl(item.querySelector('link')?.textContent);
    if(!url||seen.has(url))continue;
    const host=new URL(url).hostname;
    if(/(^|\.)(bing\.com|google\.com|duckduckgo\.com|wikipedia\.org|youtube\.com|facebook\.com|pinterest\.com)$/.test(host))continue;
    seen.add(url); candidates.push({url,title:textValue(item.querySelector('title')?.textContent),snippet:textValue(item.querySelector('description')?.textContent,300)});
    if(candidates.length===8)break;
  }
  return {candidates};
}
export function imageDimensions(bytes, mime) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(mime==='image/png' && bytes.length>=24 && view.getUint32(0)===0x89504e47 && view.getUint32(4)===0x0d0a1a0a && view.getUint32(12)===0x49484452) return [view.getUint32(16),view.getUint32(20)];
  if(mime==='image/gif' && bytes.length>=10 && String.fromCharCode(...bytes.subarray(0,3))==='GIF') return [view.getUint16(6,true),view.getUint16(8,true)];
  if(mime==='image/jpeg' && bytes.length>=4 && view.getUint16(0)===0xffd8) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset]!==255)return null;
      while(offset<bytes.length&&bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9||marker===0xda)return null;
      if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
      if(offset+2>bytes.length)return null;
      const length=view.getUint16(offset);if(length<2||offset+length>bytes.length)return null;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if(length<8)return null;return [view.getUint16(offset+5),view.getUint16(offset+3)];
      }
      offset+=length;
    }
  }
  if(mime==='image/webp' && bytes.length>=30 && String.fromCharCode(...bytes.subarray(0,4))==='RIFF' && String.fromCharCode(...bytes.subarray(8,12))==='WEBP') {
    const kind=String.fromCharCode(...bytes.subarray(12,16));
    if(kind==='VP8X') return [1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)];
    if(kind==='VP8 ' && bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a)return [view.getUint16(26,true)&0x3fff,view.getUint16(28,true)&0x3fff];
    if(kind==='VP8L' && bytes[20]===0x2f){const packed=view.getUint32(21,true);return [(packed&0x3fff)+1,((packed>>>14)&0x3fff)+1];}
  }
  // Fail closed for formats without a bounded dimensions parser (e.g. AVIF).
  return null;
}
export async function hashProductImage({ base64, mime }) {
  if(typeof base64!=='string'||base64.length>2800000||!/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(mime??'')) return {hash:null,preview:null};
  let bitmap;
  try {
    const binary=atob(base64);const bytes=Uint8Array.from(binary,(char)=>char.charCodeAt(0));
    const dimensions=imageDimensions(bytes,mime);
    if(!dimensions||dimensions[0]<32||dimensions[1]<32||dimensions[0]*dimensions[1]>16000000)return {hash:null,preview:null};
    const blob=new Blob([bytes],{type:mime});
    bitmap=await createImageBitmap(blob);
    if(bitmap.width<32||bitmap.height<32||bitmap.width*bitmap.height>16000000)return {hash:null,preview:null};
    const canvas=document.createElement('canvas');canvas.width=9;canvas.height=8;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,9,8);ctx.drawImage(bitmap,0,0,9,8);
    const pixels=ctx.getImageData(0,0,9,8).data;
    const gray=Array.from({length:72},(_,i)=>(pixels[i*4]*299+pixels[i*4+1]*587+pixels[i*4+2]*114)/1000);
    const mean=gray.reduce((a,b)=>a+b,0)/72;const variance=gray.reduce((a,b)=>a+(b-mean)**2,0)/72;
    let hash='';for(let row=0;row<8;row++)for(let col=0;col<8;col++)hash+=gray[row*9+col]>gray[row*9+col+1]?'1':'0';
    const thumb=document.createElement('canvas');const ratio=Math.min(160/bitmap.width,160/bitmap.height,1);thumb.width=Math.max(1,Math.round(bitmap.width*ratio));thumb.height=Math.max(1,Math.round(bitmap.height*ratio));
    thumb.getContext('2d').drawImage(bitmap,0,0,thumb.width,thumb.height);
    return {hash:variance<25?null:hash,preview:thumb.toDataURL('image/png'),width:bitmap.width,height:bitmap.height};
  } catch { return {hash:null,preview:null}; }
  finally {bitmap?.close();}
}
