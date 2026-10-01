const productLookupCache=new Map();
const productDescriptionCache=new Map();
const productImageCache=new Map();
const homeNavigation=$('homeNav');
const homePanel=$('homePanel');
const countSheetNavigation=$('countSheetNav');
const productLookupNavigation=$('productLookupNav');
const productLookupPanel=$('productLookupPanel');
const hotlistNavigation=$('hotlistNav');
const hotlistPanel=$('hotlistPanel');
const announcementsNavigation=$('announcementsNav');
const announcementsPanel=$('announcementsPanel');
const shelfTagNavigation=$('shelfTagNav');
const shelfTagLookupPanel=$('shelfTagPanel');
const productLookupViews=[...document.querySelectorAll('.page-shell > section')];
let previousProductLookupView=null;
let activeLookupPanel=null;
let activeLookupNavigation=null;
let productLookupRequest=0;
const HOTLIST_CATEGORIES=['MILK','CIGARETTES','LIQUORS'];
const HOTLIST_STORAGE_KEY='cycle-count-hotlist-shift-v1';
const MASTER_DETAILS_STORAGE_KEY='cycle-count-master-details-v1';
let hotlistProducts=[];
let activeHotlistCategory='MILK';
let hotlistShiftState=readLocalObject(HOTLIST_STORAGE_KEY);
let masterProductDetails=Object.fromEntries(Object.entries(readLocalObject(MASTER_DETAILS_STORAGE_KEY)).map(([sku,details])=>[normalizeMasterSku(sku),details]));

function readLocalObject(key){
  try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{return {};}
}

function normalizeProductSearch(value){
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function resolveProductImage(name,barcodes){
  const key=JSON.stringify([name,...barcodes]);
  if(productImageCache.has(key))return productImageCache.get(key);
  const request=(async()=>{
    for(const barcode of barcodes){
      if(!barcode)continue;
      try{
        const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=image_front_url,image_url`;
        const response=await fetch(url);
        if(!response.ok)continue;
        const data=await response.json();
        const image=data.status===1&&(data.product?.image_front_url||data.product?.image_url);
        if(image)return image;
      }catch{}
    }
    return '';
  })();
  productImageCache.set(key,request);
  return request;
}

async function loadProductLookupShard(prefix){
  if(productLookupCache.has(prefix)){
    const cached=productLookupCache.get(prefix);
    productLookupCache.delete(prefix);
    productLookupCache.set(prefix,cached);
    return cached;
  }
  const url=new URL(`master-index/${encodeURIComponent(prefix)}.json.gz`,document.baseURI);
  const response=await fetch(url);
  if(response.status===404)return [];
  if(!response.ok)throw new Error(`Catalog request failed (${response.status})`);
  if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress the catalog index.');
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  const records=await new Response(stream).json();
  productLookupCache.set(prefix,records);
  while(productLookupCache.size>2)productLookupCache.delete(productLookupCache.keys().next().value);
  return records;
}

async function loadProductDescriptionShard(prefix){
  if(productDescriptionCache.has(prefix))return productDescriptionCache.get(prefix);
  const url=new URL(`master-description-index/${encodeURIComponent(prefix)}.json.gz`,document.baseURI);
  const response=await fetch(url);
  if(response.status===404)return [];
  if(!response.ok)throw new Error(`Description index request failed (${response.status})`);
  if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress the description index.');
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  const records=await new Response(stream).json();
  productDescriptionCache.set(prefix,records);
  return records;
}

function groupProductLookupMatches(rows,query,searchMode){
  const grouped=new Map();
  rows.forEach(row=>{
    const [sku,barcode,description,department,categories,supplier,sheet]=row;
    const key=JSON.stringify([sku,description,department,categories,supplier,sheet]);
    let product=grouped.get(key);
    if(!product){
      product={sku,barcodes:new Set(),description,department,categories,supplier,sheet,exact:false};
      grouped.set(key,product);
    }
    if(barcode)product.barcodes.add(barcode);
    const exact=searchMode==='description'?normalizeProductSearch(description)===query:normalizeProductSearch(searchMode==='sku'?sku:barcode)===query;
    product.exact=product.exact||exact;
  });
  return [...grouped.values()].sort((left,right)=>Number(right.exact)-Number(left.exact)||left.sku.localeCompare(right.sku));
}

function appendProductDetail(list,label,value){
  const item=document.createElement('div');
  item.className=`product-lookup-detail-${label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`;
  const term=document.createElement('dt');
  const description=document.createElement('dd');
  term.textContent=label;
  description.textContent=value||'—';
  item.append(term,description);
  list.appendChild(item);
}

function createProductImage(url,label,barcodes=[]){
  const frame=document.createElement('div');
  frame.className='product-image-frame';
  const placeholder=document.createElement('span');
  placeholder.className='product-image-placeholder';
  placeholder.textContent='Looking for photo…';
  const image=document.createElement('img');
  image.alt=label?`${label} product photo`:'';
  image.loading='lazy';
  image.style.visibility='hidden';
  const googleLink=document.createElement('a');
  googleLink.className='product-image-google-link';
  googleLink.href=`https://www.google.com/search?tbm=isch&q=${encodeURIComponent([label,...barcodes].filter(Boolean).join(' '))}`;
  googleLink.target='_blank';
  googleLink.rel='noopener noreferrer';
  googleLink.textContent='Google Images';
  googleLink.setAttribute('aria-label',`Search Google Images for ${label||'this product'}`);
  frame.append(placeholder,image,googleLink);
  const tryImage=source=>new Promise(resolve=>{
    if(!source){resolve(false);return;}
    image.onload=()=>{image.style.visibility='visible';placeholder.hidden=true;resolve(true);};
    image.onerror=()=>resolve(false);
    image.src=source;
  });
  const loadPhoto=async()=>{
    if(frame.dataset.loading==='true')return;
    frame.dataset.loading='true';
    if(url&&await tryImage(url))return;
    const source=await resolveProductImage(label,barcodes);
    if(source&&await tryImage(source))return;
    placeholder.textContent='Photo not found';
  };
  if(url)loadPhoto();
  else if('IntersectionObserver'in window){
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();loadPhoto();}
    });
    observer.observe(frame);
  }else loadPhoto();
  return frame;
}

function lookupMasterDetails(sku){
  return masterProductDetails[normalizeMasterSku(sku)]||{};
}

function renderProductLookupResults(products,query,total=products.length,searchMode='sku'){
  const root=$('productLookupResults');
  root.replaceChildren();
  if(!products.length){
    const empty=document.createElement('p');
    empty.className='product-lookup-empty';
    empty.textContent=`No products matched that ${searchMode==='description'?'description':searchMode}.`;
    root.appendChild(empty);
    $('productLookupStatus').textContent=`No matches for ${query}.`;
    return;
  }

  const visible=products.slice(0,100);
  $('productLookupStatus').textContent=`${total.toLocaleString()} matching product${total===1?'':'s'}${total>visible.length?`; showing the first ${visible.length}. Refine your search for more specific results.`:''}`;
  visible.forEach(product=>{
    const article=document.createElement('article');
    article.className='product-lookup-result';
    const heading=document.createElement('div');
    heading.className='product-lookup-result-heading';
    const title=document.createElement('h3');
    title.textContent=product.description||'Description not available';
    const sku=document.createElement('span');
    sku.className='product-lookup-sku';
    sku.textContent=`SKU ${product.sku}`;
    heading.append(title,sku);
    const details=document.createElement('dl');
    details.className='product-lookup-details';
    const content=document.createElement('div');
    content.className='product-lookup-result-content';
    const detailColumn=document.createElement('div');
    appendProductDetail(details,'UPC / Barcode',[...product.barcodes].join(', '));
    appendProductDetail(details,'Supplier',product.supplier);
    appendProductDetail(details,'Department',product.department);
    appendProductDetail(details,'Category',product.categories.join(' / '));
    appendProductDetail(details,'Master tab',product.sheet);
    const masterDetails=lookupMasterDetails(product.sku);
    appendProductDetail(details,'Price',masterDetails.price);
    appendProductDetail(details,'Locator',masterDetails.locator);
    detailColumn.appendChild(details);
    content.append(detailColumn,createProductImage(product.image_url,product.description,[...product.barcodes]));
    article.append(heading,content);
    root.appendChild(article);
  });
}

async function searchMasterCatalog(event){
  event.preventDefault();
  const query=normalizeProductSearch($('productLookupInput').value);
  const searchMode=$('productLookupMode').value;
  const request=++productLookupRequest;
  $('productLookupResults').replaceChildren();
  if(query.length<2){
    $('productLookupStatus').textContent='Enter at least 2 letters or numbers to search the master catalog.';
    return;
  }
  $('productLookupForm').setAttribute('aria-busy','true');
  $('productLookupStatus').textContent='Loading matching master records…';
  try{
    if(searchMode==='description'){
      const rows=await loadProductDescriptionShard(query.slice(0,2));
      if(request!==productLookupRequest)return;
      const candidateSkus=[...new Set(rows.filter(row=>normalizeProductSearch(row[1]).includes(query)).map(row=>String(row[0])))];
      const visibleSkus=new Set(candidateSkus.slice(0,100));
      const skuPrefixes=[...new Set([...visibleSkus].map(sku=>normalizeProductSearch(sku).slice(0,2)).filter(Boolean))];
      const masterShards=await Promise.all(skuPrefixes.map(loadProductLookupShard));
      if(request!==productLookupRequest)return;
      const matches=masterShards.flat().filter(row=>visibleSkus.has(String(row[0]))&&normalizeProductSearch(row[2]).includes(query));
      const products=groupProductLookupMatches(matches,query,searchMode);
      renderProductLookupResults(products,$('productLookupInput').value.trim(),candidateSkus.length,searchMode);
    }else{
      const rows=await loadProductLookupShard(query.slice(0,2));
      if(request!==productLookupRequest)return;
      const column=searchMode==='sku'?0:1;
      const matches=rows.filter(row=>normalizeProductSearch(row[column]).startsWith(query));
      renderProductLookupResults(groupProductLookupMatches(matches,query,searchMode),$('productLookupInput').value.trim(),undefined,searchMode);
    }
  }catch(error){
    if(request!==productLookupRequest)return;
    $('productLookupStatus').textContent='Could not load the master catalog. Check your connection and try again.';
    console.error('Master catalog search failed:',error);
  }finally{
    if(request===productLookupRequest)$('productLookupForm').removeAttribute('aria-busy');
  }
}

function openLookupPanel(panel,navigation,focusTarget){
  if(activeLookupPanel)activeLookupNavigation.removeAttribute('aria-current');
  countSheetNavigation.removeAttribute('aria-current');
  productLookupViews.forEach(view=>{view.hidden=true});
  panel.hidden=false;
  navigation.setAttribute('aria-current','page');
  activeLookupPanel=panel;
  activeLookupNavigation=navigation;
  if(focusTarget)$(focusTarget).focus();
}

function closeLookupPanel(){
  if(!activeLookupPanel)return;
  activeLookupPanel.hidden=true;
  activeLookupNavigation.removeAttribute('aria-current');
  showHomePanel();
}
function renderHomeDashboard(){
  const totalItems=typeof items==='undefined'?0:items.length;
  $('homeItemCount').textContent=totalItems.toLocaleString();
  const online=navigator.onLine;
  $('homeSystemHealth').textContent=online?'All systems ready':'Offline · local tools available';
  $('homeHealth').dataset.online=String(online);
  const lastUpdated=new Date(document.lastModified);
  $('homeLastUpdated').textContent=Number.isNaN(lastUpdated.getTime())?new Date().toLocaleDateString():lastUpdated.toLocaleDateString();
}
function showHomePanel(){
  if(activeLookupNavigation)activeLookupNavigation.removeAttribute('aria-current');
  countSheetNavigation.removeAttribute('aria-current');
  productLookupViews.forEach(view=>{view.hidden=true});
  homePanel.hidden=false;
  homeNavigation.setAttribute('aria-current','page');
  activeLookupPanel=homePanel;
  activeLookupNavigation=homeNavigation;
  previousProductLookupView=null;
  renderHomeDashboard();
}
function showCountSheetWorkspace(){
  if(activeLookupNavigation)activeLookupNavigation.removeAttribute('aria-current');
  productLookupViews.forEach(view=>{view.hidden=true});
  activeLookupPanel=null;
  activeLookupNavigation=null;
  previousProductLookupView=null;
  homeNavigation.removeAttribute('aria-current');
  countSheetNavigation.setAttribute('aria-current','page');
  if(items.length&&typeof renderCountSheet==='function'){
    renderCountSheet();
    $('countSheetPanel').hidden=false;
  }else{
    $('introRow')?.removeAttribute('hidden');
    $('stepper')?.removeAttribute('hidden');
    showStep(1);
  }
}

homeNavigation.addEventListener('click',showHomePanel);
countSheetNavigation.addEventListener('click',showCountSheetWorkspace);
document.querySelectorAll('[data-home-open]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.homeOpen).click()));
window.addEventListener('online',renderHomeDashboard);
window.addEventListener('offline',renderHomeDashboard);
productLookupNavigation.addEventListener('click',()=>{
  if(activeLookupPanel===productLookupPanel)closeLookupPanel();
  else openLookupPanel(productLookupPanel,productLookupNavigation,'productLookupInput');
});
hotlistNavigation.addEventListener('click',()=>{
  if(activeLookupPanel===hotlistPanel)closeLookupPanel();
  else openLookupPanel(hotlistPanel,hotlistNavigation,'hotlistSearch');
});
$('backFromProductLookup').addEventListener('click',closeLookupPanel);
$('backFromHotlist').addEventListener('click',closeLookupPanel);
announcementsNavigation.addEventListener('click',()=>{
  if(activeLookupPanel===announcementsPanel)closeLookupPanel();
  else openLookupPanel(announcementsPanel,announcementsNavigation);
});
shelfTagNavigation.addEventListener('click',()=>{
  if(activeLookupPanel===shelfTagLookupPanel)closeLookupPanel();
  else openLookupPanel(shelfTagLookupPanel,shelfTagNavigation);
});
$('backFromShelfTag').addEventListener('click',closeLookupPanel);
showHomePanel();
$('productLookupForm').addEventListener('submit',searchMasterCatalog);
$('productLookupMode').addEventListener('change',()=>{
  productLookupRequest++;
  const mode=$('productLookupMode').value;
  $('productLookupInput').placeholder=mode==='description'?'Enter at least 2 description characters':`Enter at least 2 ${mode==='sku'?'SKU':'barcode'} characters`;
  $('productLookupInput').value='';
  $('productLookupResults').replaceChildren();
  $('productLookupHint').textContent=mode==='description'?'Searches product descriptions. Partial text is supported.':`Searches by ${mode==='sku'?'SKU':'barcode'}. Partial codes are supported.`;
  $('productLookupStatus').textContent=`Search the master catalog by ${mode}.`;
  $('productLookupInput').focus();
});
$('clearProductLookup').addEventListener('click',()=>{
  productLookupRequest++;
  $('productLookupInput').value='';
  $('productLookupResults').replaceChildren();
  $('productLookupStatus').textContent='Enter a SKU or barcode to search the master catalog.';
  $('productLookupInput').focus();
});

function hotlistStorageKey(product){
  return `${product.category}|${String(product.sku||'').trim()}`;
}

function getHotlistShift(product){
  const key=hotlistStorageKey(product);
  if(!hotlistShiftState[key]){
    hotlistShiftState[key]={
      buffer_qty:Number(product.buffer_qty)||0,
      display_qty:Number(product.display_qty)||0,
      withdrawal_qty:Number(product.withdrawal_qty)||0,
      previous_day_sales:Number(product.previous_day_sales)||0,
      applied_withdrawal_qty:0
    };
  }
  return hotlistShiftState[key];
}

function normalizedHotlistText(value){
  return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

function addHotlistDetail(list,label,value){
  appendProductDetail(list,label,value);
}

function renderHotlist(){
  const root=$('hotlistResults');
  if(!root)return;
  const query=normalizedHotlistText($('hotlistSearch').value);
  const products=hotlistProducts.filter(product=>{
    if(product.category!==activeHotlistCategory)return false;
    return !query||[product.sku,product.barcode,product.name].some(value=>normalizedHotlistText(value).includes(query));
  });
  root.replaceChildren();
  $('hotlistCount').textContent=`${products.length} item${products.length===1?'':'s'}`;
  if(!products.length){
    const empty=document.createElement('p');
    empty.className='hotlist-empty';
    empty.textContent=hotlistProducts.length?'No items in this category match your search.':'No hotlist data found. Add items to hotlist_inventory.json.';
    root.appendChild(empty);
    return;
  }
  products.forEach(product=>{
    const article=document.createElement('article');
    article.className='hotlist-result';
    article.dataset.sku=product.sku;
    article.dataset.category=product.category;
    const image=createProductImage(product.image_url,product.name,[product.barcode].filter(Boolean));
    const main=document.createElement('div');
    main.className='hotlist-result-main';
    const heading=document.createElement('div');
    heading.className='hotlist-result-heading';
    const title=document.createElement('h4');
    title.textContent=product.name||'Description not available';
    const badge=document.createElement('span');
    badge.className='hotlist-badge';
    badge.textContent=`SKU ${product.sku}`;
    heading.append(title,badge);
    const details=document.createElement('dl');
    details.className='product-lookup-details hotlist-metadata';
    const masterDetails=lookupMasterDetails(product.sku);
    addHotlistDetail(details,'UPC / Barcode',product.barcode);
    addHotlistDetail(details,'Supplier',product.supplier);
    addHotlistDetail(details,'Department',product.department);
    addHotlistDetail(details,'Category',product.product_category);
    addHotlistDetail(details,'Master tab',product.master_tab);
    addHotlistDetail(details,'Price',masterDetails.price||product.price);
    addHotlistDetail(details,'Locator',masterDetails.locator||product.locator);
    const fields=document.createElement('div');
    fields.className='hotlist-fields';
    const shift=getHotlistShift(product);
    [['buffer_qty','Buffer Qty'],['display_qty','Display Qty'],['withdrawal_qty','Withdrawal Qty'],['previous_day_sales','Previous Day Sales']].forEach(([field,label])=>{
      const fieldLabel=document.createElement('label');
      fieldLabel.textContent=label;
      const input=document.createElement('input');
      input.type='number';
      input.min='0';
      input.step='1';
      input.inputMode='numeric';
      input.value=String(shift[field]??0);
      input.dataset.field=field;
      input.setAttribute('aria-label',`${label} for ${product.name||product.sku}`);
      fieldLabel.appendChild(input);
      fields.appendChild(fieldLabel);
    });
    const withdrawButton=document.createElement('button');
    withdrawButton.className='hotlist-log-button';
    withdrawButton.type='button';
    withdrawButton.dataset.action='withdraw';
    withdrawButton.textContent='Log Withdrawal';
    fields.appendChild(withdrawButton);
    main.append(heading,details,fields);
    article.append(image,main);
    root.appendChild(article);
  });
}

function persistHotlistState(){
  try{localStorage.setItem(HOTLIST_STORAGE_KEY,JSON.stringify(hotlistShiftState));}
  catch(error){console.error('Could not save hotlist shift data:',error);}
}

function handleHotlistInput(event){
  const input=event.target.closest('input[data-field]');
  if(!input)return;
  const article=input.closest('.hotlist-result');
  const product=hotlistProducts.find(item=>item.category===article.dataset.category&&String(item.sku)===article.dataset.sku);
  if(!product)return;
  const value=Math.max(0,Math.floor(Number(input.value)||0));
  input.value=String(value);
  getHotlistShift(product)[input.dataset.field]=value;
  persistHotlistState();
}

function handleHotlistAction(event){
  const button=event.target.closest('button[data-action="withdraw"]');
  if(!button)return;
  const article=button.closest('.hotlist-result');
  const product=hotlistProducts.find(item=>item.category===article.dataset.category&&String(item.sku)===article.dataset.sku);
  if(!product)return;
  const shift=getHotlistShift(product);
  const requested=Number(shift.withdrawal_qty)||0;
  const applied=Number(shift.applied_withdrawal_qty)||0;
  const delta=requested-applied;
  if(delta<=0){$('hotlistSaveStatus').textContent='Enter a higher cumulative withdrawal quantity before logging.';return;}
  if(delta>shift.buffer_qty){$('hotlistSaveStatus').textContent='Withdrawal exceeds the current warehouse buffer quantity.';return;}
  shift.buffer_qty-=delta;
  shift.display_qty+=delta;
  shift.applied_withdrawal_qty=requested;
  persistHotlistState();
  renderHotlist();
  $('hotlistSaveStatus').textContent=`Logged ${delta} unit${delta===1?'':'s'} for ${product.name||product.sku}.`;
}

function compileShiftData(){
  return hotlistProducts.map(product=>{
    const shift=getHotlistShift(product);
    const masterDetails=lookupMasterDetails(product.sku);
    return {...product,price:masterDetails.price||product.price||'',locator:masterDetails.locator||product.locator||'',buffer_qty:shift.buffer_qty,display_qty:shift.display_qty,withdrawal_qty:shift.withdrawal_qty,previous_day_sales:shift.previous_day_sales,applied_withdrawal_qty:shift.applied_withdrawal_qty};
  });
}

function saveShiftData(){
  const data=compileShiftData();
  persistHotlistState();
  console.log('Saved hotlist shift data:',data);
  $('hotlistSaveStatus').textContent=`Saved ${data.length} hotlist items in this browser.`;
}

function normalizeMasterHeader(value){
  return String(value||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function normalizeMasterSku(value){
  return String(value??'').trim().replace(/\.0$/,'').toUpperCase();
}

async function loadPublishedMasterDetails(){
  try{
    const response=await fetch(new URL('master-details.json',document.baseURI));
    if(response.status===404){
      $('masterfileStatus').textContent='Published mapping unavailable. Upload the workbook to load price and locator details.';
      return;
    }
    if(!response.ok)throw new Error(`Published master data request failed (${response.status})`);
    const publishedDetails=await response.json();
    if(!publishedDetails||typeof publishedDetails!=='object'||Array.isArray(publishedDetails))throw new Error('Published master data is invalid.');
    const cachedDetails=masterProductDetails;
    masterProductDetails={...publishedDetails};
    Object.entries(cachedDetails).forEach(([sku,details])=>{
      masterProductDetails[sku]={
        ...(publishedDetails[sku]||{}),
        price:details.price||publishedDetails[sku]?.price||'',
        locator:details.locator||publishedDetails[sku]?.locator||''
      };
    });
    $('masterfileStatus').textContent=`Using price and locator data for ${Object.keys(masterProductDetails).length.toLocaleString()} SKUs.`;
    renderHotlist();
    if($('productLookupInput').value.trim())searchMasterCatalog({preventDefault(){}});
  }catch(error){
    $('masterfileStatus').textContent='Could not load published price and locator details. Upload the workbook to continue.';
    console.error('Could not load published price and locator data:',error);
  }
}

async function importPriceLocatorMaster(file){
  if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader is unavailable. Check your internet connection.');
  const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',raw:false});
  const details={};
  const skuAliases=['sku','sku no','sku number','sku no.','sku no','product code','sku no'];
  const priceAliases=['retail cost','retail price','price','selling price','unit price'];
  const locatorAliases=['locator code','locator','location','bin location','aisle bin'];
  workbook.SheetNames.forEach(sheetName=>{
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:false,defval:''});
    let columns=null;
    rows.slice(0,20).some((row,index)=>{
      const headers=row.map(normalizeMasterHeader);
      const skuIndex=headers.findIndex(header=>skuAliases.includes(header));
      const priceIndex=headers.findIndex(header=>priceAliases.includes(header));
      const locatorIndex=headers.findIndex(header=>locatorAliases.includes(header));
      if(skuIndex>=0&&(priceIndex>=0||locatorIndex>=0)){columns={index,skuIndex,priceIndex,locatorIndex};return true;}
      return false;
    });
    if(!columns)return;
    rows.slice(columns.index+1).forEach(row=>{
      const sku=normalizeMasterSku(row[columns.skuIndex]);
      if(!sku)return;
      const record=details[sku]||(details[sku]={price:'',locator:''});
      if(columns.priceIndex>=0&&row[columns.priceIndex]!==''&&record.price===''){
        const price=String(row[columns.priceIndex]).trim();
        record.price=Number.isFinite(Number(price))?Number(price).toFixed(2):price;
      }
      if(columns.locatorIndex>=0&&row[columns.locatorIndex]){
        const locator=String(row[columns.locatorIndex]).trim();
        const locators=new Set((record.locator||'').split(' / ').filter(Boolean));
        locators.add(locator);
        record.locator=[...locators].join(' / ');
      }
    });
  });
  if(!Object.keys(details).length)throw new Error('No SKU, price, or locator columns were found in the workbook.');
  masterProductDetails=details;
  try{localStorage.setItem(MASTER_DETAILS_STORAGE_KEY,JSON.stringify(details));}
  catch(error){console.error('Could not cache masterfile details:',error);}
  $('masterfileStatus').textContent=`Loaded price and locator data for ${Object.keys(details).length.toLocaleString()} SKUs from ${file.name}.`;
  renderHotlist();
  if($('productLookupInput').value.trim())searchMasterCatalog({preventDefault(){}});
}

async function loadHotlist(){
  try{
    const response=await fetch(new URL('hotlist_inventory.json',document.baseURI));
    if(!response.ok)throw new Error(`Hotlist request failed (${response.status})`);
    const data=await response.json();
    if(!Array.isArray(data))throw new Error('Hotlist JSON must be an array.');
    hotlistProducts=data.filter(product=>HOTLIST_CATEGORIES.includes(String(product.category||'').toUpperCase())).map(product=>({
      ...product,
      sku:String(product.sku||'').trim(),
      category:String(product.category).toUpperCase()
    }));
    renderHotlist();
  }catch(error){
    $('hotlistResults').innerHTML='<p class="hotlist-empty">Could not load hotlist_inventory.json. Serve this app over HTTP and check the data file.</p>';
    console.error('Hotlist data load failed:',error);
  }
}

document.querySelectorAll('[data-hotlist-category]').forEach(tab=>tab.addEventListener('click',()=>{
  activeHotlistCategory=tab.dataset.hotlistCategory;
  document.querySelectorAll('[data-hotlist-category]').forEach(item=>item.setAttribute('aria-selected',String(item===tab)));
  renderHotlist();
}));
$('hotlistSearch').addEventListener('input',renderHotlist);
$('hotlistResults').addEventListener('input',handleHotlistInput);
$('hotlistResults').addEventListener('click',handleHotlistAction);
$('saveShiftData').addEventListener('click',saveShiftData);
$('masterfileUpload').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  $('masterfileStatus').textContent=`Reading ${file.name}…`;
  try{await importPriceLocatorMaster(file);}
  catch(error){$('masterfileStatus').textContent=error.message;console.error('Masterfile import failed:',error);}
});
document.querySelectorAll('[data-hotlist-category]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.hotlistCategory===activeHotlistCategory)));
if(Object.keys(masterProductDetails).length)$('masterfileStatus').textContent=`Using saved price and locator data for ${Object.keys(masterProductDetails).length.toLocaleString()} SKUs.`;
loadHotlist();
loadPublishedMasterDetails();

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&activeLookupPanel)closeLookupPanel();
});