(()=>{
  const databaseName='fuji-masterlist-v1';
  const storeName='datasets';
  const datasetKey='latest';
  const pageSizeControl=document.getElementById('masterlistPageSize');
  const state={records:[],sheets:{},filtered:[],sortKey:'sku',sortDirection:1,page:1,pageSize:Number(pageSizeControl.value)||50};
  const elements={
    file:document.getElementById('masterlistFile'),dropzone:document.getElementById('masterlistDropzone'),status:document.getElementById('masterlistStatus'),
    total:document.getElementById('masterlistTotal'),departmentCount:document.getElementById('masterlistDepartmentCount'),activeCcd:document.getElementById('masterlistActiveCcd'),
    ccd:document.getElementById('masterlistCcd'),department:document.getElementById('masterlistDepartment'),search:document.getElementById('masterlistSearch'),
    body:document.getElementById('masterlistBody'),empty:document.getElementById('masterlistEmpty'),resultCount:document.getElementById('masterlistResultCount'),
    pageSummary:document.getElementById('masterlistPageSummary'),pageLabel:document.getElementById('masterlistPageLabel'),previous:document.getElementById('masterlistPrev'),
    next:document.getElementById('masterlistNext'),otherSheets:document.getElementById('masterlistOtherSheets')
  };
  const fieldAliases={
    ccd:['ccd no','ccd','ccd number','ccd#'],sku:['sku'],description:['sku description','description','item description'],
    deptCode:['dept code','department code','dept'],department:['department'],subdeptName:['subdept name','sub department name','subdept'],
    classification:['classification'],vendorCode:['vendor code','vendor'],vendorName:['vendor name','supplier name'],jdaBatchName:['jda batch name','jda batch','batch name']
  };
  const columns=[
    ['ccd','CCD NO.'],['sku','SKU'],['description','SKU Description'],['deptCode','Dept Code'],['department','Department'],
    ['subdeptName','Subdept Name'],['classification','Classification'],['vendorCode','Vendor Code'],['vendorName','Vendor Name'],['jdaBatchName','JDA Batch Name']
  ];
  let databasePromise;

  function normalizeHeader(value){return String(value??'').toLowerCase().replace(/[^a-z0-9#]+/g,' ').trim().replace(/\s+/g,' ')}
  function setStatus(message,stateName=''){elements.status.textContent=message;elements.status.dataset.state=stateName;}
  function openDatabase(){
    if(databasePromise)return databasePromise;
    databasePromise=new Promise((resolve,reject)=>{
      if(!('indexedDB'in window)){reject(new Error('This browser does not support local database storage.'));return;}
      const request=indexedDB.open(databaseName,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName)};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('Could not open local masterlist storage.'));
    });
    return databasePromise;
  }
  async function readSavedDataset(){
    const database=await openDatabase();
    return new Promise((resolve,reject)=>{
      const request=database.transaction(storeName,'readonly').objectStore(storeName).get(datasetKey);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error('Could not read saved master data.'));
    });
  }
  async function saveDataset(dataset){
    const database=await openDatabase();
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(storeName,'readwrite');
      transaction.objectStore(storeName).put(dataset,datasetKey);
      transaction.oncomplete=resolve;
      transaction.onerror=()=>reject(transaction.error||new Error('Could not save master data locally.'));
      transaction.onabort=()=>reject(transaction.error||new Error('Master data save was interrupted.'));
    });
  }
  function findHeaderRow(matrix,aliases){
    const names=new Set(Object.values(aliases).flat().map(normalizeHeader));
    let bestIndex=-1,bestScore=0;
    matrix.slice(0,40).forEach((row,index)=>{
      const values=row.map(normalizeHeader);
      const score=[...names].filter(name=>values.includes(name)).length;
      if(score>bestScore){bestIndex=index;bestScore=score;}
    });
    return bestScore>=3?bestIndex:-1;
  }
  function mapRows(matrix,required){
    const headerIndex=findHeaderRow(matrix,fieldAliases);
    if(headerIndex<0)return [];
    const headers=matrix[headerIndex].map(normalizeHeader);
    const indexes={};
    Object.entries(fieldAliases).forEach(([field,aliases])=>{
      indexes[field]=headers.findIndex(header=>aliases.map(normalizeHeader).includes(header));
    });
    if(required&&!['sku','description','deptCode'].every(field=>indexes[field]>=0))return [];
    return matrix.slice(headerIndex+1).map(row=>{
      const record={};
      columns.forEach(([field])=>{const index=indexes[field];record[field]=index>=0?String(row[index]??'').trim():'';});
      return record;
    }).filter(record=>record.sku||record.description);
  }
  function parseOtherSheet(matrix){
    const headerIndex=findHeaderRow(matrix,fieldAliases);
    if(headerIndex>=0){
      const headers=matrix[headerIndex].map(value=>String(value??'').trim());
      return {headers,rows:matrix.slice(headerIndex+1).filter(row=>row.some(value=>String(value??'').trim()))};
    }
    return {headers:[],rows:matrix.filter(row=>row.some(value=>String(value??'').trim()))};
  }
  function sheetNameMatch(names,matcher){return names.find(name=>matcher(normalizeHeader(name)))}
  function parseWorkbook(buffer){
    const workbook=XLSX.read(buffer,{type:'array',raw:false,cellDates:false,sheetRows:0});
    const masterName=sheetNameMatch(workbook.SheetNames,name=>name==='cc masterlist'||name.includes('cc masterlist'));
    if(!masterName)throw new Error('The workbook does not contain a CC Masterlist sheet.');
    const masterMatrix=XLSX.utils.sheet_to_json(workbook.Sheets[masterName],{header:1,raw:false,defval:'',blankrows:false});
    const records=mapRows(masterMatrix,true);
    if(!records.length)throw new Error('No masterlist records were found. Check the CC Masterlist headers.');
    const sheets={};
    const targets=[
      ['schedule',name=>name==='cc sched'||name.includes('cc sched')],
      ['variance',name=>name.includes('cc variance details')],
      ['iraSummary',name=>name.includes('ira')&&name.includes('summary')]
    ];
    targets.forEach(([key,matcher])=>{
      const name=sheetNameMatch(workbook.SheetNames,matcher);
      if(!name)return;
      const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,raw:false,defval:'',blankrows:false});
      sheets[key]={name,...parseOtherSheet(matrix)};
    });
    return {records,sheets,sourceName:'',savedAt:new Date().toISOString()};
  }
  function selectedRecords(){
    const ccd=elements.ccd.value,department=elements.department.value,query=elements.search.value.trim().toLowerCase();
    return state.records.filter(record=>{
      if(ccd&&record.ccd!==ccd)return false;
      if(department&&record.deptCode!==department)return false;
      if(query&&!`${record.sku} ${record.description} ${record.vendorCode} ${record.vendorName}`.toLowerCase().includes(query))return false;
      return true;
    }).sort((left,right)=>{
      const a=String(left[state.sortKey]||''),b=String(right[state.sortKey]||'');
      return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})*state.sortDirection;
    });
  }
  function renderOtherSheets(){
    const summary=Object.entries(state.sheets).map(([key,sheet])=>`${sheet.name}: ${sheet.rows.length.toLocaleString()} rows`).join(' · ');
    elements.otherSheets.textContent=summary||'No schedule, variance, or IRA summary sheets were included.';
  }
  function render(){
    state.filtered=selectedRecords();
    const totalPages=Math.max(1,Math.ceil(state.filtered.length/state.pageSize));
    state.page=Math.min(Math.max(1,state.page),totalPages);
    const start=(state.page-1)*state.pageSize;
    const visible=state.filtered.slice(start,start+state.pageSize);
    elements.total.textContent=state.records.length.toLocaleString();
    const departmentCount=state.records.filter(record=>(!elements.ccd.value||record.ccd===elements.ccd.value)&&(!elements.department.value||record.deptCode===elements.department.value)).length;
    elements.departmentCount.textContent=departmentCount.toLocaleString();
    elements.activeCcd.textContent=elements.ccd.value?`CCD ${elements.ccd.value}`:'All CCDs';
    elements.resultCount.textContent=`${state.filtered.length.toLocaleString()} record${state.filtered.length===1?'':'s'}`;
    elements.pageSummary.textContent=`Showing ${state.filtered.length?start+1:0}–${Math.min(start+state.pageSize,state.filtered.length)} of ${state.filtered.length.toLocaleString()}`;
    elements.pageLabel.textContent=`Page ${state.page} of ${totalPages}`;
    elements.previous.disabled=state.page<=1;
    elements.next.disabled=state.page>=totalPages;
    elements.empty.classList.toggle('is-visible',state.records.length===0||state.filtered.length===0);
    elements.empty.textContent=state.records.length===0?'Upload a monitoring workbook to load the masterlist.':'No masterlist records match these filters.';
    elements.body.replaceChildren(...visible.map(record=>{
      const row=document.createElement('tr');
      columns.forEach(([field])=>{const cell=document.createElement('td');cell.textContent=record[field]||'—';cell.title=record[field]||'';row.append(cell);});
      return row;
    }));
    document.querySelectorAll('[data-master-sort]').forEach(button=>{
      const direction=button.querySelector('span');
      direction.textContent=button.dataset.masterSort===state.sortKey?(state.sortDirection===1?'↑':'↓'):'';
      button.setAttribute('aria-sort',button.dataset.masterSort===state.sortKey?(state.sortDirection===1?'ascending':'descending'):'none');
    });
  }
  function populateCcdOptions(){
    const current=elements.ccd.value;
    const values=[...new Set(state.records.map(record=>record.ccd).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    elements.ccd.replaceChildren(new Option('All CCDs',''),...values.map(value=>new Option(`CCD ${value}`,value)));
    if(values.includes(current))elements.ccd.value=current;
  }
  function applyDataset(dataset){
    state.records=dataset.records||[];
    state.sheets=dataset.sheets||{};
    state.page=1;
    populateCcdOptions();
    renderOtherSheets();
    render();
    const saved=dataset.savedAt?new Date(dataset.savedAt):null;
    setStatus(`${state.records.length.toLocaleString()} SKUs loaded${dataset.sourceName?` from ${dataset.sourceName}`:''}${saved&&!Number.isNaN(saved.getTime())?` · saved ${saved.toLocaleString()}`:''}`,'success');
  }
  async function importFile(file){
    if(!file)return;
    if(!/\.(xlsx|xls)$/i.test(file.name)){setStatus('Choose an Excel workbook (.xlsx or .xls).','error');return;}
    if(typeof XLSX==='undefined'){setStatus('Excel parser is unavailable. Check your connection and try again.','error');return;}
    elements.file.disabled=true;
    setStatus(`Reading ${file.name}…`);
    try{
      const dataset=parseWorkbook(await file.arrayBuffer());
      dataset.sourceName=file.name;
      await saveDataset(dataset);
      applyDataset(dataset);
      setStatus(`${state.records.length.toLocaleString()} SKUs imported from ${file.name} and saved in this browser.`,'success');
    }catch(error){
      console.error('Masterlist import failed:',error);
      setStatus(error.message||'Could not import that workbook.','error');
    }finally{elements.file.disabled=false;}
  }
  elements.file.addEventListener('change',event=>{importFile(event.target.files[0]);event.target.value='';});
  elements.dropzone.addEventListener('dragover',event=>{event.preventDefault();elements.dropzone.classList.add('is-dragging');});
  elements.dropzone.addEventListener('dragleave',event=>elements.dropzone.classList.remove('is-dragging'));
  elements.dropzone.addEventListener('drop',event=>{event.preventDefault();elements.dropzone.classList.remove('is-dragging');importFile(event.dataTransfer.files[0]);});
  [elements.ccd,elements.department].forEach(control=>control.addEventListener('change',()=>{state.page=1;render();}));
  elements.search.addEventListener('input',()=>{state.page=1;render();});
  pageSizeControl.addEventListener('change',()=>{state.pageSize=Number(pageSizeControl.value)||50;state.page=1;render();});
  document.querySelectorAll('[data-master-sort]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.masterSort;
    if(state.sortKey===key)state.sortDirection*=-1;else{state.sortKey=key;state.sortDirection=1;}
    state.page=1;render();
  }));
  elements.previous.addEventListener('click',()=>{state.page--;render();});
  elements.next.addEventListener('click',()=>{state.page++;render();});
  async function restore(){
    render();
    try{
      const dataset=await readSavedDataset();
      if(dataset)applyDataset(dataset);
      else setStatus('Upload a workbook to build the masterlist. The imported data will be saved in this browser.');
    }catch(error){
      console.error('Could not restore saved masterlist:',error);
      setStatus('Local database storage is unavailable in this browser.','error');
    }
  }
  restore();
})();
