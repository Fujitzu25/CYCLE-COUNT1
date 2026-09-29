const productLookupCache=new Map();
const productLookupNavigation=$('productLookupNav');
const productLookupPanel=$('productLookupPanel');
const productLookupViews=[...document.querySelectorAll('.page-shell > section')];
let previousProductLookupView=null;
let productLookupRequest=0;

function normalizeProductSearch(value){
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
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

function groupProductLookupMatches(rows,query){
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
    product.exact=product.exact||normalizeProductSearch(sku)===query||normalizeProductSearch(barcode)===query;
  });
  return [...grouped.values()].sort((left,right)=>Number(right.exact)-Number(left.exact)||left.sku.localeCompare(right.sku));
}

function appendProductDetail(list,label,value){
  const item=document.createElement('div');
  const term=document.createElement('dt');
  const description=document.createElement('dd');
  term.textContent=label;
  description.textContent=value||'—';
  item.append(term,description);
  list.appendChild(item);
}

function renderProductLookupResults(products,query){
  const root=$('productLookupResults');
  root.replaceChildren();
  if(!products.length){
    const empty=document.createElement('p');
    empty.className='product-lookup-empty';
    empty.textContent='No products matched that SKU or barcode.';
    root.appendChild(empty);
    $('productLookupStatus').textContent=`No matches for ${query}.`;
    return;
  }

  const visible=products.slice(0,100);
  $('productLookupStatus').textContent=`${products.length.toLocaleString()} matching product${products.length===1?'':'s'}${products.length>visible.length?`; showing the first ${visible.length}. Refine your search for more specific results.`:''}`;
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
    appendProductDetail(details,'UPC / Barcode',[...product.barcodes].join(', '));
    appendProductDetail(details,'Supplier',product.supplier);
    appendProductDetail(details,'Department',product.department);
    appendProductDetail(details,'Category',product.categories.join(' / '));
    appendProductDetail(details,'Master tab',product.sheet);
    article.append(heading,details);
    root.appendChild(article);
  });
}

async function searchMasterCatalog(event){
  event.preventDefault();
  const query=normalizeProductSearch($('productLookupInput').value);
  const request=++productLookupRequest;
  $('productLookupResults').replaceChildren();
  if(query.length<2){
    $('productLookupStatus').textContent='Enter at least 2 letters or numbers to search the master catalog.';
    return;
  }
  $('productLookupForm').setAttribute('aria-busy','true');
  $('productLookupStatus').textContent='Loading matching master records…';
  try{
    const rows=await loadProductLookupShard(query.slice(0,2));
    if(request!==productLookupRequest)return;
    const matches=rows.filter(row=>normalizeProductSearch(row[0]).startsWith(query)||normalizeProductSearch(row[1]).startsWith(query));
    renderProductLookupResults(groupProductLookupMatches(matches,query),$('productLookupInput').value.trim());
  }catch(error){
    if(request!==productLookupRequest)return;
    $('productLookupStatus').textContent='Could not load the master catalog. Check your connection and try again.';
    console.error('Master catalog search failed:',error);
  }finally{
    if(request===productLookupRequest)$('productLookupForm').removeAttribute('aria-busy');
  }
}

function openProductLookup(){
  previousProductLookupView=productLookupViews.map(view=>view.hidden);
  productLookupViews.forEach(view=>{view.hidden=true});
  productLookupPanel.hidden=false;
  productLookupNavigation.setAttribute('aria-current','page');
  $('productLookupInput').focus();
}

function closeProductLookup(){
  productLookupPanel.hidden=true;
  productLookupNavigation.removeAttribute('aria-current');
  if(previousProductLookupView){
    productLookupViews.forEach((view,index)=>{view.hidden=previousProductLookupView[index]});
  }else{
    showStep(items.length?2:1);
  }
  previousProductLookupView=null;
}

productLookupNavigation.addEventListener('click',()=>{
  if(productLookupPanel.hidden)openProductLookup();
  else closeProductLookup();
});
$('backFromProductLookup').addEventListener('click',closeProductLookup);
$('productLookupForm').addEventListener('submit',searchMasterCatalog);
$('clearProductLookup').addEventListener('click',()=>{
  productLookupRequest++;
  $('productLookupInput').value='';
  $('productLookupResults').replaceChildren();
  $('productLookupStatus').textContent='Enter a SKU or barcode to search the master catalog.';
  $('productLookupInput').focus();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!productLookupPanel.hidden)closeProductLookup();
});