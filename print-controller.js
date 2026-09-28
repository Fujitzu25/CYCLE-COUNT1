let pendingCombinedPrint=[];
let pendingCombinedPrintSignature='';

function getSelectedSuppliersForPrint(){
  if($('supplierGroupingMode')?.value!=='combined')return [];
  const selected=getSelectedCombinedSuppliers();
  const printed=getPrintedCombinedSuppliers();
  const supplierFilter=$('supplierFilter')?.value||'all';
  const inventorySuppliers=new Set(items.map(item=>item.supplier||'Unassigned Supplier'));
  return selected.filter(supplier=>inventorySuppliers.has(supplier)&&!printed.has(supplier)&&
    (supplierFilter==='all'||supplier===supplierFilter));
}

function prepareCountSheetPrint(){
  if(typeof applyLayout==='function')applyLayout();
  if(typeof renderCountSheet==='function')renderCountSheet();
  Object.values(panels).forEach(panel=>panel.hidden=true);
  $('countSheetPanel').hidden=false;
  document.body.classList.add('print-count-sheet');
}
function finishCountSheetPrint(){
  document.body.classList.remove('print-count-sheet');
  if(!pendingCombinedPrint.length)return;
  $('printConfirmationSuppliers').textContent=pendingCombinedPrint.join(', ');
  $('printConfirmationModal').hidden=false;
}
function printPreparedCountSheet(action){
  prepareCountSheetPrint();
  pendingCombinedPrint=getSelectedSuppliersForPrint();
  pendingCombinedPrintSignature=getInventoryPrintSignature();
  const supplier=$('supplierFilter')?.value||'all';
  if(typeof persistLocalCycleData==='function')persistLocalCycleData(action,supplier==='all'?'All suppliers':supplier);
  requestAnimationFrame(()=>window.print());
}
$('printSheetBtn').onclick=()=>printPreparedCountSheet('Print requested');
$('exportSheetBtn').onclick=()=>printPreparedCountSheet('PDF export requested');
window.addEventListener('beforeprint',prepareCountSheetPrint);
window.addEventListener('afterprint',finishCountSheetPrint);
$('confirmSuppliersPrinted').onclick=()=>{
  markCombinedSuppliersPrinted(pendingCombinedPrint,pendingCombinedPrintSignature);
  pendingCombinedPrint=[];
  pendingCombinedPrintSignature='';
  $('printConfirmationModal').hidden=true;
};
$('cancelSupplierPrintConfirmation').onclick=()=>{
  pendingCombinedPrint=[];
  pendingCombinedPrintSignature='';
  $('printConfirmationModal').hidden=true;
};
