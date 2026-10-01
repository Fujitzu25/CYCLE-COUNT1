const sampleItems=[
  {supplier:'Prince Retail Group',locator:'WH-E-B2L2',sku:'18053',barcode:'480034402053',description:'OLD ENGLISH WHSIRE HT 150ML',copy:'008'},
  {supplier:'Prince Retail Group',locator:'WH-E-B2L2',sku:'18074',barcode:'480034400322',description:'SILVER SWAN CANE VNGR 1893ML',copy:'011'},
  {supplier:'Prince Retail Group',locator:'WH-E-B2L2',sku:'287652',barcode:'480034404021',description:'SILVER SWAN DOUBLE BUENAS PACK',copy:'001'},
  {supplier:'Prince Retail Group',locator:'WH-E-B3L1',sku:'281104',barcode:'480034403948',description:'PRINCE CHOCOLATE CREAM BISCUIT',copy:'004'},
  {supplier:'Mabuhay Foods',locator:'WH-G-B3L1',sku:'19221',barcode:'480034401227',description:'MANG TOMATO SAUCE 250G',copy:'006'},
  {supplier:'Mabuhay Foods',locator:'WH-G-B3L1',sku:'33018',barcode:'480034400711',description:'BEAR BRAND MILK POWDER',copy:'003'}
];
let items=[];let currentStep=1;var start=0;
const $=id=>document.getElementById(id);
const localCycleDataKey='fuji-cycle-count-local-data-v1';
const localCycleHistoryKey='fuji-cycle-count-local-history-v1';
const localCycleDatabaseName='fuji-cycle-count-local-v1';
let inventoryTouchedThisSession=false;
let localCycleDatabasePromise;
function readLocalCycleData(){try{return JSON.parse(localStorage.getItem(localCycleDataKey)||'{}')}catch(error){return {}}}
const restoredLocalCycleData=readLocalCycleData();
if(Array.isArray(restoredLocalCycleData.items))items=restoredLocalCycleData.items;
function openLocalCycleDatabase(){
  if(!('indexedDB' in window))return Promise.reject(new Error('IndexedDB is unavailable'));
  if(!localCycleDatabasePromise){
    localCycleDatabasePromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(localCycleDatabaseName,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('state'))request.result.createObjectStore('state')};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('Could not open local database'));
      request.onblocked=()=>reject(new Error('Local database upgrade is blocked'));
    });
  }
  return localCycleDatabasePromise;
}
function writeLocalInventory(snapshot){
  return openLocalCycleDatabase().then(database=>new Promise((resolve,reject)=>{
    const transaction=database.transaction('state','readwrite');
    transaction.objectStore('state').put(snapshot,'inventory');
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error('Could not save inventory'));
    transaction.onabort=()=>reject(transaction.error||new Error('Inventory save was interrupted'));
  }));
}
function readIndexedLocalInventory(){
  return openLocalCycleDatabase().then(database=>new Promise((resolve,reject)=>{
    const request=database.transaction('state','readonly').objectStore('state').get('inventory');
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error||new Error('Could not read saved inventory'));
  }));
}
function readLocalCycleHistory(){try{const history=JSON.parse(localStorage.getItem(localCycleHistoryKey)||'[]');return Array.isArray(history)?history:[]}catch(error){return []}}
function recordLocalHistory(action,details=''){
  const history=readLocalCycleHistory();
  history.unshift({time:new Date().toISOString(),action,details,rowCount:items.length});
  try{localStorage.setItem(localCycleHistoryKey,JSON.stringify(history))}catch(error){console.warn('Could not save local activity history:',error)}
}
function persistLocalCycleData(action,details=''){
  const snapshot={version:1,savedAt:new Date().toISOString(),items,store:$('storeField')?.value||'',date:$('dateField')?.value||''};
  try{
    localStorage.setItem(localCycleDataKey,JSON.stringify({version:1,savedAt:snapshot.savedAt,store:snapshot.store,date:snapshot.date}));
  }catch(error){
    console.warn('Could not save local session details:',error);
  }
  writeLocalInventory(snapshot).catch(error=>{
    console.error('Could not save inventory in IndexedDB:',error);
    if(items.length<=1000){
      try{localStorage.setItem(localCycleDataKey,JSON.stringify(snapshot));return}catch(fallbackError){console.warn('Local storage fallback failed:',fallbackError)}
    }
    toast('Inventory is loaded, but this browser could not save it locally. Download a backup.');
  });
  if(action)recordLocalHistory(action,details);
}
const panels={1:$('importPanel'),2:$('dataPanel'),3:$('configurePanel')};
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),2600)}
function showStep(step){currentStep=step;Object.entries(panels).forEach(([key,panel])=>{panel.hidden=Number(key)!==step});$('countSheetPanel').hidden=true;document.querySelectorAll('.step').forEach(el=>{const n=Number(el.dataset.step);el.classList.toggle('active',n===step);el.classList.toggle('done',n<step)});if(step===3&&typeof refreshLayoutPreview==='function')refreshLayoutPreview();window.scrollTo({top:0,behavior:'smooth'})}
const inventoryPageSize=100;
let inventoryPage=1;
let inventoryViewCache={key:'',indexes:[]};
function getInventoryPager(){
  let pager=$('inventoryPagination');
  if(pager)return pager;
  pager=document.createElement('div');
  pager.id='inventoryPagination';
  pager.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px;color:#647069;font-size:12px';
  pager.innerHTML='<span id="inventoryPageSummary"></span><div style="display:flex;gap:8px"><button class="secondary-button" id="inventoryPrevPage" type="button">Previous</button><button class="secondary-button" id="inventoryNextPage" type="button">Next</button></div>';
  $('inventoryBody').closest('.table-wrap').after(pager);
  $('inventoryPrevPage').onclick=()=>{if(inventoryPage>1){inventoryPage--;renderItems(false)}};
  $('inventoryNextPage').onclick=()=>{const pageCount=Math.max(1,Math.ceil(inventoryViewCache.indexes.length/inventoryPageSize));if(inventoryPage<pageCount){inventoryPage++;renderItems(false)}};
  return pager;
}
function renderItems(rebuildView=true){
  const term=$('searchInput').value.trim().toLowerCase();
  const sort=$('sortSelect').value;
  const key=`${term}\u0000${sort}`;
  if(rebuildView||inventoryViewCache.key!==key){
    const indexes=[];
    items.forEach((item,index)=>{
      const searchable=`${item.supplier||''} ${item.locator||''} ${item.sku||''} ${item.barcode||''} ${item.description||''}`.toLowerCase();
      if(!term||searchable.includes(term))indexes.push(index);
    });
    const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
    indexes.sort((firstIndex,secondIndex)=>collator.compare(String(items[firstIndex][sort]||''),String(items[secondIndex][sort]||'')));
    inventoryViewCache={key,indexes};
  }
  const indexes=inventoryViewCache.indexes;
  const pageCount=Math.max(1,Math.ceil(indexes.length/inventoryPageSize));
  inventoryPage=Math.min(inventoryPage,pageCount);
  const startIndex=(inventoryPage-1)*inventoryPageSize;
  const pageIndexes=indexes.slice(startIndex,startIndex+inventoryPageSize);
  $('inventoryBody').innerHTML=pageIndexes.map(index=>{const item=items[index];return`<tr><td><span class="locator">${item.locator||''}</span></td><td class="code">${item.sku||''}</td><td class="code">${item.barcode||'<span style="color:#b05b48">NO BARCODE</span>'}</td><td>${item.description||''}</td><td><div class="item-actions"><button class="icon-button edit-item" data-index="${index}" title="Edit item">✎</button><button class="icon-button delete-item" data-index="${index}" title="Delete item">×</button></div></td></tr>`}).join('');
  $('rowCount').textContent=`${indexes.length} of ${items.length} rows`;
  $('emptyState').hidden=indexes.length>0;
  const pager=getInventoryPager();
  pager.hidden=indexes.length<=inventoryPageSize;
  $('inventoryPageSummary').textContent=indexes.length?`Showing ${startIndex+1}–${Math.min(startIndex+pageIndexes.length,indexes.length)} of ${indexes.length} matching rows · Page ${inventoryPage} of ${pageCount}`:'No matching rows';
  $('inventoryPrevPage').disabled=inventoryPage===1;
  $('inventoryNextPage').disabled=inventoryPage===pageCount;
}
function renderGenerated(){const tagSheet=$('tagSheet');tagSheet.innerHTML=items.map((item,index)=>`<article class="count-tag"><div class="tag-header"><strong>LOCATOR: ${item.locator||'UNASSIGNED'}</strong><span class="copy-number">#${item.copy||String(index+1).padStart(3,'0')}</span><span class="prince-logo">prince<small> biscuits</small></span></div><div class="tag-info"><b>SKU: ${item.sku||'—'}</b><b>UPC: ${item.barcode||'—'}</b><strong>${item.description||'UNNAMED ITEM'}</strong></div><div class="tag-barcode"><div class="barcode-lines"></div><span>${item.barcode||'NO BARCODE'}</span></div><div class="count-box">COUNT</div><div class="signoff"><div><b>Counter :</b><span></span></div><div><b>Scanner :</b><span></span></div><div><b>Validator :</b><span></span></div><small>Powered by: DECStudioHub</small></div></article>`).join('')}
function renderCountSheet(){const groups=items.reduce((result,item)=>{const key=item.supplier||'Unassigned Supplier';(result[key]??=[]).push(item);return result},{});$('countSheetPages').innerHTML=Object.entries(groups).map(([supplier,rows],groupIndex)=>`<article class="count-sheet-page"><header class="sheet-header"><div><h3>COUNT SHEET <span>PHYSICAL INVENTORY</span></h3><p><b>SUPPLIER:</b> ${supplier} &nbsp; <b>STORE:</b> ${$('storeField').value||'Store #14014 - Retail'} &nbsp; <b>DATE:</b> ${$('dateField').value||'2026-09-11'}</p></div><div class="sheet-locator"><b>LOCATORS:</b><strong>${[...new Set(rows.map(row=>row.locator||'—'))].join(', ')}</strong><div class="mini-bars"></div><small>PAGE ${groupIndex+1} OF ${Object.keys(groups).length}</small></div></header><table class="count-sheet-table"><thead><tr><th>#</th><th>SKU</th><th>BARCODE</th><th>DESCRIPTION</th><th>LOCATOR</th><th>COUNT</th></tr></thead><tbody>${rows.map((item,index)=>`<tr><td>${index+1}</td><td>${item.sku||'—'}</td><td><div class="small-barcode"></div><small>${item.barcode||'—'}</small></td><td>${item.description||'—'}</td><td>${item.locator||'—'}</td><td><span class="count-line"></span></td></tr>`).join('')}</tbody></table></article>`).join('');$('countSheetSummary').textContent=`${Object.keys(groups).length} supplier sheets prepared; locators are included on every line.`}
function loadItems(nextItems,filename='inventory.csv'){inventoryTouchedThisSession=true;items=nextItems;if(typeof resetCombinedPrintStatus==='function')resetCombinedPrintStatus();inventoryPage=1;inventoryViewCache={key:'',indexes:[]};renderItems();if(typeof updateSupplierFilter==='function')updateSupplierFilter();$('dataSummary').textContent=`${items.length} inventory rows imported from ${filename}. Check each row for missing or incorrect values.`;$('resetBtn').hidden=false;showStep(2);if(typeof refreshLayoutPreview==='function')refreshLayoutPreview();persistLocalCycleData('Inventory imported',`${filename} · ${items.length} rows`);toast(`${items.length} inventory rows imported`)}
 const importHeaderAliases={
   supplier:['supplier','supplier name','vendor','vendor name','brand','brand name','principal'],
   locator:['locator','location','bin location','locator code','selling locator'],
  sku:['sku','sku no','sku number','item','item code','item no','item number','item sku','product code','product sku','product id','stock code','article no','article number'],
  barcode:['upc','upc code','upc number','upc barcode','barcode','barcode upc','barcode no','barcode number','product barcode','item barcode','ean','ean code','gtin','gtin code'],
  description:['description','item description','item desc','product description','product desc','product name','item name','name']
 };

 function normalizeImportHeader(value){
  return String(value??'').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 }

function readWorksheetCell(worksheet,row,column){
  const cell=worksheet[XLSX.utils.encode_cell({r:row,c:column})];
  if(!cell)return '';
  return String(cell.w??XLSX.utils.format_cell(cell)??cell.v??'').trim();
}

async function parseInventorySheet(worksheet,sheetName,sheetIndex){
  if(!worksheet['!ref'])return [];
  const range=XLSX.utils.decode_range(worksheet['!ref']);
  let headerIndex=-1;
  let bestScore=0;
  let useStandardColumnOrder=false;
  const scanEnd=Math.min(range.e.r,range.s.r+19);
  for(let row=range.s.r;row<=scanEnd;row++){
    const headers=[];
    for(let column=range.s.c;column<=range.e.c;column++)headers.push(normalizeImportHeader(readWorksheetCell(worksheet,row,column)));
    const score=Object.values(importHeaderAliases).filter(aliases=>headers.some(header=>aliases.includes(header))).length;
    const hasItemColumn=headers.some(header=>importHeaderAliases.sku.includes(header)||importHeaderAliases.description.includes(header));
    if(hasItemColumn&&score>=2&&score>bestScore){headerIndex=row;bestScore=score;}
  }
  if(headerIndex<0){
    for(let row=range.s.r;row<=scanEnd;row++){
      let populated=0;
      for(let column=range.s.c;column<=range.e.c;column++)if(readWorksheetCell(worksheet,row,column))populated++;
      if(populated>=4){headerIndex=row;useStandardColumnOrder=true;break;}
    }
  }
  if(headerIndex<0)return [];

  const headers=[];
  for(let column=range.s.c;column<=range.e.c;column++)headers.push(normalizeImportHeader(readWorksheetCell(worksheet,headerIndex,column)));
  const columnIndexes={};
  Object.entries(importHeaderAliases).forEach(([field,aliases],index)=>{
    columnIndexes[field]=useStandardColumnOrder?range.s.c+index:range.s.c+headers.findIndex(header=>aliases.includes(header));
  });
  const supplierColumnExists=!useStandardColumnOrder&&columnIndexes.supplier>=range.s.c;
  const sheetSupplier=/^(sheet\d*|inventory|data)$/i.test(sheetName)?'':sheetName.trim();
  const rows=[];

  for(let row=headerIndex+1;row<=range.e.r;row++){
    const readField=field=>{
      const column=columnIndexes[field];
      return column<range.s.c?'':readWorksheetCell(worksheet,row,column);
    };
    const supplier=readField('supplier');
    const item={
      supplier:supplier||(!supplierColumnExists&&sheetSupplier?sheetSupplier:'Unassigned Supplier'),
      locator:readField('locator'),
      sku:readField('sku'),
      barcode:readField('barcode'),
      description:readField('description')
    };
    if(item.locator||item.sku||item.barcode||item.description)rows.push(item);
    if((row-headerIndex)%5000===0){
      $('uploadHint').textContent=`Reading worksheet ${sheetIndex+1}: ${rows.length.toLocaleString()} inventory rows found.`;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  return rows;
}

let importInProgress=false;
 function handleFile(file){
   if(!file)return;
  if(importInProgress){toast('An inventory file is already being imported.');return;}
   const filename=file.name;
   const extension=filename.split('.').pop().toLowerCase();
   if(!['csv','xls','xlsx'].includes(extension)){
     toast('Unsupported file type. Please upload a CSV or Excel file.');
     return;
   }
   if(typeof XLSX==='undefined'){
     toast('Spreadsheet reader is unavailable. Check your internet connection and try again.');
     return;
   }

   importInProgress=true;
   $('fileInput').value='';
   $('chooseFile').disabled=true;
   $('uploadTitle').textContent='Reading inventory file...';
   $('uploadHint').textContent='Large files are processed worksheet by worksheet.';
   const reader=new FileReader();
   reader.onload=async event=>{
     try{
       const workbook=XLSX.read(event.target.result,{type:'array',raw:false,cellDates:false});
       const rows=[];
       for(let sheetIndex=0;sheetIndex<workbook.SheetNames.length;sheetIndex++){
         const sheetName=workbook.SheetNames[sheetIndex];
         const sheetRows=await parseInventorySheet(workbook.Sheets[sheetName],sheetName,sheetIndex);
         for(const row of sheetRows)rows.push(row);
       }
       if(!rows.length){
         toast('No inventory rows found. Check that the file has column headers such as SKU and DESCRIPTION.');
         return;
       }
       loadItems(rows,filename);
     }catch(error){
       console.error('Inventory import failed:',error);
       toast('Unable to read this file. Please check the file and try again.');
     }finally{
       importInProgress=false;
       $('chooseFile').disabled=false;
       $('uploadTitle').textContent='Choose Excel File or Drag & Drop Here';
       $('uploadHint').textContent='Supports Microsoft Excel (.xlsx, .xls) and CSV files';
     }
   };
   reader.onerror=()=>{importInProgress=false;$('chooseFile').disabled=false;$('uploadTitle').textContent='Choose Excel File or Drag & Drop Here';$('uploadHint').textContent='Supports Microsoft Excel (.xlsx, .xls) and CSV files';toast('Unable to read this file. Please try again.')};
   reader.readAsArrayBuffer(file);
 }
$('chooseFile').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>handleFile(e.target.files[0]);$('dropzone').ondragover=e=>{e.preventDefault();$('dropzone').classList.add('dragging')};$('dropzone').ondragleave=()=> $('dropzone').classList.remove('dragging');$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('dragging');handleFile(e.dataTransfer.files[0])};
$('sampleBtn').onclick=()=>{const csv='SUPPLIER,LOCATOR,SKU,UPC,DESCRIPTION\\nPrince Retail Group,WH-E-B2L2,18053,480034402053,OLD ENGLISH WHSIRE HT 150ML\\nMabuhay Foods,WH-G-B3L1,19221,480034401227,MANG TOMATO SAUCE 250G';const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const link=document.createElement('a');link.href=url;link.download='PRG_inventory_template.csv';link.click();URL.revokeObjectURL(url);toast('Sample template downloaded')};
$('searchInput').oninput=null;
let inventorySearchTimer;
$('searchInput').addEventListener('input',()=>{clearTimeout(inventorySearchTimer);inventoryPage=1;inventorySearchTimer=setTimeout(()=>renderItems(),120)});
$('sortSelect').onchange=()=>{inventoryPage=1;renderItems()};$('reuploadBtn').onclick=()=>$('fileInput').click();$('backImport').onclick=()=>showStep(1);$('countSheetBtn').onclick=()=>showStep(3);$('backCountData').onclick=()=>showStep(2);$('printSheetBtn').onclick=()=>{toast('Print dialog opened');window.print()};$('exportSheetBtn').onclick=()=>toast('Count sheet PDF export is ready');$('goCountSheet').onclick=()=>{applyLayout();renderCountSheet();Object.values(panels).forEach(panel=>panel.hidden=true);$('countSheetPanel').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};$('generateBtn').onclick=()=>showStep(3);$('backData').onclick=()=>showStep(2);$('goGenerate').onclick=()=>{renderGenerated();showStep(4);$('generatedSummary').textContent=`${items.length} physical count tags prepared for printing.`};$('backConfigure').onclick=()=>showStep(3);$('printBtn').onclick=()=>{toast('Print dialog opened');window.print()};$('pdfBtn').onclick=()=>toast('PDF export is ready to download');
$('addItemBtn').onclick=()=>{const locator=prompt('Locator (e.g. A-01-01)');if(!locator)return;const sku=prompt('SKU');const description=prompt('Description');const newItem={locator,sku:sku||'NEW',barcode:'',description:description||'New inventory item'};items.push(newItem);inventoryTouchedThisSession=true;inventoryViewCache={key:'',indexes:[]};renderItems();persistLocalCycleData('Item added',`SKU ${newItem.sku} · ${newItem.description} · ${newItem.locator}`);toast('Inventory item added')};
document.addEventListener('click',event=>{
  const edit=event.target.closest('.edit-item');
  const remove=event.target.closest('.delete-item');
  if(edit){
    const item=items[Number(edit.dataset.index)];
    const previousDescription=item.description||'';
    const description=prompt('Description',previousDescription);
    if(description!==null){item.description=description;inventoryTouchedThisSession=true;inventoryViewCache={key:'',indexes:[]};renderItems();persistLocalCycleData('Item edited',`SKU ${item.sku||'—'} · ${previousDescription} -> ${description}`);toast('Item updated')}
  }
  if(remove){
    const item=items[Number(remove.dataset.index)];
    const removedDetails=item?`SKU ${item.sku||'—'} · ${item.description||''} · ${item.locator||''}`:'Unknown item';
    items.splice(Number(remove.dataset.index),1);
    inventoryTouchedThisSession=true;
    inventoryViewCache={key:'',indexes:[]};
    renderItems();
    persistLocalCycleData('Item deleted',removedDetails);
    toast('Item removed');
  }
});
document.querySelectorAll('.step').forEach(el=>el.onclick=()=>{const step=Number(el.dataset.step);if(step===1||items.length)showStep(step);else toast('Import inventory before continuing')});document.querySelectorAll('.module').forEach(el=>el.onclick=()=>{document.querySelectorAll('.module').forEach(button=>button.classList.remove('active'));el.classList.add('active');toast(`${el.textContent.split(' ')[0]} module selected`)});
$('settingsBtn').onclick=()=>{$('modalBackdrop').hidden=false};$('closeModal').onclick=()=>{$('modalBackdrop').hidden=true};$('modalBackdrop').onclick=e=>{if(e.target===$('modalBackdrop'))$('modalBackdrop').hidden=true};$('saveSettings').onclick=()=>{$('modalBackdrop').hidden=true;document.documentElement.dataset.accent=$('accentSelect').value;const colors={emerald:'#047857',sapphire:'#1d4ed8',amber:'#b45309'};document.documentElement.style.setProperty('--accent',colors[$('accentSelect').value]);toast('Settings saved')};
$('creditsBtn').onclick=()=>{$('developersModal').hidden=false};
$('closeDevelopers').onclick=()=>{$('developersModal').hidden=true};
$('developersModal').onclick=e=>{if(e.target===$('developersModal'))$('developersModal').hidden=true};
 $('resetBtn').onclick=()=>{const removedCount=items.length;items=[];if(typeof resetCombinedPrintStatus==='function')resetCombinedPrintStatus();inventoryTouchedThisSession=true;inventoryViewCache={key:'',indexes:[]};$('fileInput').value='';$('resetBtn').hidden=true;renderItems();persistLocalCycleData('Inventory cleared',`${removedCount} rows removed`);showStep(1);toast('Session reset')};
$('storeField').value=restoredLocalCycleData.store||'';
$('dateField').value=restoredLocalCycleData.date||new Date().toISOString().slice(0,10);
if(items.length){
  renderItems();
  $('dataSummary').textContent=`${items.length} inventory rows restored from this computer.`;
  $('resetBtn').hidden=false;
}
['storeField','dateField'].forEach(id=>$(id).addEventListener('change',()=>persistLocalCycleData('Session details updated',`${id==='storeField'?'Store/location':'Inventory date'}: ${$(id).value||'(empty)'}`)));

function renderLocalHistory(){
  const list=$('localHistoryList');
  list.replaceChildren();
  const history=readLocalCycleHistory();
  if(!history.length){
    const empty=document.createElement('p');
    empty.className='local-history-empty';
    empty.textContent='No saved activity yet.';
    list.append(empty);
    return;
  }
  history.forEach(entry=>{
    const row=document.createElement('article');
    row.className='local-history-entry';
    const timestamp=document.createElement('time');
    timestamp.dateTime=entry.time;
    timestamp.textContent=new Date(entry.time).toLocaleString();
    const action=document.createElement('strong');
    action.textContent=entry.action;
    const details=document.createElement('p');
    details.textContent=`${entry.details||''}${entry.rowCount===undefined?'':` · ${entry.rowCount} current rows`}`;
    row.append(timestamp,action,details);
    list.append(row);
  });
}

async function exportLocalBackup(){
  let inventory={...readLocalCycleData(),items};
  try{inventory=await readIndexedLocalInventory()||inventory}catch(error){console.warn('Could not read inventory for backup:',error)}
  const backup={
    version:1,
    exportedAt:new Date().toISOString(),
    inventory,
    activity:readLocalCycleHistory(),
    layout:(()=>{try{return JSON.parse(localStorage.getItem('danne-lozana-count-layout')||'{}')}catch(error){return {}}})()
  };
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=`FUJI_Cycle_Count_Backup_${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function createLocalHistoryPanel(){
  const nav=document.querySelector('.top-actions');
  const button=document.createElement('button');
  button.type='button';
  button.className='nav-button muted';
  button.id='localHistoryBtn';
  button.textContent='Local history';
  nav.insertBefore(button,$('resetBtn'));

  const style=document.createElement('style');
  style.textContent='.local-history-modal{width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto}.local-history-list{display:grid;gap:8px;max-height:48vh;overflow:auto;margin:14px 0}.local-history-entry{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,2fr);gap:4px 12px;padding:10px 0;border-bottom:1px solid #e5eae6;font-size:12px}.local-history-entry time{color:#536158}.local-history-entry strong{color:#25332b}.local-history-entry p{grid-column:1/-1;margin:0;color:#66726b;overflow-wrap:anywhere}.local-history-empty{padding:18px 0;color:#66726b;font-size:13px}@media(max-width:600px){.local-history-entry{grid-template-columns:1fr}}';
  document.head.append(style);

  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.id='localHistoryModal';
  backdrop.hidden=true;
  backdrop.innerHTML='<div class="modal local-history-modal" role="dialog" aria-modal="true" aria-labelledby="localHistoryTitle"><button class="close-modal" id="closeLocalHistory" aria-label="Close history">×</button><p class="section-kicker">SAVED ON THIS COMPUTER</p><h2 id="localHistoryTitle">Local history</h2><p class="modal-copy">Inventory and activity are stored in this browser profile. Download a backup to keep a separate copy.</p><div id="localHistoryList" class="local-history-list"></div><div class="modal-actions"><button class="secondary-button" id="clearLocalHistory">Clear history</button><button class="primary-button" id="downloadLocalBackup">Download backup</button></div></div>';
  document.body.append(backdrop);
  button.onclick=()=>{renderLocalHistory();backdrop.hidden=false};
  $('closeLocalHistory').onclick=()=>{backdrop.hidden=true};
  backdrop.onclick=event=>{if(event.target===backdrop)backdrop.hidden=true};
  $('clearLocalHistory').onclick=()=>{
    if(window.confirm('Clear the saved activity history? Inventory will remain saved.')){
      localStorage.removeItem(localCycleHistoryKey);
      renderLocalHistory();
    }
  };
  $('downloadLocalBackup').onclick=exportLocalBackup;
}
createLocalHistoryPanel();

async function restoreLocalInventory(){
  try{
    let saved=await readIndexedLocalInventory();
    if(inventoryTouchedThisSession)return;
    if(!saved&&Array.isArray(restoredLocalCycleData.items)){
      saved={...restoredLocalCycleData,items:restoredLocalCycleData.items};
      await writeLocalInventory(saved);
      localStorage.setItem(localCycleDataKey,JSON.stringify({version:1,savedAt:saved.savedAt||new Date().toISOString(),store:saved.store||'',date:saved.date||''}));
    }
    if(!saved||!Array.isArray(saved.items))return;
    items=saved.items;
    $('storeField').value=saved.store||$('storeField').value;
    $('dateField').value=saved.date||$('dateField').value;
    inventoryPage=1;
    inventoryViewCache={key:'',indexes:[]};
    renderItems();
    $('dataSummary').textContent=`${items.length} inventory rows restored from this computer.`;
    $('resetBtn').hidden=items.length===0;
    if(typeof updateSupplierFilter==='function')updateSupplierFilter();
    if(typeof refreshLayoutPreview==='function')refreshLayoutPreview();
  }catch(error){
    console.warn('Could not restore locally saved inventory:',error);
  }
}
restoreLocalInventory();

const workspaceSettingsKey='cycle-count-workspace-settings-v1';
const defaultWorkspaceSettings={systemName:'FUJI CYCLE COUNT SHEET GENERATOR',editorName:'',storeName:'',accent:'emerald',customAccent:'#047857',logoData:''};
let workspaceSettings={...defaultWorkspaceSettings};
try{workspaceSettings={...defaultWorkspaceSettings,...JSON.parse(localStorage.getItem(workspaceSettingsKey)||'{}')}}catch(error){console.warn('Could not restore workspace settings:',error)}
const systemNameField=$('systemNameField');
const editorNameField=$('editorName');
const settingsStoreField=$('settingsStoreName');
const accentSelect=$('accentSelect');
const customAccentField=$('customAccent');
let currentLogoData=workspaceSettings.logoData||'';
systemNameField.value=workspaceSettings.systemName||defaultWorkspaceSettings.systemName;
editorNameField.value=workspaceSettings.editorName||'';
settingsStoreField.value=workspaceSettings.storeName||$('storeField').value;
accentSelect.value=workspaceSettings.accent||'emerald';
customAccentField.value=workspaceSettings.customAccent||'#047857';

const settingsPalettes={
  emerald:{color:'#047857',dark:'#065f46',soft:'#ecfdf5'},
  sapphire:{color:'#1d4ed8',dark:'#1e40af',soft:'#eff6ff'},
  amber:{color:'#b45309',dark:'#92400e',soft:'#fffbeb'},
  rose:{color:'#be123c',dark:'#9f1239',soft:'#fff1f2'}
};
function applyWorkspaceAppearance(){
  const selected=accentSelect.value;
  const palette=settingsPalettes[selected];
  const color=palette?.color||customAccentField.value||'#047857';
  document.documentElement.dataset.accent=selected;
  document.documentElement.style.setProperty('--accent',color);
  document.documentElement.style.setProperty('--emerald',color);
  document.documentElement.style.setProperty('--emerald-dark',palette?.dark||color);
  document.documentElement.style.setProperty('--emerald-soft',palette?.soft||`${color}1a`);
  const brandName=document.querySelector('.brand-name');
  if(brandName)brandName.textContent=systemNameField.value.trim()||defaultWorkspaceSettings.systemName;
  document.title=systemNameField.value.trim()||defaultWorkspaceSettings.systemName;
  const brandMark=document.querySelector('.brand-mark');
  const logoPreview=$('logoPreview');
  [brandMark,logoPreview].forEach((target,index)=>{
    if(!target)return;
    target.replaceChildren();
    if(currentLogoData){
      const image=document.createElement('img');
      image.src=currentLogoData;
      image.alt=index?'Custom logo preview':'Custom system logo';
      target.appendChild(image);
      if(index===0)target.style.background='transparent';
    }else{
      target.textContent='F';
      if(index===0)target.style.removeProperty('background');
    }
  });
  document.querySelectorAll('[data-accent-option]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.accentOption===selected)));
}

document.querySelectorAll('.settings-tab').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.settings-tab').forEach(tab=>{
    const active=tab===button;
    tab.classList.toggle('active',active);
    tab.setAttribute('aria-selected',String(active));
  });
  document.querySelectorAll('[data-settings-view]').forEach(view=>{view.hidden=view.dataset.settingsView!==button.dataset.settingsTab});
}));
document.querySelectorAll('[data-accent-option]').forEach(button=>button.addEventListener('click',()=>{
  accentSelect.value=button.dataset.accentOption;
  applyWorkspaceAppearance();
}));
customAccentField.addEventListener('input',()=>{accentSelect.value='custom';applyWorkspaceAppearance()});
systemNameField.addEventListener('input',applyWorkspaceAppearance);
$('customLogoInput').addEventListener('change',event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  if(file.size>1024*1024){toast('Choose a logo smaller than 1 MB');event.target.value='';return}
  const reader=new FileReader();
  reader.onload=()=>{currentLogoData=String(reader.result||'');applyWorkspaceAppearance()};
  reader.onerror=()=>toast('Could not read that logo file');
  reader.readAsDataURL(file);
});
$('removeLogoBtn').addEventListener('click',()=>{currentLogoData='';$('customLogoInput').value='';applyWorkspaceAppearance()});

function saveWorkspaceSettings(){
  workspaceSettings={
    systemName:systemNameField.value.trim()||defaultWorkspaceSettings.systemName,
    editorName:editorNameField.value.trim(),
    storeName:settingsStoreField.value.trim(),
    accent:accentSelect.value,
    customAccent:customAccentField.value,
    logoData:currentLogoData
  };
  $('storeField').value=workspaceSettings.storeName;
  $('storeField').dispatchEvent(new Event('change'));
  try{localStorage.setItem(workspaceSettingsKey,JSON.stringify(workspaceSettings));$('settingsSaveStatus').textContent='Settings saved in this browser.'}catch(error){$('settingsSaveStatus').textContent='Settings could not be saved in this browser.';console.warn('Could not save workspace settings:',error)}
  applyWorkspaceAppearance();
  $('modalBackdrop').hidden=true;
  if(typeof refreshLayoutPreview==='function')refreshLayoutPreview();
  toast('Settings saved');
}
function openSettings(){
  settingsStoreField.value=$('storeField').value;
  $('modalBackdrop').hidden=false;
}
$('settingsBtn').onclick=openSettings;
$('closeModal').onclick=()=>{$('modalBackdrop').hidden=true};
$('modalBackdrop').onclick=event=>{if(event.target===$('modalBackdrop'))$('modalBackdrop').hidden=true};
$('saveSettings').onclick=saveWorkspaceSettings;
applyWorkspaceAppearance();

$('downloadBackupBtn').addEventListener('click',()=>{
  const backup={schemaVersion:1,createdAt:new Date().toISOString(),inventory:{items,store:$('storeField').value,date:$('dateField').value},settings:workspaceSettings};
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='fuji-cycle-count-backup.json';
  link.click();
  URL.revokeObjectURL(url);
});
$('restoreBackupInput').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  try{
    const backup=JSON.parse(await file.text());
    const inventory=backup.inventory||backup;
    if(!Array.isArray(inventory.items))throw new Error('This file does not contain a valid inventory backup.');
    $('storeField').value=inventory.store||'';
    $('dateField').value=inventory.date||$('dateField').value;
    if(backup.settings&&typeof backup.settings==='object'){
      workspaceSettings={...defaultWorkspaceSettings,...backup.settings};
      systemNameField.value=workspaceSettings.systemName;
      editorNameField.value=workspaceSettings.editorName;
      settingsStoreField.value=workspaceSettings.storeName||inventory.store||'';
      accentSelect.value=workspaceSettings.accent;
      customAccentField.value=workspaceSettings.customAccent;
      currentLogoData=workspaceSettings.logoData||'';
      localStorage.setItem(workspaceSettingsKey,JSON.stringify(workspaceSettings));
      applyWorkspaceAppearance();
    }
    loadItems(inventory.items,file.name);
    event.target.value='';
    $('modalBackdrop').hidden=true;
    toast('Backup restored');
  }catch(error){toast(error.message||'Could not restore this backup');event.target.value=''}
});
$('resetSettingsBtn').addEventListener('click',()=>{
  if(!confirm('Reset system name, editor, store, logo, and color settings? Inventory will be kept.'))return;
  workspaceSettings={...defaultWorkspaceSettings};
  currentLogoData='';
  systemNameField.value=defaultWorkspaceSettings.systemName;
  editorNameField.value='';
  settingsStoreField.value='';
  accentSelect.value='emerald';
  customAccentField.value='#047857';
  $('storeField').value='';
  $('storeField').dispatchEvent(new Event('change'));
  localStorage.removeItem(workspaceSettingsKey);
  applyWorkspaceAppearance();
  toast('System settings reset');
});
$('clearInventoryBtn').addEventListener('click',()=>{
  if(confirm('Clear the inventory saved in this browser? This cannot be undone unless you have a backup.'))$('resetBtn').click();
});

function applyLayout(showToast=true){
  const root=document.documentElement;
  const rowHeight=$('rowHeight').value;
  const fontSize=$('fontSize').value;
  const barcodeWidth=$('barcodeWidth').value;
  const countLineWidth=$('countLineWidth').value;
  const orientation=$('orientation').value;
  const paper=$('paperSize').value;
  const margins={compact:'.28in',standard:'.5in',wide:'.75in'};
  const paperSizes={
    letter:{portrait:'Letter portrait',landscape:'Letter landscape'},
    a4:{portrait:'A4 portrait',landscape:'A4 landscape'},
    legal:{portrait:'Legal portrait',landscape:'Legal landscape'},
    folio:{portrait:'8.5in 13in',landscape:'13in 8.5in'}
  };
  root.style.setProperty('--sheet-row-height',`${rowHeight}px`);
  root.style.setProperty('--sheet-font-size',`${fontSize}px`);
  root.style.setProperty('--sheet-barcode-width',`${barcodeWidth}px`);
  root.style.setProperty('--sheet-count-width',`${countLineWidth}%`);
  root.style.setProperty('--print-orientation',orientation);
  root.style.setProperty('--print-margin',margins[$('pageMargins').value]);
  root.style.setProperty('--print-page-size',paperSizes[paper]?.[orientation]||'Letter landscape');
  root.style.setProperty('--print-paper',paper==='folio'?'Letter':paper);
  $('rowHeightValue').textContent=`${rowHeight} px`;
  $('fontSizeValue').textContent=`${fontSize} px`;
  $('barcodeWidthValue').textContent=`${barcodeWidth} px`;
  $('countLineValue').textContent=`${countLineWidth}%`;
  document.body.classList.toggle('sheet-hide-barcode',!$('showSheetBarcode').checked);
  document.body.classList.toggle('sheet-hide-locator',!$('showSheetLocator').checked);
  if(showToast)toast('Layout updated');
}
function refreshLayoutPreview(){const preview=$('countSheetLivePreview');if(!preview)return;if(!items.length){preview.innerHTML='<div class="live-empty">Import inventory to preview your count sheet.</div>';return}renderCountSheet(true)}
['paperSize','orientation','pageMargins','rowsPerPage','rowHeight','fontSize','barcodeWidth','countLineWidth','showSheetBarcode','showSheetLocator','showSupplierHeader'].forEach(id=>$(id).addEventListener('change',refreshLayoutPreview));['rowHeight','fontSize','barcodeWidth','countLineWidth'].forEach(id=>$(id).addEventListener('input',refreshLayoutPreview));document.addEventListener('click',event=>{if(event.target.closest('[data-step="3"],#countSheetBtn,#generateBtn,#backData'))setTimeout(refreshLayoutPreview,0)});
['paperSize','orientation','pageMargins','rowsPerPage','rowHeight','fontSize','barcodeWidth','countLineWidth','showSheetBarcode','showSheetLocator','showSupplierHeader'].forEach(id=>$(id).addEventListener('change',applyLayout));['rowHeight','fontSize','barcodeWidth','countLineWidth'].forEach(id=>$(id).addEventListener('input',applyLayout));$('orientation').value='landscape';applyLayout(false);

function renderCountSheet(){
  const groups=items.reduce((result,item)=>{const key=item.supplier||'Unassigned Supplier';(result[key]??=[]).push(item);return result;},{});
  const pageRows=Number($('rowsPerPage')?.value)||8;
  const showSupplier=!!$('showSupplierHeader') && $('showSupplierHeader').checked;
  const pages=[];
  let globalIndex=1;

  Object.entries(groups).forEach(([supplier,rows])=>{
    for(let offset=0; offset<rows.length; offset+=pageRows){
      const pageRowsData=rows.slice(offset, offset+pageRows);
      pages.push({supplier, rows:pageRowsData, startIndex:globalIndex});
      globalIndex += pageRowsData.length;
    }
  });

  $('countSheetPages').innerHTML=pages.map(({supplier,rows,startIndex},pageIndex)=>`<article class="count-sheet-page"><header class="sheet-header"><div><h3>COUNT SHEET <span>PHYSICAL INVENTORY</span></h3><p>${showSupplier?`<b>SUPPLIER:</b> ${supplier} &nbsp;`:''}<b>STORE:</b> ${$('storeField').value||'Store #14014 - Retail'} &nbsp; <b>DATE:</b> ${$('dateField').value||'2026-09-11'}</p></div><div class="sheet-locator"><b>LOCATORS:</b><strong>${[...new Set(rows.map(row=>row.locator||'—'))].join(', ')}</strong><div class="mini-bars"></div><small>PAGE ${pageIndex+1} OF ${pages.length}</small></div></header><table class="count-sheet-table"><thead><tr><th>#</th><th>SKU</th><th>BARCODE</th><th>DESCRIPTION</th><th>LOCATOR</th><th>COUNT</th></tr></thead><tbody>${rows.map((item,index)=>`<tr><td>${startIndex + index}</td><td>${item.sku||'—'}</td><td><div class="small-barcode"></div><small>${item.barcode||'—'}</small></td><td>${item.description||'—'}</td><td>${item.locator||'—'}</td><td><span class="count-line"></span></td></tr>`).join('')}</tbody></table></article>`).join('');

  $('countSheetSummary').textContent=`${pages.length} supplier count-sheet page${pages.length===1?'':'s'} prepared; locators are included on every line.`;
}
