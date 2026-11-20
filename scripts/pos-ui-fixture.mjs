// Fictional local POS API for the real exported application. No hosted access.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=resolve(process.argv[2]||'dist'),port=54373;
const org='00000000-0000-0000-0000-000000000001',branch='00000000-0000-0000-0000-000000000002',uid='00000000-0000-0000-0000-000000000003',now=new Date().toISOString();
const user={id:uid,email:'pos@example.test',aud:'authenticated',role:'authenticated',email_confirmed_at:now,created_at:now,app_metadata:{},user_metadata:{}};
const membership={id:'member',organization_id:org,user_id:uid,role_id:'owner',status:'active',created_at:now};
let readOnly=false,dropSale=false,dropRefund=false,changeQuote=false,defaultPayment='CASH';
const permissions=['organization.manage','branch.manage','staff.manage','sale.create','sale.read','sale.refund','customer.read','inventory.read','inventory.product.update','reports.read','purchase.read'];
const products=[['p1','Paracetamol','PARA-001','tablet'],['p2','Cough syrup','COUGH-002','bottle'],['p3','Blocked medicine','BLOCK-003','box']].map(([id,name,sku,stock_unit])=>({id,name,sku,stock_unit,organization_id:org,status:'active',generic_name:null,brand_name:null}));
const barcodes=[{product_id:'p1',barcode:'00100'},{product_id:'p1',barcode:'00101'},{product_id:'p2',barcode:'00200'},{product_id:'p1',barcode:'DUP'},{product_id:'p2',barcode:'DUP'}].map(b=>({...b,organization_id:org}));
const batches=[['b1','p1','EARLY',2,2],['b2','p1','LATER',3,5],['b3','p2','SYRUP',5,10],['b4','p3','QUARANTINED',1,9]].map(([id,product_id,lot_number,selling_price,quantity])=>({id,product_id,lot_number,selling_price,quantity,status:id==='b4'?'QUARANTINED':'ACTIVE',expiry_date:id==='b1'?'2098-01-01':'2099-01-01',organization_id:org,branch_id:branch}));
const sales=Array.from({length:130},(_,i)=>({id:`old-${i}`,organization_id:org,branch_id:branch,sale_number:`HIST-${String(i).padStart(3,'0')}`,status:'COMPLETED',subtotal:1,total_amount:1,discount_total:0,currency_code:'CAD',created_by:uid,completed_at:new Date(Date.now()-(i+1)*86400000).toISOString(),created_at:now,customer_id:null}));
const items=[],payments=[],refunds=[],refundItems=[],movements=[];
function fail(message){throw Object.assign(new Error(message),{code:'23514'});}
function quote(lines){const out=[];for(const line of lines){let remaining=line.quantity;for(const b of batches.filter(b=>b.product_id===line.product_id&&b.status==='ACTIVE'&&b.quantity>0)){const quantity=Math.min(remaining,b.quantity);if(quantity<=0)continue;out.push({product_id:b.product_id,batch_id:b.id,quantity,unit_price:b.selling_price,line_total:Math.round(quantity*b.selling_price*100)/100,expiry_date:b.expiry_date});remaining-=quantity;}if(remaining>0)fail('INSUFFICIENT_STOCK');}return{total_amount:out.reduce((s,i)=>s+i.line_total,0),items:out};}
const sortQuote=q=>JSON.stringify(q.items.map(i=>[i.product_id,i.batch_id,i.quantity,i.unit_price,i.line_total,i.expiry_date]).sort());
function rpc(name,p){
 if(name==='my_membership_unavailable')return false;
 if(name==='my_staff_invitations')return[];
 if(name==='owner_setup_progress')return {pharmacy:true,branch:true,staff:true,supplier:true,product:true,purchase:true};
 if(name==='search_catalog_products'){const query=p.p_search.toLowerCase();return products.filter(product=>[product.name,product.sku,...barcodes.filter(b=>b.product_id===product.id).map(b=>b.barcode)].some(s=>s.toLowerCase().includes(query)));}
 if(name==='quote_sale'){if(changeQuote){batches[0].selling_price+=1;changeQuote=false;}return quote(p.p_lines);}
 if(name==='complete_sale_with_customer'){
   const existing=sales.find(s=>s.idempotency_key===p.p_idempotency_key);if(existing)return existing.id;
   const q=quote(p.p_lines);if(sortQuote(q)!==sortQuote(p.p_expected_quote))fail('SALE_QUOTE_CHANGED');
   if(p.p_payments.reduce((s,i)=>s+i.amount,0)!==q.total_amount)fail('PAYMENT_TOTAL_MISMATCH');
   const id=randomUUID(),sale={id,organization_id:org,branch_id:branch,sale_number:p.p_sale_number,idempotency_key:p.p_idempotency_key,status:'COMPLETED',subtotal:q.total_amount,total_amount:q.total_amount,discount_total:0,currency_code:'CAD',created_by:uid,completed_at:new Date().toISOString(),created_at:now,customer_id:null};sales.unshift(sale);
   for(const i of q.items){batches.find(b=>b.id===i.batch_id).quantity-=i.quantity;const move=randomUUID();items.push({...i,id:randomUUID(),sale_id:id,organization_id:org,inventory_movement_id:move,created_at:now});movements.push({id:move,quantity_delta:-i.quantity,reference_id:id});}
   for(const pay of p.p_payments)payments.push({...pay,id:randomUUID(),organization_id:org,branch_id:branch,sale_id:id,status:'RECORDED',tendered_amount:pay.method==='CASH'?p.p_cash_tendered:null,change_amount:pay.method==='CASH'?Math.round((p.p_cash_tendered-q.total_amount)*100)/100:null,created_at:now});
   return id;
 }
 if(name==='refund_sale'){
   const existing=refunds.find(r=>r.idempotency_key===p.p_idempotency_key);if(existing)return existing.id;
   const sale=sales.find(s=>s.id===p.p_sale_id),selected=p.p_items.map(i=>({...i,item:items.find(si=>si.id===i.sale_item_id&&si.sale_id===sale.id)}));
   for(const row of selected){const prior=refundItems.filter(r=>r.sale_item_id===row.sale_item_id).reduce((s,r)=>s+r.quantity,0);if(row.quantity<=0||prior+row.quantity>row.item.quantity)fail('REFUND_EXCEEDS_SOLD_QUANTITY');}
   const refund={id:randomUUID(),organization_id:org,branch_id:branch,sale_id:sale.id,refund_number:p.p_refund_number,idempotency_key:p.p_idempotency_key,reason:p.p_reason,amount:0,created_at:new Date().toISOString()};
   for(const row of selected){const move=randomUUID(),amount=Math.round(row.quantity*row.item.unit_price*100)/100;refund.amount+=amount;refundItems.push({id:randomUUID(),organization_id:org,refund_id:refund.id,sale_item_id:row.item.id,batch_id:row.item.batch_id,quantity:row.quantity,amount,inventory_movement_id:move});batches.find(b=>b.id===row.item.batch_id).quantity+=row.quantity;movements.push({id:move,quantity_delta:row.quantity,reference_id:refund.id});}
   refunds.unshift(refund);sale.status=items.filter(i=>i.sale_id===sale.id).every(i=>refundItems.filter(r=>r.sale_item_id===i.id).reduce((s,r)=>s+r.quantity,0)===i.quantity)?'REFUNDED':'PARTIALLY_REFUNDED';return refund.id;
 }
 return [];
}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);if(req.method==='OPTIONS')return json(res,{});
 if(url.pathname==='/fixture/state')return json(res,{sales:sales.filter(s=>!s.id.startsWith('old-')),items,payments,refunds,refundItems,movements,batches});
 if(url.pathname==='/fixture/control'){dropSale=url.searchParams.has('dropSale');dropRefund=url.searchParams.has('dropRefund');changeQuote=url.searchParams.has('changeQuote');if(url.searchParams.has('default'))defaultPayment=url.searchParams.get('default');if(url.searchParams.has('readOnly'))readOnly=url.searchParams.get('readOnly')==='1';return json(res,{dropSale,dropRefund,changeQuote,readOnly});}
 if(url.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");}
 if(url.pathname==='/auth/v1/health')return json(res,{});
 let body='';for await(const chunk of req)body+=chunk;const p=body?JSON.parse(body):{};
 if(url.pathname==='/auth/v1/token'){const token=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,email:user.email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');return json(res,{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture',user});}
 if(url.pathname==='/auth/v1/user')return json(res,user);
 if(url.pathname==='/auth/v1/logout')return json(res,{});
 if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.split('/').at(-1),result=rpc(name,p);if(name==='complete_sale_with_customer'&&dropSale){return res.destroy();}if(name==='refund_sale'&&dropRefund){return res.destroy();}return json(res,result);}
 if(url.pathname.startsWith('/rest/v1/')){
 const table=url.pathname.split('/').at(-1);
 let rows=({organizations:[{id:org,name:'Fictional Counter Pharmacy',status:'active',currency_code:'CAD',timezone:'America/Toronto',default_locale:'en'}],branches:[{id:branch,organization_id:org,name:'Main Counter',code:'MAIN',status:'active'}],organization_memberships:[membership],branch_memberships:[{organization_membership_id:membership.id,branch_id:branch}],roles:[{id:'owner',code:'OWNER',name_en:'Owner',name_fr:'Propriétaire',organization_id:null}],role_permissions:(readOnly?['sale.read']:permissions).map(permission_code=>({role_id:'owner',permission_code})),profiles:[{user_id:uid,display_name:'Counter Cashier'}],organization_settings:[{organization_id:org,default_payment_method:defaultPayment,receipt_footer:'Thank you / Merci',low_stock_default_threshold:5}],products,product_barcodes:barcodes,batches,sales,sale_items:items,payments,sale_refunds:refunds,sale_refund_items:refundItems,inventory_balances:batches.map(b=>({...b,batch_id:b.id,on_hand_quantity:b.quantity,reserved_quantity:0,available_quantity:b.quantity,product_name:products.find(p=>p.id===b.product_id).name}))})[table]??[];
 for(const[key,value]of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));if(value.startsWith('in.('))rows=rows.filter(r=>value.slice(4,-1).split(',').includes(String(r[key])));if(value.startsWith('ilike.')){const search=value.slice(6).replaceAll('%','').toLowerCase();rows=rows.filter(r=>String(r[key]).toLowerCase().includes(search));}if(value.startsWith('gte.'))rows=rows.filter(r=>r[key]>=value.slice(4));if(value.startsWith('lt.'))rows=rows.filter(r=>r[key]<value.slice(3));}
 if(table==='sales')rows=[...rows].sort((a,b)=>b.completed_at.localeCompare(a.completed_at));const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);rows=rows.slice(offset,offset+limit);
 return json(res,req.headers.accept?.includes('vnd.pgrst.object')?rows[0]??null:rows);
 }
 const file=resolve(root,`.${decodeURIComponent(url.pathname)==='/'?'/index.html':decodeURIComponent(url.pathname)}`);if(!file.startsWith(root+sep))return json(res,{},404);
 let filename=file,content;try{content=await readFile(file);}catch{filename=extname(file)?resolve(root,'index.html'):`${file}.html`;content=await readFile(filename);}
 res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'})[extname(filename)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Embedder-Policy':'credentialless','Cross-Origin-Opener-Policy':'same-origin'});res.end(content);
}catch(cause){json(res,{message:cause.message,code:cause.code??'23514'},400);}}).listen(port,'127.0.0.1',()=>console.log(`Fictional POS fixture http://127.0.0.1:${port}`));
