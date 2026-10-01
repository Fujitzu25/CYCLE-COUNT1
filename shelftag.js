const shelfTagPanel=document.getElementById('shelfTagPanel');
const shelfTagState={
  type:'yellow',step:1,rows:[],headers:[],mapping:{},columns:2,gridRows:8,
  sheetWidth:215.9,sheetHeight:355.6,orientation:'portrait',
  marginTop:6,marginRight:6,marginBottom:6,marginLeft:6,
  tagWidth:85,tagHeight:38,gapX:2,gapY:2,currentSheet:1,zoom:'fit'
};
const shelfFieldDefinitions=[
  {key:'sku',label:'SKU / Item Code',aliases:['sku','sku no','sku number','item code','item no','item number','product code','stock code','article no']},
  {key:'barcode',label:'Barcode / UPC',aliases:['barcode','upc','upc code','ean','ean code','gtin','barcode no','barcode number']},
  {key:'title',label:'Description / Title',aliases:['description','item description','product description','product name','item name','title','name']},
  {key:'promoMechanism',label:'Promo Description',aliases:['promo mechanism','promo description','promo text','mechanism','promo threshold','threshold','offer','promotion']},
  {key:'promoPrice',label:'Promo Price',aliases:['promo price','promotion price','sale price','special price','discount price']},
  {key:'regularPrice',label:'Regular Price',aliases:['regular price','retail price','price','unit price','srp','selling price']},
  {key:'unit',label:'Unit of Measure',aliases:['unit','uom','unit of measure','pack size','selling unit']},
  {key:'location',label:'Location / Department',aliases:['location','department','department code','locator','aisle','shelf']},
  {key:'savings',label:'Savings',aliases:['savings','save','discount','amount saved']},
  {key:'productId',label:'Internal Product ID',aliases:['product id','internal product id','item id','internal id','product number']},
  {key:'dateCode',label:'Date Code',aliases:['date code','date','identifier date','tag date']},
  {key:'internalCode',label:'Footer Metadata / Location Codes',aliases:['footer code','internal code','metadata','metadata code','location codes','location code','bin code']}
];
const shelfEditableFieldKeys=['sku','title','barcode','regularPrice','promoPrice','promoMechanism','unit','location','dateCode','productId','internalCode'];
const shelfPaperSizes={legal:[215.9,355.6],a4:[210,297],letter:[215.9,279.4],custom:[215.9,355.6]};
const shelfCurrency=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',minimumFractionDigits:2});
const shelfById=id=>document.getElementById(id);
const shelfEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shelfNormalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const shelfMmToPx=value=>Number(value)*96/25.4;

function shelfFieldValue(row,key){
  const column=Number(shelfTagState.mapping[key]);
  return Number.isInteger(column)&&column>=0?String(row.source[column]??'').trim():'';
}
function shelfDetectMapping(headers){
  const normalized=headers.map(shelfNormalize);
  const mapping={};
  shelfFieldDefinitions.forEach(field=>{
    let index=normalized.findIndex(header=>field.aliases.includes(header));
    if(index<0&&field.key==='title')index=normalized.findIndex(header=>header.includes('description')||header.includes('product name'));
    if(index<0&&field.key==='regularPrice')index=normalized.findIndex(header=>header.includes('price')&&!header.includes('promo'));
    mapping[field.key]=index;
  });
  return mapping;
}
function shelfSetPreset(type){
  shelfTagState.type=type;
  if(type==='yellow'){
    shelfTagState.tagWidth=85;shelfTagState.tagHeight=44;shelfTagState.columns=2;shelfTagState.gridRows=7;
  }else{
    shelfTagState.tagWidth=85;shelfTagState.tagHeight=44;shelfTagState.columns=2;shelfTagState.gridRows=7;
  }
  shelfById('shelfTagWidth').value=shelfTagState.tagWidth;
  shelfById('shelfTagHeight').value=shelfTagState.tagHeight;
  shelfById('shelfColumns').value=shelfTagState.columns;
  shelfById('shelfRows').value=shelfTagState.gridRows;
  document.querySelectorAll('[data-shelf-type]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.shelfType===type)));
  document.querySelectorAll('[data-shelf-type-card]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.shelfTypeCard===type)));
  shelfRenderDataRows();
  shelfRefresh();
}
function shelfSelectedTags(){
  const tags=[];
  shelfTagState.rows.forEach(row=>{
    if(!row.selected)return;
    for(let copy=0;copy<row.quantity;copy++)tags.push(row.fields);
  });
  return tags;
}
function shelfTotals(){
  const tags=shelfSelectedTags();
  const perSheet=Math.max(1,shelfTagState.columns*shelfTagState.gridRows);
  return {tags:tags.length,perSheet,sheets:Math.ceil(tags.length/perSheet)};
}
function shelfReadControls(){
  shelfTagState.columns=Math.max(1,Number(shelfById('shelfColumns').value)||1);
  shelfTagState.gridRows=Math.max(1,Number(shelfById('shelfRows').value)||1);
  shelfTagState.tagWidth=Math.max(1,Number(shelfById('shelfTagWidth').value)||1);
  shelfTagState.tagHeight=Math.max(1,Number(shelfById('shelfTagHeight').value)||1);
  shelfTagState.gapX=Math.max(0,Number(shelfById('shelfGapX').value)||0);
  shelfTagState.gapY=Math.max(0,Number(shelfById('shelfGapY').value)||0);
  shelfTagState.marginTop=Math.max(0,Number(shelfById('shelfMarginTop').value)||0);
  shelfTagState.marginRight=Math.max(0,Number(shelfById('shelfMarginRight').value)||0);
  shelfTagState.marginBottom=Math.max(0,Number(shelfById('shelfMarginBottom').value)||0);
  shelfTagState.marginLeft=Math.max(0,Number(shelfById('shelfMarginLeft').value)||0);
  shelfTagState.orientation=shelfById('shelfOrientation').value;
}
function shelfSheetDimensions(){
  const landscape=shelfTagState.orientation==='landscape';
  const width=landscape?shelfTagState.sheetHeight:shelfTagState.sheetWidth;
  const height=landscape?shelfTagState.sheetWidth:shelfTagState.sheetHeight;
  return {width,height};
}
function shelfPreviewScale(pageWidth){
  const stageWidth=shelfTagPanel.querySelector('.shelf-preview-stage').clientWidth;
  const fitting=shelfTagState.zoom==='fit';
  const requested=fitting?1:Number(shelfTagState.zoom)/100;
  if(!stageWidth||!fitting)return requested;
  return Math.min(1,Math.max(0.2,(stageWidth-24)/shelfMmToPx(pageWidth)));
}
function shelfCheckFit(){
  const {width,height}=shelfSheetDimensions();
  const printableWidth=width-shelfTagState.marginLeft-shelfTagState.marginRight;
  const printableHeight=height-shelfTagState.marginTop-shelfTagState.marginBottom;
  const requiredWidth=shelfTagState.columns*shelfTagState.tagWidth+(shelfTagState.columns-1)*shelfTagState.gapX;
  const requiredHeight=shelfTagState.gridRows*shelfTagState.tagHeight+(shelfTagState.gridRows-1)*shelfTagState.gapY;
  const fits=requiredWidth<=printableWidth+0.001&&requiredHeight<=printableHeight+0.001;
  const badge=shelfById('shelfFitBadge');
  badge.dataset.fit=String(fits);
  badge.textContent=fits?`✓ ${shelfTagState.columns}-Column Layout Fits`:'⚠ Exceeds Printable Margin';
  shelfById('shelfFitDetails').textContent=`${shelfTagState.columns} × ${shelfTagState.gridRows} grid · ${requiredWidth.toFixed(1)} × ${requiredHeight.toFixed(1)} mm used of ${printableWidth.toFixed(1)} × ${printableHeight.toFixed(1)} mm printable`;
  return {fits,width,height};
}
function shelfEscapeText(element,text){element.textContent=text||'—';}
function shelfFormatPrice(value){
  if(value===undefined||value===null||String(value).trim()==='')return '';
  const numeric=Number(String(value).replace(/[^0-9.-]/g,''));
  return Number.isFinite(numeric)?shelfCurrency.format(numeric):String(value).trim();
}
function shelfSplitPrice(value){
  const source=String(value??'').trim();
  const numeric=Number(source.replace(/[^0-9.-]/g,''));
  if(!Number.isFinite(numeric))return {major:source,minor:''};
  const [major,minor]=Math.abs(numeric).toFixed(2).split('.');
  return {major:`${numeric<0?'-':''}${major}`,minor:`.${minor}`};
}
function shelfMakeTag(data){
  const tag=document.createElement('article');
  tag.className=`shelf-print-tag shelf-print-tag--${shelfTagState.type} shelf-tag-${shelfById('shelfTagAlignment').value} shelf-title-${shelfById('shelfTitlePosition').value}`;
  tag.classList.toggle('shelf-tag-yellow',shelfTagState.type==='yellow');
  tag.classList.toggle('guides-on',shelfById('shelfGuidesPreview').checked);
  tag.style.setProperty('--shelf-title-size',`${shelfById('shelfTitleSize').value}pt`);
  tag.style.setProperty('--shelf-price-size',`${shelfById('shelfPriceSize').value}pt`);
  tag.style.setProperty('--shelf-code-size',`${shelfById('shelfCodeSize').value}pt`);
  const title=document.createElement('div');title.className='shelf-tag-title';title.textContent=data.title||'';
  const identifiers=document.createElement('div');identifiers.className='shelf-tag-identifiers';
  if(shelfTagState.type==='yellow'){
    identifiers.append(document.createElement('span'),document.createElement('span'));
    identifiers.children[0].textContent=data.barcode||'';
    identifiers.children[1].textContent=data.productId||'';
  }else identifiers.textContent=data.dateCode||'';
  const promo=document.createElement('div');promo.className='shelf-tag-promo';promo.textContent=data.promoMechanism||'';
  const priceValue=shelfTagState.type==='yellow'?data.promoPrice:data.regularPrice;
  const parts=shelfSplitPrice(priceValue);
  const prices=document.createElement('div');prices.className='shelf-tag-prices';
  const priceLine=document.createElement('div');priceLine.className='shelf-tag-price-line';
  const major=document.createElement('strong');major.className='shelf-tag-price-major';major.textContent=parts.major;
  const minor=document.createElement('span');minor.className='shelf-tag-price-minor';minor.textContent=`${parts.minor}${data.unit||''}`;
  priceLine.append(major,minor);
  const regular=document.createElement('div');regular.className='shelf-tag-regular';
  if(data.savings)regular.textContent=`SAVE ${shelfFormatPrice(data.savings)}`;
  else if(data.regularPrice&&shelfTagState.type==='yellow')regular.textContent=`REG ${shelfFormatPrice(data.regularPrice)}`;
  prices.append(priceLine,regular);
  const metadata=document.createElement('div');metadata.className='shelf-tag-metadata';
    metadata.textContent=[...new Set([data.internalCode,data.location].filter(Boolean).flatMap(value=>value.split(/\s+/)))].join('   ');
  metadata.hidden=shelfTagState.type==='yellow';
  const barcodeBlock=document.createElement('div');barcodeBlock.className='shelf-tag-barcode-block';
  tag.classList.toggle('shelf-tag-barcode-side',shelfById('shelfBarcodePosition').value==='side');
  const barcode=document.createElementNS('http://www.w3.org/2000/svg','svg');barcode.classList.add('shelf-tag-barcode');
  const barcodeText=document.createElement('span');barcodeText.className='shelf-tag-barcode-text';barcodeText.textContent=data.barcode||data.sku||'';
  const showBarcode=shelfById('shelfShowBarcode').checked&&shelfById('shelfBarcodePosition').value!=='hidden'&&Boolean(data.barcode||data.sku);
  barcode.hidden=!showBarcode;
  barcodeText.hidden=!showBarcode;
  if(showBarcode){
    barcode.setAttribute('aria-label',`Barcode ${data.barcode||data.sku}`);
    try{JsBarcode(barcode,data.barcode||data.sku,{format:'CODE128',displayValue:false,margin:0,height:30,width:1.3,lineColor:'#111',background:'transparent'});}
    catch{barcode.hidden=true;}
  }
  barcodeBlock.append(barcode,barcodeText);
  if(shelfTagState.type==='white')tag.append(title,identifiers,metadata,prices,barcodeBlock);
  else tag.append(title,identifiers,promo,prices,metadata,barcodeBlock);
  return tag;
}
function shelfBuildPages(){
  shelfReadControls();
  const {width,height}=shelfCheckFit();
  const tags=shelfSelectedTags();
  const capacity=Math.max(1,shelfTagState.columns*shelfTagState.gridRows);
  const pages=Math.max(1,Math.ceil(tags.length/capacity));
  shelfTagState.currentSheet=Math.min(Math.max(1,shelfTagState.currentSheet),pages);
  const root=shelfById('shelfPages');
  root.replaceChildren();
  const zoom=shelfPreviewScale(width);
  const margins=`${shelfTagState.marginTop}mm ${shelfTagState.marginRight}mm ${shelfTagState.marginBottom}mm ${shelfTagState.marginLeft}mm`;
  for(let pageIndex=0;pageIndex<pages;pageIndex++){
    const page=document.createElement('div');
    page.className=`shelf-page${pageIndex+1===shelfTagState.currentSheet?' is-current':''}`;
    page.dataset.sheet=String(pageIndex+1);
    page.setAttribute('aria-label',`Sheet ${pageIndex+1} of ${pages}`);
    page.style.width=`${width}mm`;page.style.height=`${height}mm`;page.style.padding=margins;
    page.style.setProperty('--shelf-page-width',`${width}mm`);page.style.setProperty('--shelf-page-height',`${height}mm`);
    page.style.setProperty('--shelf-margin-top',`${shelfTagState.marginTop}mm`);page.style.setProperty('--shelf-margin-right',`${shelfTagState.marginRight}mm`);page.style.setProperty('--shelf-margin-bottom',`${shelfTagState.marginBottom}mm`);page.style.setProperty('--shelf-margin-left',`${shelfTagState.marginLeft}mm`);
    page.style.transform=`scale(${zoom})`;
    const grid=document.createElement('div');grid.className='shelf-tag-grid';
    grid.style.gridTemplateColumns=`repeat(${shelfTagState.columns},${shelfTagState.tagWidth}mm)`;
    grid.style.gridTemplateRows=`repeat(${shelfTagState.gridRows},${shelfTagState.tagHeight}mm)`;
    grid.style.gap=`${shelfTagState.gapY}mm ${shelfTagState.gapX}mm`;
    grid.style.setProperty('--shelf-columns',String(shelfTagState.columns));grid.style.setProperty('--shelf-rows',String(shelfTagState.gridRows));grid.style.setProperty('--shelf-tag-width',`${shelfTagState.tagWidth}mm`);grid.style.setProperty('--shelf-tag-height',`${shelfTagState.tagHeight}mm`);grid.style.setProperty('--shelf-gap-x',`${shelfTagState.gapX}mm`);grid.style.setProperty('--shelf-gap-y',`${shelfTagState.gapY}mm`);
    tags.slice(pageIndex*capacity,(pageIndex+1)*capacity).forEach(data=>grid.append(shelfMakeTag(data)));
    page.append(grid);root.append(page);
  }
  const frame=shelfById('shelfPreviewFrame');
  frame.style.height=`${shelfMmToPx(height)*zoom}px`;
  frame.style.width=`${shelfMmToPx(width)*zoom}px`;
  shelfById('shelfPageNumber').textContent=`Page ${shelfTagState.currentSheet} of ${pages}`;
  shelfById('shelfZoomReadout').textContent=`${Math.round(zoom*100)}% view`;
  shelfById('shelfPagePrev').disabled=shelfTagState.currentSheet<=1;
  shelfById('shelfPageNext').disabled=shelfTagState.currentSheet>=pages;
  shelfById('shelfTotalTags').textContent=`${tags.length.toLocaleString()} physical tag${tags.length===1?'':'s'}`;
  shelfById('shelfTagPrintTop').textContent=`Print (${tags.length.toLocaleString()})`;
  shelfById('shelfTotalTagsSummary').textContent=tags.length.toLocaleString();
  shelfById('shelfTotalTagsPaperSummary').textContent=tags.length.toLocaleString();
  shelfById('shelfTagsPerSheet').textContent=capacity.toLocaleString();
  shelfById('shelfEstimatedSheets').textContent=Math.ceil(tags.length/capacity).toLocaleString();
  shelfById('shelfPrintTopPdf').disabled=tags.length===0;
  shelfById('shelfPrintDirect').disabled=tags.length===0;
  shelfById('shelfExportPdf').disabled=tags.length===0;
  shelfById('shelfDataSummary').textContent=`${shelfTagState.rows.length.toLocaleString()} imported SKU${shelfTagState.rows.length===1?'':'s'} · ${tags.length.toLocaleString()} selected physical tag${tags.length===1?'':'s'}`;
  shelfById('shelfTagSummary').textContent=tags.length?`${tags.length.toLocaleString()} physical tag${tags.length===1?'':'s'} · ${Math.ceil(tags.length/capacity).toLocaleString()} sheet${Math.ceil(tags.length/capacity)===1?'':'s'} estimated`:'Import data and select SKUs to preview tags.';
  shelfById('shelfEmptyData').hidden=shelfTagState.rows.length>0;
  shelfById('shelfDataTable').hidden=shelfTagState.rows.length===0;
  shelfById('shelfCurrentSheetStatus').textContent=tags.length?`Previewing ${Math.min(capacity,tags.length-(shelfTagState.currentSheet-1)*capacity)} tags on this sheet.`:'No tags to preview yet.';
}
function shelfRenderDataRows(){
  shelfById('shelfEmptyData').hidden=shelfTagState.rows.length>0;
  shelfById('shelfDataTable').hidden=shelfTagState.rows.length===0;
  shelfById('shelfRowsBody').replaceChildren(...shelfTagState.rows.map((row,index)=>{
    const tr=document.createElement('tr');tr.classList.toggle('is-unselected',!row.selected);
    const selectCell=document.createElement('td');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=row.selected;checkbox.dataset.row=index;checkbox.dataset.shelfSelect='true';checkbox.setAttribute('aria-label',`Select SKU ${row.fields.sku||index+1}`);selectCell.append(checkbox);
    const valueCells=shelfEditableFieldKeys.map(key=>{
      const td=document.createElement('td');
      const input=document.createElement(key==='promoMechanism'?'textarea':'input');if(input.tagName==='INPUT')input.type='text';input.className='shelf-edit-input';input.value=row.fields[key]||'';input.dataset.row=index;input.dataset.shelfField=key;
      if(key==='promoMechanism'){input.rows=2;input.maxLength=120;}
      input.setAttribute('aria-label',`${shelfFieldDefinitions.find(field=>field.key===key)?.label||key} for ${row.fields.sku||`row ${index+1}`}`);
      if(key==='sku')input.classList.add('shelf-row-sku');
      if(key==='promoMechanism')input.classList.add('shelf-promo-edit');
      td.append(input);return td;
    });
    const quantityCell=document.createElement('td');const quantity=document.createElement('input');quantity.type='number';quantity.min='0';quantity.step='1';quantity.max='9999';quantity.className='shelf-qty-input';quantity.value=row.quantity;quantity.dataset.row=index;quantity.dataset.shelfQuantity='true';quantity.setAttribute('aria-label',`Tag quantity for ${row.fields.sku||'row '+(index+1)}`);quantityCell.append(quantity);tr.append(selectCell,...valueCells,quantityCell);
    return tr;
  }));
}
function shelfRefresh(){
  if(!shelfTagPanel)return;
  shelfReadControls();
  shelfById('shelfTitleSizeValue').textContent=`${shelfById('shelfTitleSize').value} pt`;
  shelfById('shelfPriceSizeValue').textContent=`${shelfById('shelfPriceSize').value} pt`;
  shelfById('shelfCodeSizeValue').textContent=`${shelfById('shelfCodeSize').value} pt`;
  shelfRenderLivePreview();
  shelfBuildPages();
}
function shelfRenderLivePreview(){
  const selected=shelfTagState.rows.find(row=>row.selected&&row.quantity>0)||shelfTagState.rows[0];
  const tagType=shelfTagState.type==='yellow'?'Yellow PP Tag':'White ShelfTag';
  [['shelfLivePreview','shelfLivePreviewType'],['shelfDataLivePreview','shelfDataLivePreviewType']].forEach(([targetId,typeId])=>{
    const target=shelfById(targetId);
    shelfById(typeId).textContent=tagType;
    if(!selected){
      target.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Import product data to preview a tag.'}));
      return;
    }
    const tag=shelfMakeTag(selected.fields);
    const scale=Math.min(1,520/shelfMmToPx(shelfTagState.tagWidth));
    tag.style.transform=`scale(${scale})`;
    tag.style.transformOrigin='top left';
    target.style.width=`${shelfMmToPx(shelfTagState.tagWidth)*scale}px`;
    target.style.height=`${shelfMmToPx(shelfTagState.tagHeight)*scale}px`;
    target.replaceChildren(tag);
  });
}
function shelfApplyMapping(renderMapper=true){
  shelfTagState.rows=shelfTagState.rows.map(row=>{
    if(row.manual)return row;
    const fields={};shelfFieldDefinitions.forEach(field=>fields[field.key]=shelfFieldValue(row,field.key));
    if(!fields.sku)fields.sku=fields.barcode;
    return {...row,fields};
  });
  if(renderMapper)shelfRenderMapper();
  shelfRenderDataRows();shelfRefresh();
}
function shelfRenderMapper(){
  const mapper=shelfById('shelfMapper');
  if(!shelfTagState.headers.length){mapper.hidden=true;return;}
  mapper.hidden=false;
  mapper.replaceChildren(...shelfFieldDefinitions.map(field=>{
    const label=document.createElement('label');label.textContent=field.label;
    const select=document.createElement('select');select.dataset.shelfMap=field.key;
    const skip=document.createElement('option');skip.value='-1';skip.textContent='Skip field';select.append(skip);
    shelfTagState.headers.forEach((header,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=header||`Column ${index+1}`;select.append(option);});
    select.value=String(shelfTagState.mapping[field.key]??-1);label.append(select);return label;
  }));
}
function shelfImportFile(file){
  if(!file)return;
  if(!/\.(csv|xls|xlsx)$/i.test(file.name)){shelfById('shelfImportStatus').textContent='Choose a CSV or Excel workbook (.csv, .xls, .xlsx).';return;}
  if(typeof XLSX==='undefined'){shelfById('shelfImportStatus').textContent='Spreadsheet reader is unavailable. Check the connection and try again.';return;}
  shelfById('shelfImportStatus').textContent=`Reading ${file.name}…`;
  file.arrayBuffer().then(buffer=>{
    const workbook=XLSX.read(buffer,{type:'array',raw:false,cellDates:false});
    const sheetName=workbook.SheetNames.find(name=>workbook.Sheets[name]?.['!ref']);
    if(!sheetName)throw new Error('The workbook has no non-empty worksheet.');
    const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:false,defval:''});
    let headerIndex=matrix.findIndex((row,index)=>index<20&&row.filter(value=>String(value).trim()).length>=2&&row.some(value=>/sku|barcode|upc|description|price/i.test(String(value))));
    if(headerIndex<0)headerIndex=matrix.findIndex(row=>row.some(value=>String(value).trim()));
    if(headerIndex<0)throw new Error('No column headings were found.');
    shelfTagState.headers=matrix[headerIndex].map((value,index)=>String(value||`Column ${index+1}`).trim());
    shelfTagState.mapping=shelfDetectMapping(shelfTagState.headers);
    shelfTagState.rows=matrix.slice(headerIndex+1).filter(row=>row.some(value=>String(value??'').trim())).map(source=>({source,selected:true,quantity:1,fields:{}}));
    if(!shelfTagState.rows.length)throw new Error('No product rows were found below the column headings.');
    shelfById('shelfImportStatus').textContent=`Loaded ${shelfTagState.rows.length.toLocaleString()} rows from ${file.name}. Review the suggested field mapping.`;
    shelfApplyMapping();shelfGoToStep(2);
  }).catch(error=>{
    console.error('Shelf tag import failed:',error);
    shelfById('shelfImportStatus').textContent=error.message||'Could not read this file.';
  });
}
function shelfGoToStep(step){
  shelfTagState.step=Math.min(5,Math.max(1,Number(step)||1));
  document.querySelectorAll('[data-shelf-step]').forEach(button=>button.setAttribute('aria-current',String(Number(button.dataset.shelfStep)===shelfTagState.step?'step':'false')));
  document.querySelectorAll('.shelf-step-panel').forEach(panel=>{panel.hidden=Number(panel.dataset.shelfPanel)!==shelfTagState.step;});
  if(shelfTagState.step===5)shelfRefresh();
}
function shelfUpdatePaperSize(){
  const size=shelfById('shelfPaperSize').value;
  if(size!=='custom'){
    [shelfTagState.sheetWidth,shelfTagState.sheetHeight]=shelfPaperSizes[size]||shelfPaperSizes.legal;
    shelfById('shelfSheetWidth').value=shelfTagState.sheetWidth;
    shelfById('shelfSheetHeight').value=shelfTagState.sheetHeight;
    shelfById('shelfSheetWidth').disabled=true;shelfById('shelfSheetHeight').disabled=true;
  }else{
    shelfById('shelfSheetWidth').disabled=false;shelfById('shelfSheetHeight').disabled=false;
    shelfTagState.sheetWidth=Number(shelfById('shelfSheetWidth').value)||215.9;
    shelfTagState.sheetHeight=Number(shelfById('shelfSheetHeight').value)||355.6;
  }
  shelfRefresh();
}
function shelfPreparePrint(){
  shelfReadControls();
  const {width,height}=shelfSheetDimensions();
  shelfTagPanel.style.setProperty('--shelf-page-width',`${width}mm`);
  shelfTagPanel.style.setProperty('--shelf-page-height',`${height}mm`);
  let pageRule=document.getElementById('shelfDynamicPageRule');
  if(!pageRule){pageRule=document.createElement('style');pageRule.id='shelfDynamicPageRule';document.head.append(pageRule);}
  pageRule.textContent=`@media print{@page{size:${width}mm ${height}mm;margin:0}}`;
  shelfById('shelfStep5').hidden=false;
  shelfTagPanel.querySelectorAll('.shelf-page').forEach(page=>page.hidden=false);
  document.body.classList.add('print-shelftag');
}
function shelfPrint(){
  if(!shelfTotals().tags)return;
  shelfPreparePrint();
  const cleanup=()=>document.body.classList.remove('print-shelftag');
  window.addEventListener('afterprint',cleanup,{once:true});
  window.print();
  setTimeout(cleanup,1500);
}
async function shelfExportPdf(){
  const {jsPDF}=window.jspdf||{};
  if(typeof html2canvas!=='function'||typeof jsPDF!=='function'){
    shelfById('shelfImportStatus').textContent='PDF tools did not load. Check your connection, then try Export PDF again.';return;
  }
  const tags=shelfSelectedTags();if(!tags.length)return;
  shelfById('shelfExportPdf').disabled=true;shelfById('shelfPrintTopPdf').disabled=true;
  shelfById('shelfImportStatus').textContent='Rendering print sheets to PDF…';
  shelfRefresh();
  const pages=[...shelfById('shelfPages').children];
  const {width,height}=shelfSheetDimensions();
  const pdf=new jsPDF({orientation:width>height?'landscape':'portrait',unit:'mm',format:[width,height],compress:true});
  try{
    for(let index=0;index<pages.length;index++){
      const page=pages[index];page.hidden=false;page.style.display='grid';page.style.transform='none';
      const canvas=await html2canvas(page,{scale:3,backgroundColor:'#ffffff',useCORS:true,logging:false});
      if(index)pdf.addPage([width,height],width>height?'landscape':'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg',0.98),'JPEG',0,0,width,height,undefined,'FAST');
      page.hidden=index+1!==shelfTagState.currentSheet;
    }
    pdf.save(`shelftag-${new Date().toISOString().slice(0,10)}.pdf`);
    shelfById('shelfImportStatus').textContent=`Saved ${pages.length} print sheet${pages.length===1?'':'s'} as PDF.`;
  }catch(error){
    console.error('Shelf tag PDF export failed:',error);
    shelfById('shelfImportStatus').textContent='Could not create the PDF. Try Print Directly and choose Save as PDF.';
  }finally{
    const previewZoom=shelfPreviewScale(width);
    pages.forEach(page=>{page.hidden=false;page.style.display='';page.style.transform=`scale(${previewZoom})`;});
    shelfById('shelfExportPdf').disabled=false;shelfById('shelfPrintTopPdf').disabled=false;
  }
}

shelfTagPanel.querySelectorAll('[data-shelf-type]').forEach(button=>button.addEventListener('click',()=>shelfSetPreset(button.dataset.shelfType)));
shelfTagPanel.querySelectorAll('[data-shelf-type-card]').forEach(button=>button.addEventListener('click',()=>shelfSetPreset(button.dataset.shelfTypeCard)));
shelfTagPanel.querySelectorAll('[data-shelf-step]').forEach(button=>button.addEventListener('click',()=>shelfGoToStep(button.dataset.shelfStep)));
shelfTagPanel.querySelectorAll('[data-shelf-next]').forEach(button=>button.addEventListener('click',()=>shelfGoToStep(shelfTagState.step+1)));
shelfTagPanel.querySelectorAll('[data-shelf-prev]').forEach(button=>button.addEventListener('click',()=>shelfGoToStep(shelfTagState.step-1)));
shelfById('shelfFileInput').addEventListener('change',event=>{shelfImportFile(event.target.files[0]);event.target.value='';});
shelfById('shelfUpload').addEventListener('dragover',event=>{event.preventDefault();event.currentTarget.classList.add('is-dragging');});
shelfById('shelfUpload').addEventListener('dragleave',event=>event.currentTarget.classList.remove('is-dragging'));
shelfById('shelfUpload').addEventListener('drop',event=>{event.preventDefault();event.currentTarget.classList.remove('is-dragging');shelfImportFile(event.dataTransfer.files[0]);});
shelfById('shelfMapper').addEventListener('change',event=>{if(event.target.matches('[data-shelf-map]')){shelfTagState.mapping[event.target.dataset.shelfMap]=Number(event.target.value);shelfApplyMapping(false);}});
shelfById('shelfRowsBody').addEventListener('change',event=>{
  const index=Number(event.target.dataset.row);const row=shelfTagState.rows[index];if(!row)return;
  if(event.target.matches('[data-shelf-field]'))row.fields[event.target.dataset.shelfField]=event.target.value.trim();
  if(event.target.matches('[data-shelf-select]'))row.selected=event.target.checked;
  if(event.target.matches('[data-shelf-quantity]'))row.quantity=Math.max(0,Math.min(9999,Math.floor(Number(event.target.value)||0)));
  event.target.closest('tr')?.classList.toggle('is-unselected',!row.selected);
  shelfRefresh();
});
shelfById('shelfRowsBody').addEventListener('input',event=>{
  if(!event.target.matches('[data-shelf-field]'))return;
  const row=shelfTagState.rows[Number(event.target.dataset.row)];
  if(!row)return;
  row.fields[event.target.dataset.shelfField]=event.target.value;
  shelfRefresh();
});
shelfById('shelfGuidesPreview').addEventListener('change',shelfRefresh);
window.addEventListener('resize',shelfRefresh);
shelfById('shelfPaperSize').addEventListener('change',shelfUpdatePaperSize);
shelfById('shelfOrientation').addEventListener('change',()=>{shelfTagState.orientation=shelfById('shelfOrientation').value;shelfRefresh();});
shelfTagPanel.querySelectorAll('[data-shelf-control]').forEach(control=>control.addEventListener(control.type==='range'?'input':'change',()=>{
  if(control.id==='shelfSheetWidth')shelfTagState.sheetWidth=Number(control.value)||1;
  if(control.id==='shelfSheetHeight')shelfTagState.sheetHeight=Number(control.value)||1;
  shelfRefresh();
}));
shelfById('shelfPagePrev').addEventListener('click',()=>{shelfTagState.currentSheet--;shelfRefresh();});
shelfById('shelfPageNext').addEventListener('click',()=>{shelfTagState.currentSheet++;shelfRefresh();});
shelfTagPanel.querySelectorAll('[data-shelf-zoom]').forEach(button=>button.addEventListener('click',()=>{shelfTagState.zoom=button.dataset.shelfZoom==='fit'?'fit':Number(button.dataset.shelfZoom);shelfTagPanel.querySelectorAll('[data-shelf-zoom]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));shelfRefresh();}));
shelfById('shelfTagPrintTop').addEventListener('click',shelfPrint);
shelfById('shelfPrintDirect').addEventListener('click',shelfPrint);
shelfById('shelfExportPdf').addEventListener('click',shelfExportPdf);
shelfById('shelfPrintTopPdf').addEventListener('click',shelfExportPdf);
shelfById('shelfBackButton').addEventListener('click',()=>document.getElementById('backFromShelfTag').click());
shelfById('shelfSelectAll').addEventListener('click',()=>{shelfTagState.rows.forEach(row=>row.selected=true);shelfRenderDataRows();shelfRefresh();});
shelfById('shelfSelectNone').addEventListener('click',()=>{shelfTagState.rows.forEach(row=>row.selected=false);shelfRenderDataRows();shelfRefresh();});
shelfById('shelfAddRow').addEventListener('click',()=>{
  const fields=Object.fromEntries(shelfEditableFieldKeys.map(key=>[key,'']));
  fields.unit='/PC';
  shelfTagState.rows.push({source:[],selected:true,quantity:1,fields,manual:true});
  shelfRenderDataRows();shelfRefresh();
  shelfById('shelfRowsBody').lastElementChild?.querySelector('[data-shelf-field=sku]')?.focus();
});
shelfById('shelfApplyBulkPromo').addEventListener('click',()=>{
  const promo=shelfById('shelfBulkPromo').value.trim();
  if(!promo)return;
  shelfTagState.rows.forEach(row=>{if(row.selected)row.fields.promoMechanism=promo;});
  shelfRenderDataRows();shelfRefresh();
});
window.addEventListener('afterprint',()=>{document.body.classList.remove('print-shelftag');shelfById('shelfStep5').hidden=shelfTagState.step!==5;});
shelfSetPreset('yellow');
shelfUpdatePaperSize();
shelfGoToStep(1);
shelfRefresh();
