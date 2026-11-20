// Loopback-only fictional UI smoke fixture, not database/authorization QA.
// No real account, production data or hosted service is used.
// Build with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54360 and dummy key.
// Run: node scripts/transfer-ui-fixture.mjs <absolute-path-to-built-dist>
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=resolve(process.argv[2]||fileURLToPath(new URL('../dist/',import.meta.url))),port=54360,now=new Date().toISOString();
const org='00000000-0000-0000-0000-000000000001',branch='00000000-0000-0000-0000-000000000002';
const users=new Map();
const tables={
 organizations:[{id:org,name:'Fictional Catalog Pharmacy',status:'active',country_code:'CA',currency_code:'CAD',timezone:'America/Toronto',default_locale:'en'}],
 branches:[{id:branch,organization_id:org,name:'Main',code:'MAIN',status:'active'}],organization_memberships:[],branch_memberships:[],
 roles:[{id:'owner-role',code:'OWNER',name_en:'Owner',name_fr:'Propriétaire'}],
 role_permissions:['organization.manage','branch.manage','staff.manage','inventory.expiry.manage','inventory.dispose','inventory.read','inventory.adjust','inventory.count','inventory.product.create','inventory.product.update','inventory.adjust','transfer.read','transfer.create','transfer.approve','transfer.dispatch','transfer.receive','purchase.read','purchase.create','purchase.receive','import.manage'].map(permission_code=>({permission_code,role_id:'owner-role'})),
 categories:[{id:'category-1',organization_id:org,name:'Medicines',status:'active'}],manufacturers:[{id:'manufacturer-1',organization_id:org,name:'Fictional Labs',status:'active'}],
 suppliers:[{id:'supplier-1',organization_id:org,name:'Supplier, SARL',code:'SUP1',status:'active',created_at:now,updated_at:now}],
 products:[],product_barcodes:[],batches:[],inventory_movements:[],purchase_orders:[],purchase_order_lines:[],purchase_receipts:[],purchase_receipt_lines:[],import_jobs:[],import_rows:[],inventory_stock_counts:[],inventory_stock_count_lines:[]
};
tables.branches.push({id:'00000000-0000-0000-0000-000000000003',organization_id:org,name:'East',code:'EAST',status:'active'});
tables.purchase_orders.push({id:'cancelled-po',organization_id:org,branch_id:branch,supplier_id:'supplier-1',po_number:'PO-CANCELLED',status:'cancelled',created_at:now,updated_at:now,expected_at:null});
for(let index=1;index<=300;index++){
 const id=`10000000-0000-0000-0000-${String(index).padStart(12,'0')}`;
 tables.products.push({id,organization_id:org,name:`Catalog medicine ${String(index).padStart(3,'0')}`,sku:`SKU-${index}`,stock_unit:'tablet',package_size:'Box of 20 tablets',generic_name:null,brand_name:null,strength:'10 mg',dosage_form:'tablet',manufacturer_id:'manufacturer-1',category_id:'category-1',status:'active',archived_at:null,created_at:now,updated_at:now});
 tables.product_barcodes.push({id:randomUUID(),organization_id:org,product_id:id,barcode:`900${String(index).padStart(6,'0')}`,is_primary:true,created_at:now});
 if(index<=140){const batchId=`20000000-0000-0000-0000-${String(index).padStart(12,'0')}`;tables.batches.push({id:batchId,organization_id:org,branch_id:branch,product_id:id,lot_number:`LOT-${String(index).padStart(3,'0')}`,expiry_date:'2028-12-31',purchase_cost:1,selling_price:2,status:'ACTIVE',notes:null,created_at:now,updated_at:now});tables.inventory_movements.push({id:randomUUID(),organization_id:org,branch_id:branch,batch_id:batchId,movement_type:'ADJUSTMENT_IN',quantity_delta:10,unit_cost:1,idempotency_key:`seed-${index}`,reason:'FICTIONAL_FIXTURE',occurred_at:now,created_at:now});}
}
function balances(){return tables.batches.flatMap(batch=>{const movements=tables.inventory_movements.filter(item=>item.batch_id===batch.id);if(!movements.length)return[];const onHand=movements.reduce((sum,item)=>sum+item.quantity_delta,0);return[{organization_id:org,branch_id:batch.branch_id,batch_id:batch.id,product_id:batch.product_id,on_hand_quantity:onHand,reserved_quantity:0,available_quantity:onHand,last_movement_at:now}];});}
function filterRows(rows,params){let result=[...rows];for(const[key,value]of params){if(value.startsWith('eq.'))result=result.filter(row=>String(row[key])===value.slice(3));else if(value.startsWith('in.('))result=result.filter(row=>value.slice(4,-1).split(',').includes(String(row[key])));else if(value.startsWith('ilike.'))result=result.filter(row=>String(row[key]??'').toLowerCase().includes(value.slice(6).replaceAll('%','').toLowerCase()));else if(value.startsWith('cs.')){const wanted=JSON.parse(value.slice(3));result=result.filter(row=>Object.entries(wanted).every(([field,item])=>row[key]?.[field]===item));}else if(value==='is.null')result=result.filter(row=>row[key]==null);}const order=params.get('order');if(order)for(const term of order.split(',').reverse()){const[field,direction]=term.split('.');result.sort((a,b)=>String(a[field]??'').localeCompare(String(b[field]??''))*(direction==='desc'?-1:1));}return result;}
function paginate(rows,req,params){const range=String(req.headers.range??'').split('-').map(Number),offset=Number(params.get('offset')??(range.length===2?range[0]:0)),limit=Number(params.get('limit')??(range.length===2?range[1]-offset+1:rows.length));return rows.slice(offset,offset+limit);}
function response(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function fail(code){const error=new Error(code);error.code=code;throw error;}


tables.stock_transfers=[];tables.stock_transfer_lines=[];tables.audit_logs=[];
let dropAction=false,dropRecovery=false;
const today=new Date().toISOString().slice(0,10);
tables.batches.push({...tables.batches[99],id:'20000000-0000-0000-0000-000000000999',lot_number:'LOT-100-B'});
tables.inventory_movements.push({id:randomUUID(),organization_id:org,branch_id:branch,batch_id:tables.batches.at(-1).id,movement_type:'ADJUSTMENT_IN',quantity_delta:10,idempotency_key:'seed-other-lot',created_at:now,occurred_at:now});
for(const [index,status] of [[0,'QUARANTINED'],[1,'RECALLED']])tables.batches[index].status=status;
tables.batches[2].expiry_date='2020-01-01';
function rpc(name,payload){
 if(name==='list_stock_transfer_destinations')return tables.branches.filter(row=>row.organization_id===payload.p_organization_id&&row.id!==payload.p_source_branch_id&&row.status==='active');
 if(name==='read_stock_transfer_context'){
  const transfer=tables.stock_transfers.find(row=>row.id===payload.p_transfer_id);if(!transfer)fail('TRANSFER_NOT_FOUND');
  const lines=tables.stock_transfer_lines.filter(row=>row.transfer_id===transfer.id),ids=lines.flatMap(row=>[row.source_batch_id,row.destination_batch_id]);
  return {branches:tables.branches.filter(row=>[transfer.source_branch_id,transfer.destination_branch_id].includes(row.id)),batches:tables.batches.filter(row=>ids.includes(row.id)),balances:balances().filter(row=>ids.includes(row.batch_id)),profiles:[...users.values()].map(row=>({user_id:row.id,display_name:'Fictional Owner'})),movements:tables.inventory_movements.filter(row=>row.reference_type==='STOCK_TRANSFER'&&row.reference_id===transfer.id),history:tables.audit_logs.filter(row=>row.entity_id===transfer.id)};
 }
 if(name==='search_catalog_batches'){
  const text=payload.p_search.toLowerCase();
  return tables.batches.filter(row=>row.branch_id===payload.p_branch_id).filter(batch=>{const product=tables.products.find(row=>row.id===batch.product_id);return[batch.lot_number,product.name,product.sku,...tables.product_barcodes.filter(row=>row.product_id===product.id).map(row=>row.barcode)].some(value=>String(value??'').toLowerCase().includes(text));});
 }
 if(name==='create_stock_transfer'){
  const previous=tables.stock_transfers.find(row=>row.idempotency_key===payload.p_idempotency_key);if(previous)return previous.id;
  if(payload.p_source_branch_id===payload.p_destination_branch_id)fail('TRANSFER_SAME_BRANCH');
  for(const line of payload.p_lines){const batch=tables.batches.find(row=>row.id===line.source_batch_id);if(!batch||batch.branch_id!==payload.p_source_branch_id)fail('TRANSFER_SOURCE_BATCH_INVALID');if(batch.status!=='ACTIVE'||batch.expiry_date<today)fail('TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE');if(!(line.quantity>0))fail('TRANSFER_QUANTITY_INVALID');}
  const transfer={id:randomUUID(),organization_id:org,source_branch_id:payload.p_source_branch_id,destination_branch_id:payload.p_destination_branch_id,transfer_number:payload.p_transfer_number,idempotency_key:payload.p_idempotency_key,status:'REQUESTED',notes:payload.p_notes,requested_by:[...users.values()][0]?.id,approved_by:null,dispatched_by:null,received_by:null,requested_at:new Date().toISOString(),approved_at:null,dispatched_at:null,received_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  tables.stock_transfers.unshift(transfer);
  for(const line of payload.p_lines){const batch=tables.batches.find(row=>row.id===line.source_batch_id);tables.stock_transfer_lines.push({id:randomUUID(),organization_id:org,transfer_id:transfer.id,source_batch_id:batch.id,destination_batch_id:null,product_id:batch.product_id,requested_quantity:line.quantity,dispatched_quantity:0,received_quantity:0,discrepancy_quantity:0,discrepancy_reason:null,transfer_out_movement_id:null,transfer_in_movement_id:null,created_at:now,updated_at:now});}
  audit(transfer,'created');return transfer.id;
 }
 if(['approve_stock_transfer','dispatch_stock_transfer','receive_stock_transfer','cancel_stock_transfer'].includes(name)){
  const transfer=tables.stock_transfers.find(row=>row.id===payload.p_transfer_id);if(!transfer)fail('TRANSFER_NOT_FOUND');
  const lines=tables.stock_transfer_lines.filter(row=>row.transfer_id===transfer.id);
  if(name==='approve_stock_transfer'){if(transfer.status!=='REQUESTED')fail('TRANSFER_NOT_REQUESTED');transfer.status='APPROVED';transfer.approved_at=new Date().toISOString();transfer.approved_by=[...users.values()][0]?.id;audit(transfer,'approved');}
  if(name==='cancel_stock_transfer'){if(!['REQUESTED','APPROVED'].includes(transfer.status))fail('TRANSFER_CANNOT_CANCEL');transfer.status='CANCELLED';transfer.notes=[transfer.notes,payload.p_reason].filter(Boolean).join('\n');}
  if(name==='dispatch_stock_transfer'){
   if(transfer.dispatched_at)return transfer.id;if(transfer.status!=='APPROVED')fail('TRANSFER_NOT_APPROVED');
   for(const line of lines){const batch=tables.batches.find(row=>row.id===line.source_batch_id);if(batch.status!=='ACTIVE'||batch.expiry_date<today)fail('TRANSFER_SOURCE_BATCH_NOT_ELIGIBLE');if(line.requested_quantity>(balances().find(row=>row.batch_id===batch.id)?.available_quantity??0))fail('INSUFFICIENT_STOCK');}
   for(const line of lines){const movement={id:randomUUID(),organization_id:org,branch_id:transfer.source_branch_id,batch_id:line.source_batch_id,movement_type:'TRANSFER_OUT',quantity_delta:-line.requested_quantity,reference_type:'STOCK_TRANSFER',reference_id:transfer.id,idempotency_key:`transfer:${transfer.id}:out:${line.id}`,occurred_at:new Date().toISOString(),created_at:new Date().toISOString()};tables.inventory_movements.push(movement);line.dispatched_quantity=line.requested_quantity;line.transfer_out_movement_id=movement.id;}
   transfer.status='DISPATCHED';transfer.dispatched_at=new Date().toISOString();transfer.dispatched_by=[...users.values()][0]?.id;audit(transfer,'dispatched');
  }
  if(name==='receive_stock_transfer'){
   if(transfer.received_at)return transfer.id;if(transfer.status!=='DISPATCHED')fail('TRANSFER_NOT_DISPATCHED');
   for(const line of lines){const input=payload.p_received_lines.find(row=>row.line_id===line.id);if(!input||input.quantity<0||input.quantity>line.dispatched_quantity)fail('TRANSFER_RECEIVED_QUANTITY_INVALID');}
   for(const line of lines){const input=payload.p_received_lines.find(row=>row.line_id===line.id),source=tables.batches.find(row=>row.id===line.source_batch_id);line.received_quantity=input.quantity;line.discrepancy_quantity=line.dispatched_quantity-input.quantity;line.discrepancy_reason=input.reason??null;
    if(input.quantity>0){let batch=tables.batches.find(row=>row.branch_id===transfer.destination_branch_id&&row.product_id===source.product_id&&row.lot_number===source.lot_number&&row.expiry_date===source.expiry_date);if(!batch){batch={...source,id:randomUUID(),branch_id:transfer.destination_branch_id,status:source.expiry_date<today?'EXPIRED':'ACTIVE'};tables.batches.push(batch);}
     const movement={id:randomUUID(),organization_id:org,branch_id:transfer.destination_branch_id,batch_id:batch.id,movement_type:'TRANSFER_IN',quantity_delta:input.quantity,reference_type:'STOCK_TRANSFER',reference_id:transfer.id,idempotency_key:`transfer:${transfer.id}:in:${line.id}`,metadata:{source_batch_id:source.id},occurred_at:new Date().toISOString(),created_at:new Date().toISOString()};tables.inventory_movements.push(movement);line.destination_batch_id=batch.id;line.transfer_in_movement_id=movement.id;}
   }
   transfer.status=lines.some(row=>row.discrepancy_quantity!==0)?'RECEIVED_WITH_DISCREPANCY':'RECEIVED';transfer.discrepancy_notes=payload.p_discrepancy_notes;transfer.received_at=new Date().toISOString();transfer.received_by=[...users.values()][0]?.id;audit(transfer,'received');
  }
  transfer.updated_at=new Date().toISOString();return transfer.id;
 }
 return [];
}
function audit(transfer,event){tables.audit_logs.push({id:randomUUID(),organization_id:org,branch_id:transfer.source_branch_id,actor_user_id:[...users.values()][0]?.id,event_type:'transfer.'+event,entity_type:'stock_transfer',entity_id:transfer.id,metadata:{},created_at:new Date().toISOString()});}
const handler=async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname==='/__fixture/drop-next-action'){dropAction=true;return response(res,{armed:true});}
 if(url.pathname==='/__fixture/state')return response(res,{transfers:tables.stock_transfers,lines:tables.stock_transfer_lines,movements:tables.inventory_movements.filter(row=>row.reference_type==='STOCK_TRANSFER'),balances:balances(),batches:tables.batches,history:tables.audit_logs});
 if(req.method==='OPTIONS')return response(res,{});
 if(url.pathname==='/auth/v1/health')return response(res,{name:'fictional-transfer-fixture'});
 if(url.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");}
 let body='';for await(const chunk of req)body+=chunk;const payload=body?JSON.parse(body):{};
 if(url.pathname==='/auth/v1/token'){const email=payload.email||'fixture-owner@example.invalid';if(!users.has(email)){const id=randomUUID();users.set(email,{id,email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,confirmed_at:now,created_at:now,app_metadata:{},user_metadata:{}});const membership={id:randomUUID(),organization_id:org,user_id:id,role_id:'owner-role',status:'active'};tables.organization_memberships.push(membership);for(const location of tables.branches)tables.branch_memberships.push({organization_membership_id:membership.id,branch_id:location.id});}const user=users.get(email),token=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fictional'].join('.');return response(res,{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fictional',user});}
 if(url.pathname==='/auth/v1/logout')return response(res,{});
 if(url.pathname==='/auth/v1/user'){let user;try{const claims=JSON.parse(Buffer.from(req.headers.authorization?.split('.')[1]??'','base64url').toString());user=[...users.values()].find(item=>item.id===claims.sub);}catch{}return response(res,user??null);}
 if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.split('/').at(-1),result=rpc(name,payload);if(['create_stock_transfer','approve_stock_transfer','dispatch_stock_transfer','receive_stock_transfer','cancel_stock_transfer'].includes(name)&&dropAction){dropAction=false;dropRecovery=true;req.socket.destroy();return;}return response(res,Array.isArray(result)?paginate(result,req,url.searchParams):result);}
 if(url.pathname.startsWith('/rest/v1/')){
  const table=url.pathname.split('/').at(-1);if(table==='stock_transfers'&&dropRecovery){dropRecovery=false;req.socket.destroy();return;}
  const source=table==='inventory_balances'?balances():table==='profiles'?[...users.values()].map(row=>({user_id:row.id,display_name:'Fictional Owner'})):tables[table]??[];let rows=filterRows(source,url.searchParams);
  rows=paginate(rows,req,url.searchParams);return response(res,req.headers.accept?.includes('vnd.pgrst.object')?rows[0]??null:rows);
 }
 const pathname=decodeURIComponent(url.pathname);let filename=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);if(!filename.startsWith(root.endsWith(sep)?root:root+sep))return response(res,{},404);let contents;try{contents=await readFile(filename);}catch{filename=extname(filename)?resolve(root,'index.html'):`${filename}.html`;contents=await readFile(filename);}const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.wasm':'application/wasm','.json':'application/json'}[extname(filename)]??'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cross-Origin-Embedder-Policy':'credentialless','Cross-Origin-Opener-Policy':'same-origin'});res.end(contents);
 }catch(cause){console.error('Fictional transfer fixture:',cause.message);response(res,{code:'23514',message:cause.message},400);}
};
createServer(handler).listen(port,'127.0.0.1',()=>console.log(`Fictional transfer UI fixture: http://127.0.0.1:${port}; static files: ${root}`));
