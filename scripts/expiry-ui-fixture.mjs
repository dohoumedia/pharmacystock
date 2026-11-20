// Loopback-only fictional UI smoke fixture, not database/authorization QA.
// No real account, production data or hosted service is used.
// Build with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54359 and dummy key.
// Run: node scripts/expiry-ui-fixture.mjs <absolute-path-to-built-dist>
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=resolve(process.argv[2]||fileURLToPath(new URL('../dist/',import.meta.url))),port=54359,now=new Date().toISOString();
const org='00000000-0000-0000-0000-000000000001',branch='00000000-0000-0000-0000-000000000002';
const users=new Map(),keys=new Map();let dropNextReceipt=false; let dropNextAdjustment=false; let dropNextCount=false;
const tables={
 organizations:[{id:org,name:'Fictional Catalog Pharmacy',status:'active',country_code:'CA',currency_code:'CAD',timezone:'America/Toronto',default_locale:'en'}],
 branches:[{id:branch,organization_id:org,name:'Main',code:'MAIN',status:'active'}],organization_memberships:[],branch_memberships:[],
 roles:[{id:'owner-role',code:'OWNER',name_en:'Owner',name_fr:'Propriétaire'}],
 role_permissions:['organization.manage','branch.manage','staff.manage','inventory.expiry.manage','inventory.dispose','inventory.read','inventory.adjust','inventory.count','inventory.product.create','inventory.product.update','inventory.adjust','purchase.read','purchase.create','purchase.receive','import.manage'].map(permission_code=>({permission_code,role_id:'owner-role'})),
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

// Package-specific disposable state. This simulates UI responses only; SQL assertions are separate.
tables.expiry_policies=[{organization_id:org,thresholds_days:[21,7],created_at:now,updated_at:now}];
tables.expiry_alerts=[];tables.expiry_actions=[];
const today=new Date().toISOString().slice(0,10);
const dateAfter=days=>new Date(Date.parse(`${today}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
for(const [index,days,status] of [[0,7,'ACTIVE'],[1,21,'ACTIVE'],[2,22,'ACTIVE'],[3,-1,'ACTIVE'],[4,10,'QUARANTINED'],[5,15,'RECALLED']])Object.assign(tables.batches[index],{expiry_date:dateAfter(days),status});
const east={...tables.batches[1],id:'20000000-0000-0000-0001-000000000002',branch_id:tables.branches[1].id};tables.batches.push(east);tables.inventory_movements.push({id:randomUUID(),organization_id:org,branch_id:east.branch_id,batch_id:east.id,movement_type:'ADJUSTMENT_IN',quantity_delta:8,idempotency_key:'seed-east',reason:'FICTIONAL',created_at:now,occurred_at:now});
tables.purchase_orders.push({id:'po-1',organization_id:org,branch_id:branch,supplier_id:'supplier-1',po_number:'PO-1',status:'received'});tables.purchase_receipts.push({id:'receipt-1',organization_id:org,branch_id:branch,purchase_order_id:'po-1',receipt_number:'REC-1',received_at:now});tables.purchase_receipt_lines.push({id:'line-1',organization_id:org,receipt_id:'receipt-1',batch_id:tables.batches[0].id,quantity:10});
let dropAction=false,dropRecovery=false,failBatchRead=false;
function expiryRisk(){return tables.batches.flatMap(batch=>{const balance=balances().find(row=>row.batch_id===batch.id);if(!balance||balance.on_hand_quantity<=0||['DISPOSED','DEPLETED'].includes(batch.status))return[];const product=tables.products.find(row=>row.id===batch.product_id);const days=Math.round((Date.parse(`${batch.expiry_date}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000);return[{...balance,batch_status:batch.status,product_name:product.name,generic_name:product.generic_name,lot_number:batch.lot_number,expiry_date:batch.expiry_date,days_remaining:days,purchase_cost:batch.purchase_cost,value_at_risk:balance.on_hand_quantity*batch.purchase_cost,risk_bucket:days<0?'EXPIRED':days<=30?'30_DAYS':'OK'}];});}
function rpc(name,payload){
 if(name==='owner_setup_progress')return{pharmacy:true,branch:true,staff:true,supplier:true,product:true,purchase:true};if(name==='my_staff_invitations')return[];
 if(name==='search_catalog_batches'){const query=(payload.p_search??'').toLowerCase();return tables.batches.filter(row=>row.branch_id===payload.p_branch_id&&[row.lot_number,tables.products.find(product=>product.id===row.product_id)?.name].some(value=>value?.toLowerCase().includes(query))).sort((a,b)=>a.expiry_date.localeCompare(b.expiry_date)||a.id.localeCompare(b.id));}
 if(name==='refresh_expiry_alerts'){
  for(const batch of tables.batches)if(batch.branch_id===payload.p_branch_id&&batch.expiry_date<today&&['ACTIVE','QUARANTINED'].includes(batch.status))batch.status='EXPIRED';
  for(const row of expiryRisk().filter(row=>row.branch_id===payload.p_branch_id)){
   const threshold=row.days_remaining<0?0:[...tables.expiry_policies[0].thresholds_days].sort((a,b)=>a-b).find(value=>value>=row.days_remaining);
   if(threshold===undefined)continue;const type=row.days_remaining<0?'EXPIRED':'EXPIRY_WARNING';
   if(!tables.expiry_alerts.some(item=>item.batch_id===row.batch_id&&item.threshold_days===threshold&&item.alert_type===type))tables.expiry_alerts.push({id:randomUUID(),organization_id:org,branch_id:row.branch_id,batch_id:row.batch_id,alert_type:type,threshold_days:threshold,expiry_date_snapshot:row.expiry_date,status:'OPEN',created_at:now});
  }return 0;
 }
 if(name==='acknowledge_expiry_alert'){const row=tables.expiry_alerts.find(item=>item.id===payload.p_alert_id);row.status='ACKNOWLEDGED';return row.id;}
 if(['record_expiry_action','dispose_batch','return_batch_to_supplier'].includes(name)){
  const batch=tables.batches.find(row=>row.id===payload.p_batch_id);if(!batch)fail('BATCH_NOT_FOUND');
  const action=name==='record_expiry_action'?payload.p_action_type:name==='dispose_batch'?'DISPOSE':'SUPPLIER_RETURN';
  const previous=payload.p_idempotency_key&&tables.expiry_actions.find(row=>row.metadata.idempotency_key===payload.p_idempotency_key);if(previous)return previous.id;
  const onHand=balances().find(row=>row.batch_id===batch.id)?.on_hand_quantity??0;let quantity=null;
  if(action==='QUARANTINE'){if(batch.status!=='ACTIVE')fail('BATCH_NOT_ELIGIBLE_FOR_QUARANTINE');batch.status='QUARANTINED';}
  if(action==='RECALL'){if(!['ACTIVE','QUARANTINED'].includes(batch.status))fail('BATCH_NOT_ELIGIBLE_FOR_RECALL');batch.status='RECALLED';}
  if(action==='RELEASE_QUARANTINE'){if(batch.status!=='QUARANTINED'||batch.expiry_date<today)fail('BATCH_NOT_ELIGIBLE_FOR_RELEASE');batch.status='ACTIVE';}
  if(action==='DISPOSE'||action==='SUPPLIER_RETURN'){
   quantity=action==='DISPOSE'?onHand:payload.p_quantity;if(!(quantity>0)||quantity>onHand)fail('INSUFFICIENT_STOCK');
   tables.inventory_movements.push({id:randomUUID(),organization_id:org,branch_id:batch.branch_id,batch_id:batch.id,movement_type:action==='DISPOSE'?'DISPOSAL':'SUPPLIER_RETURN',quantity_delta:-quantity,reason:payload.p_reason,idempotency_key:payload.p_idempotency_key,reference_type:'EXPIRY_ACTION',reference_id:batch.id,created_at:new Date().toISOString(),occurred_at:now});
   if(action==='DISPOSE')batch.status='DISPOSED';else if(quantity===onHand)batch.status='DEPLETED';
  }
  const row={id:randomUUID(),organization_id:org,branch_id:batch.branch_id,batch_id:batch.id,action_type:action,quantity,reason:payload.p_reason,metadata:payload.p_idempotency_key?{idempotency_key:payload.p_idempotency_key}:{},actor_user_id:'fixture',created_at:new Date().toISOString()};tables.expiry_actions.unshift(row);return row.id;
 }
 return[];
}
const handler=async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname==='/__fixture/fail-next-batch'){failBatchRead=true;return response(res,{armed:true});}
 if(url.pathname==='/__fixture/drop-next-action'){dropAction=true;return response(res,{armed:true});}
 if(url.pathname==='/__fixture/expiry-state')return response(res,{actions:tables.expiry_actions,movements:tables.inventory_movements.filter(row=>row.reference_type==='EXPIRY_ACTION'),risk:expiryRisk(),balances:balances(),batches:tables.batches,policy:tables.expiry_policies[0]});
 if(req.method==='OPTIONS')return response(res,{});
 if(url.pathname==='/auth/v1/health')return response(res,{name:'fictional-expiry-fixture'});
 if(url.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");}
 let body='';for await(const chunk of req)body+=chunk;const payload=body?JSON.parse(body):{};
 if(url.pathname==='/auth/v1/token'){const email=payload.email||'fixture-owner@example.invalid';if(!users.has(email)){const id=randomUUID();users.set(email,{id,email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,confirmed_at:now,created_at:now,app_metadata:{},user_metadata:{}});const membership={id:randomUUID(),organization_id:org,user_id:id,role_id:'owner-role',status:'active'};tables.organization_memberships.push(membership);for(const location of tables.branches)tables.branch_memberships.push({organization_membership_id:membership.id,branch_id:location.id});}const user=users.get(email),token=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fictional'].join('.');return response(res,{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fictional',user});}
 if(url.pathname==='/auth/v1/logout')return response(res,{});
 if(url.pathname==='/auth/v1/user'){let user;try{const claims=JSON.parse(Buffer.from(req.headers.authorization?.split('.')[1]??'','base64url').toString());user=[...users.values()].find(item=>item.id===claims.sub);}catch{}return response(res,user??null);}
 if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.split('/').at(-1),result=rpc(name,payload);if(['record_expiry_action','dispose_batch','return_batch_to_supplier'].includes(name)&&dropAction){dropAction=false;dropRecovery=true;req.socket.destroy();return;}return response(res,Array.isArray(result)?paginate(result,req,url.searchParams):result);}
 if(url.pathname.startsWith('/rest/v1/')){
  const table=url.pathname.split('/').at(-1);if(table==='batches'&&url.searchParams.has('id')&&failBatchRead){failBatchRead=false;return response(res,{code:'P0002',message:'BATCH_NOT_FOUND'},400);}if(table==='expiry_actions'&&dropRecovery){dropRecovery=false;req.socket.destroy();return;}
  const source=table==='inventory_balances'?balances():table==='expiry_risk'?expiryRisk():table==='profiles'?[...users.values()].map(row=>({user_id:row.id,display_name:'Fictional Owner'})):tables[table]??[];let rows=filterRows(source,url.searchParams);
  if(req.method==='POST'&&table==='expiry_policies'){Object.assign(tables.expiry_policies[0],payload);rows=[tables.expiry_policies[0]];}
  rows=paginate(rows,req,url.searchParams);return response(res,req.headers.accept?.includes('vnd.pgrst.object')?rows[0]??null:rows);
 }
 const pathname=decodeURIComponent(url.pathname);let filename=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);if(!filename.startsWith(root.endsWith(sep)?root:root+sep))return response(res,{},404);let contents;try{contents=await readFile(filename);}catch{filename=extname(filename)?resolve(root,'index.html'):`${filename}.html`;contents=await readFile(filename);}const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.wasm':'application/wasm','.json':'application/json'}[extname(filename)]??'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cross-Origin-Embedder-Policy':'credentialless','Cross-Origin-Opener-Policy':'same-origin'});res.end(contents);
 }catch(cause){console.error('Fictional expiry fixture:',cause.message);response(res,{code:'23514',message:cause.message},400);}
};
createServer(handler).listen(port,'127.0.0.1',()=>console.log(`Fictional expiry UI fixture: http://127.0.0.1:${port}; static files: ${root}`));
