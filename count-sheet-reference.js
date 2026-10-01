function splitLocatorValues(rawValue=''){
  if(rawValue===null||rawValue===undefined)return [];
  return [...new Set(String(rawValue).split(/[\/;,|]/).map(value=>value.trim().replace(/\s+/g,' ')).filter(Boolean).map(value=>value.toUpperCase()).filter(Boolean))];
}

function escapeSheetText(value){
  return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function buildCountSheetRows(items){
  const merged=new Map();
  items.forEach(item=>{
    const supplier=item.supplier||'Unassigned Supplier';
    const sku=String(item.sku||'').trim();
    const barcode=String(item.barcode||'').trim();
    const description=String(item.description||'').trim();
    const key=sku?JSON.stringify([supplier,sku.toUpperCase()]):JSON.stringify([supplier,barcode,description.toLowerCase()]);
    if(!merged.has(key)){
      merged.set(key,{supplier,sku,barcode,description, selling:[],buffer:[],warehouse:[]});
    }
    const row=merged.get(key);
    if(!row.barcode&&barcode)row.barcode=barcode;
    if(!row.description&&description)row.description=description;
    splitLocatorValues(item.locator).forEach(locator=>{
      if(/^SA-/i.test(locator))row.selling.push(locator);
      else if(/^BA-/i.test(locator))row.buffer.push(locator);
      else if(/^WH-/i.test(locator))row.warehouse.push(locator);
      else row.selling.push(locator);
    });
  });

  return [...merged.values()].map(row=>({
    supplier:row.supplier,
    sku:row.sku||'—',
    barcode:row.barcode,
    description:row.description||'—',
    selling:[...new Set(row.selling)],
    buffer:[...new Set(row.buffer)],
    warehouse:[...new Set(row.warehouse)]
  }));
}

function getCombinedPageBodyHeight(){
  const dimensions={letter:[8.5,11],a4:[8.27,11.69],legal:[8.5,14],folio:[8.5,13]};
  const [shortSide,longSide]=dimensions[$('paperSize')?.value]||dimensions.letter;
  const pageHeight=($('orientation')?.value||'landscape')==='landscape'?shortSide:longSide;
  const margin={compact:0.28,standard:0.5,wide:0.75}[$('pageMargins')?.value]||0.28;
  const rowHeight=Math.max(38,Number($('rowHeight')?.value)||50);
  return Math.max(rowHeight+26,pageHeight*96-margin*192-230);
}

function paginateCombinedSupplierRows(groups,suppliers,maxSkuRows){
  const pageHeight=getCombinedPageBodyHeight();
  const rowHeight=Math.max(38,Number($('rowHeight')?.value)||50);
  const supplierHeadingHeight=26;
  const pages=[];
  let rows=[];
  let usedHeight=0;
  let skuCount=0;
  let offset=0;
  let currentSupplier='';

  const finishPage=()=>{
    if(!rows.length)return;
    pages.push({supplier:'Combined Suppliers',rows,offset});
    offset+=skuCount;
    rows=[];
    usedHeight=0;
    skuCount=0;
    currentSupplier='';
  };

  suppliers.forEach(supplier=>{
    (groups[supplier]||[]).forEach(row=>{
      let headingHeight=currentSupplier===supplier?0:supplierHeadingHeight;
      if(rows.length&&(skuCount>=maxSkuRows||usedHeight+headingHeight+rowHeight>pageHeight)){
        finishPage();
        headingHeight=supplierHeadingHeight;
      }
      rows.push({...row,supplier});
      usedHeight+=headingHeight+rowHeight;
      skuCount++;
      currentSupplier=supplier;
    });
  });
  finishPage();
  return pages;
}

function renderCountSheet(previewOnly=false){
  const storeName=escapeSheetText($('storeField').value||'Store #14014 - Retail');
  const editorName=escapeSheetText($('editorName')?.value||'Danne Lozana');
  const selectedSupplier=$('supplierFilter')?.value||'all';
  const filteredItems=selectedSupplier==='all'?items:items.filter(item=>(item.supplier||'Unassigned Supplier')===selectedSupplier);
  const mergedRows=buildCountSheetRows(filteredItems);
  const pageRows=Number($('rowsPerPage').value);
  const groupingMode=$('supplierGroupingMode')?.value||'split';
  const selectedCombinedSuppliers=getSelectedCombinedSuppliers();
  const groups=mergedRows.reduce((result,item)=>{
    const key=item.supplier||'Unassigned Supplier';
    (result[key]??=[]).push(item);
    return result;
  },{});

  const buildPageObject=(supplier,rows,offset)=>({supplier,rows,offset});
  const pages=[];

  if(groupingMode==='combined'){
    const printedSuppliers=getPrintedCombinedSuppliers();
    const enabledSuppliers=selectedCombinedSuppliers.filter(supplier=>
      Object.prototype.hasOwnProperty.call(groups,supplier)&&!printedSuppliers.has(supplier)
    );
    if(enabledSuppliers.length>1){
      const combinedPages=paginateCombinedSupplierRows(groups,enabledSuppliers,pageRows);
      pages.push(...(previewOnly?combinedPages.slice(0,1):combinedPages));
    }else if(enabledSuppliers.length===1){
      const supplier=enabledSuppliers[0];
      const rows=groups[supplier];
      if(previewOnly)pages.push(buildPageObject(supplier,rows.slice(0,pageRows),0));
      else for(let offset=0;offset<rows.length;offset+=pageRows){
        pages.push(buildPageObject(supplier,rows.slice(offset,offset+pageRows),offset));
      }
    }
  } else if(previewOnly){
    const [supplier,rows]=Object.entries(groups)[0]||[];
    if(supplier)pages.push(buildPageObject(supplier,rows.slice(0,pageRows),0));
  } else {
    Object.entries(groups).forEach(([supplier,rows])=>{
      for(let offset=0;offset<rows.length;offset+=pageRows){
        pages.push(buildPageObject(supplier,rows.slice(offset,offset+pageRows),offset));
      }
    });
  }

  const showBarcode=$('showSheetBarcode').checked;
  const target=previewOnly?$('countSheetLivePreview'):$('countSheetPages');
  const formatLocatorCell=(values)=>values.length?values.map(value=>`<span class="locator-pill">${value}</span>`).join('<br>'):'<span class="locator-empty">—</span>';
  const renderRows=(rows,offset,isCombinedPage)=>{
    const rowEntries=[];
    let currentSupplier='';
    rows.forEach((item,index)=>{
      const itemSupplier=item.supplier||'Unassigned Supplier';
      if(isCombinedPage && currentSupplier!==itemSupplier){
        rowEntries.push(`<tr class="supplier-group-row"><td colspan="10"><span class="supplier-group-label">${itemSupplier}</span></td></tr>`);
        currentSupplier=itemSupplier;
      }
      const barcode=String(item.barcode||'').trim();
      const barcodeCell=showBarcode?(barcode?`<svg class="scan-barcode" data-barcode="${barcode}"></svg>`:'<span class="barcode-missing">NO BARCODE</span>'):'';
      rowEntries.push(`<tr><td>${offset+index+1}</td><td>${item.sku||'—'}</td><td>${barcodeCell}</td><td>${item.description||'—'}</td><td>${formatLocatorCell(item.selling)}</td><td><span class="count-line"></span></td><td>${formatLocatorCell(item.buffer)}</td><td><span class="count-line"></span></td><td>${formatLocatorCell(item.warehouse)}</td><td><span class="count-line"></span></td></tr>`);
    });
    return rowEntries.join('');
  };

  target.innerHTML=pages.map(({supplier,rows,offset},pageIndex)=>`
    <article class="count-sheet-page reference-sheet">
      <header class="reference-sheet-header">
        <div class="reference-title">COUNT SHEET <span>PHYSICAL INVENTORY</span><strong>${groupingMode==='combined' && supplier==='Combined Suppliers' ? 'MULTI-SUPPLIER' : supplier}</strong></div>
        <div class="reference-meta"><b>STORE:</b> ${storeName} <b>BRANCH:</b> Prince Cauayan</div>
        <div class="reference-meta"><b>SUPPLIER:</b> ${groupingMode==='combined' && supplier==='Combined Suppliers' ? 'MIXED SUPPLIERS' : supplier} <b>DATE:</b> ${$('dateField').value||'2026-09-14'} <b>PREPARED BY:</b> ${editorName}</div>
      </header>
      <table class="count-sheet-table reference-table">
        <thead><tr><th>#</th><th>SKU</th><th>BARCODE</th><th>DESCRIPTION</th><th>SELLING LOCATOR</th><th>COUNT</th><th>BUFFER LOCATOR</th><th>COUNT</th><th>WAREHOUSE LOCATOR</th><th>COUNT</th></tr></thead>
        <tbody>${renderRows(rows,offset,supplier==='Combined Suppliers')}</tbody>
      </table>
      <footer class="reference-signoff"><span>COUNTER: __________________</span><span>VALIDATOR: __________________</span><span>SCANNER: __________________</span><span>DATE & TIME: ________________</span></footer>
    </article>`).join('');
  if(previewOnly&&!pages.length)target.innerHTML=groupingMode==='combined'?'<div class="live-empty">Select an unprinted supplier to preview a count sheet.</div>':'<div class="live-empty">Import inventory to preview your count sheet.</div>';
  drawCountSheetBarcodes(target);
  if(previewOnly)return;
  const preview=$('countSheetLivePreview');
  if(preview){const firstPage=$('countSheetPages').firstElementChild;preview.innerHTML=firstPage?firstPage.outerHTML:'<div class="live-empty">Import inventory to preview your count sheet.</div>';drawCountSheetBarcodes(preview)}
  const generatedLabel=groupingMode==='combined'?'combined supplier sheets':'supplier sheets';
  $('countSheetSummary').textContent=groupingMode==='combined'&&!pages.length?'Select at least one unprinted supplier to prepare a count sheet.':`${pages.length} landscape ${generatedLabel} prepared with selling, buffer, and warehouse locator count columns.`;
}

function drawCountSheetBarcodes(root=document){
  const barcodes=[...root.querySelectorAll('.scan-barcode')];
  if(typeof JsBarcode!=='function'){
    barcodes.forEach(svg=>{
      const fallback=document.createElement('span');
      fallback.className='barcode-render-fallback';
      fallback.textContent=svg.dataset.barcode||'';
      svg.replaceWith(fallback);
    });
    return;
  }
  barcodes.forEach(svg=>{
    const value=svg.dataset.barcode;
    if(!value)return;
    try{
      JsBarcode(svg,value,{format:'CODE128',displayValue:true,font:'monospace',fontSize:10,textMargin:2,height:34,margin:0,width:1.35,lineColor:'#111',background:'#fff'});
    }catch(error){
      const fallback=document.createElement('span');
      fallback.className='barcode-render-fallback';
      fallback.textContent=value;
      svg.replaceWith(fallback);
      console.warn('Could not render barcode:',value,error);
    }
  });
}
