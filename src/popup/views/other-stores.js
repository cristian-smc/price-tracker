import { displayPrice } from '../components/currency-badge.js';
import { referenceCurrency } from '../../shared/product-state.js';
import { normalizeCandidateUrl } from '../../shared/discovery.js';

/** Same-popup discovery; candidate metadata is rendered as text, never HTML. */
export function renderOtherStores({ product, onBack, onSearch, onAnalyze, onAdd, isActive = () => true }) {
  const wrap = document.createElement('div'); wrap.className = 'other-stores-view';
  const back = document.createElement('button'); back.type='button';back.className='back-btn';back.textContent='‹ Back to product';back.addEventListener('click',onBack);
  const title=document.createElement('h2');title.textContent='Other stores';
  const reference=document.createElement('div');reference.className='discovery-reference';
  const name=document.createElement('strong');name.textContent=product.name;reference.appendChild(name);
  const disclosure=document.createElement('p');disclosure.className='hint';
  disclosure.textContent='Search sends this query to Bing. Candidate pages and images are fetched from stores; image comparison stays on this device. Free search can be blocked or incomplete.';
  const form=document.createElement('form');form.className='discovery-search';
  const query=document.createElement('input');query.type='search';query.value=product.name;query.maxLength=240;query.setAttribute('aria-label','Search other stores');
  const search=document.createElement('button');search.type='submit';search.className='btn btn-primary';search.textContent='Search';form.append(query,search);
  const paste=document.createElement('details');paste.className='discovery-paste';
  const summary=document.createElement('summary');summary.textContent='Paste a store product URL';
  const pasteForm=document.createElement('form');pasteForm.className='discovery-search';
  const url=document.createElement('input');url.type='url';url.placeholder='https://store.com/product';url.setAttribute('aria-label','Candidate store URL');
  const analyze=document.createElement('button');analyze.type='submit';analyze.className='btn btn-secondary';analyze.textContent='Compare';pasteForm.append(url,analyze);paste.append(summary,pasteForm);
  const status=document.createElement('div');status.className='action-status';status.setAttribute('aria-live','polite');
  const results=document.createElement('div');results.className='discovery-results';
  wrap.append(back,title,reference,disclosure,form,paste,status,results);
  let generation=0;const added=new Set((product.sources??[]).flatMap((s)=>[s.url,s.canonicalUrl]).map((value)=>normalizeCandidateUrl(value)).filter(Boolean));
  let referenceData={title:product.name,preview:null};
  function showReference(data) {
    referenceData=data;reference.replaceChildren();
    if(data.preview) reference.appendChild(image(data.preview,'Tracked product'));
    const body=document.createElement('div');const label=document.createElement('strong');label.textContent=product.name;
    const hint=document.createElement('p');hint.className='hint';hint.textContent='Compare model, size, condition and appearance before adding.';
    body.append(label,hint);reference.appendChild(body);
  }
  async function run(action) {
    const request=++generation;search.disabled=true;analyze.disabled=true;
    status.removeAttribute('role');status.textContent='Finding product details and comparing images…';
    try {
      const response=await action();if(request!==generation||!isActive())return;
      showReference(response.reference ?? referenceData);results.replaceChildren();
      for(const candidate of response.candidates??[])results.appendChild(card(candidate));
      status.textContent=[response.provider,`${response.candidates?.length ?? 0} candidate(s).`,...(response.warnings??[])].filter(Boolean).join(' ');
      if(!response.candidates?.length)status.textContent+=' No usable matches found. Try an exact model number or paste a store URL.';
    } catch(err) {
      if(request!==generation||!isActive())return;
      status.setAttribute('role','alert');status.textContent=err.message || 'Search failed. Try a store URL.';
    } finally {if(request===generation){search.disabled=false;analyze.disabled=false;}}
  }
  form.addEventListener('submit',(event)=>{event.preventDefault();run(()=>onSearch(query.value.trim()));});
  pasteForm.addEventListener('submit',(event)=>{event.preventDefault();run(()=>onAnalyze(url.value.trim()));});
  function card(candidate) {
    const el=document.createElement('article');el.className='discovery-card';el.dataset.url=candidate.url;
    const heading=document.createElement('h3');heading.textContent=candidate.title;
    const merchant=document.createElement('span');merchant.className='discovery-merchant';merchant.textContent=candidate.merchant;
    const images=document.createElement('div');images.className='discovery-images';
    images.append(imagePair(referenceData.preview,'Tracked item'),imagePair(candidate.preview,'Other store'));
    const price=document.createElement('p');price.className='discovery-price';
    price.textContent=candidate.price!=null&&candidate.currency ? displayPrice(candidate.price,candidate.currency) : 'Price unavailable';
    if(candidate.currency&&candidate.currency!==referenceCurrency(product))price.textContent+=' · Not compared';
    const visual=document.createElement('p');visual.className='hint';visual.textContent=candidate.visual || 'Visual comparison unavailable';
    const evidence=document.createElement('ul');evidence.className='discovery-evidence';
    for(const text of candidate.evidence??[]){const item=document.createElement('li');item.textContent=text;evidence.appendChild(item);}
    if(candidate.conflict)el.classList.add('possible-mismatch');
    const controls=document.createElement('div');controls.className='discovery-actions';
    const preview=document.createElement('a');preview.href=candidate.url;preview.target='_blank';preview.rel='noopener noreferrer';preview.textContent='Preview product ↗';
    const confirmLabel=document.createElement('label');confirmLabel.className='discovery-confirm';
    const confirmed=document.createElement('input');confirmed.type='checkbox';
    confirmLabel.append(confirmed,document.createTextNode(candidate.conflict?'I checked the differences: same model and variant':'Same model and variant — I checked'));
    const button=document.createElement('button');button.type='button';button.className='btn btn-primary';
    const cardStatus=document.createElement('span');cardStatus.className='action-status';cardStatus.setAttribute('aria-live','polite');
    const canonical=normalizeCandidateUrl(candidate.url);let busy=false;
    const already=()=>candidate.alreadyAdded||added.has(canonical);
    function update(){button.textContent=already()?'Already added':'Add source';button.disabled=already()||!confirmed.checked||busy;}
    confirmed.addEventListener('change',update);
    button.addEventListener('click',async()=>{
      if(busy||!confirmed.checked||already())return;
      busy=true;update();button.textContent='Adding…';cardStatus.textContent='';
      try {
        const response=await onAdd(candidate.url);
        for(const source of response.product?.sources??[])for(const value of [source.url,source.canonicalUrl]){const safe=normalizeCandidateUrl(value);if(safe)added.add(safe);}
        added.add(canonical);cardStatus.textContent='Source added. The watch settings were kept.';
      } catch(err) {
        if(err.code==='already_added'){added.add(canonical);cardStatus.textContent='This source is already tracked.';}
        else {cardStatus.setAttribute('role','alert');cardStatus.textContent=err.message || 'Could not add source. Try again.';}
      } finally {busy=false;update();}
    });
    update();controls.append(preview,button);el.append(merchant,heading,images,price,visual,evidence,confirmLabel,controls,cardStatus);
    return el;
  }
  return wrap;
}
function image(src,alt){const img=document.createElement('img');img.src=src;img.alt=alt;img.loading='lazy';img.addEventListener('error',()=>{img.replaceWith(document.createTextNode('Image unavailable'));});return img;}
function imagePair(src,label){const figure=document.createElement('figure');if(src)figure.appendChild(image(src,label));else {const empty=document.createElement('span');empty.className='discovery-image-empty';empty.textContent='No image';figure.appendChild(empty);}const caption=document.createElement('figcaption');caption.textContent=label;figure.appendChild(caption);return figure;}
