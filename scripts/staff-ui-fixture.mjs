// Fictional loopback API + exported UI. No hosted data, accounts or email delivery.
// Build with dotenv disabled and EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54371.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=resolve(process.argv[2]||fileURLToPath(new URL('../dist/',import.meta.url))), port=54371;
const org='00000000-0000-0000-0000-000000000001',main='00000000-0000-0000-0000-000000000002',east='00000000-0000-0000-0000-000000000003',now=new Date().toISOString();
const users=new Map(), memberships=[], access=[], invitations=[], events=[];
const branches=[{id:main,organization_id:org,name:'Main',code:'MAIN',status:'active'},{id:east,organization_id:org,name:'East',code:'EAST',status:'active'}];
const roles=[['OWNER','Owner','Propriétaire'],['MANAGER','Manager','Gérant'],['CASHIER','Cashier','Caissier'],['INVENTORY_OFFICER','Inventory Officer','Responsable du stock'],['AUDITOR','Read-only / Auditor','Lecture seule / Auditeur']].map(([code,name_en,name_fr])=>({id:code,code,name_en,name_fr,organization_id:null,is_system:true,created_at:now}));
const rolePermissions={OWNER:['organization.manage','branch.manage','staff.manage','sale.create','inventory.read','inventory.adjust','purchase.read','purchase.receive','reports.read'],MANAGER:['branch.manage','staff.manage','sale.create','inventory.read','inventory.adjust','purchase.read','reports.read'],CASHIER:['inventory.read','sale.create','customer.read'],INVENTORY_OFFICER:['inventory.read','inventory.adjust','purchase.read'],AUDITOR:['inventory.read','reports.read']};
function userFor(email){email=email.toLowerCase();if(!users.has(email))users.set(email,{id:randomUUID(),email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,confirmed_at:now,created_at:now,app_metadata:{},user_metadata:{}});return users.get(email);}
const owner=userFor('owner@example.test');
memberships.push({id:randomUUID(),organization_id:org,user_id:owner.id,role_id:'OWNER',status:'active',created_at:now,updated_at:now});
access.push(...branches.map(b=>({branch_id:b.id,organization_membership_id:memberships[0].id})));
for(const [email,status] of [['expired@example.test','pending'],['cancelled@example.test','cancelled']]) invitations.push({id:randomUUID(),organization_id:org,email,display_name:email.split('@')[0],role_id:'CASHIER',branch_id:main,status,created_at:'2026-01-01T00:00:00Z',expires_at:'2026-01-08T00:00:00Z',accepted_at:null});
let dropNext=false;
function fail(message){throw new Error(message);}
function memberFor(user){return memberships.find(m=>m.user_id===user?.id&&m.status==='active');}
function can(user,permission){return rolePermissions[memberFor(user)?.role_id]?.includes(permission);}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function state(member){return {role_id:member.role_id,status:member.status,branch_ids:access.filter(a=>a.organization_membership_id===member.id).map(a=>a.branch_id).sort()};}
function rpc(name,p,user){
 if(name==='my_membership_unavailable')return memberships.some(m=>m.user_id===user?.id);
 if(name==='owner_setup_progress')return {pharmacy:true,branch:true,staff:invitations.length>0,supplier:false,product:false,purchase:false};
 if(name==='my_staff_invitations')return invitations.filter(i=>i.email===user?.email&&i.status==='pending'&&Date.parse(i.expires_at)>Date.now()).map(i=>({...i,organization_name:'Fictional Staff Pharmacy',branch_name:branches.find(b=>b.id===i.branch_id).name,role_name_en:roles.find(r=>r.id===i.role_id).name_en,role_name_fr:roles.find(r=>r.id===i.role_id).name_fr}));
 if(name==='accept_staff_invitation'){
   const i=invitations.find(i=>i.id===p.p_invitation_id&&i.email===user?.email);if(!i)fail('INVITATION_UNAVAILABLE');
   if(i.status==='accepted'&&i.accepted_by===user.id&&memberFor(user))return org;
   if(i.status!=='pending'||Date.parse(i.expires_at)<=Date.now())fail('INVITATION_UNAVAILABLE');
   if(memberships.some(m=>m.user_id===user.id))fail('INVITATION_ALREADY_MEMBER');
   const m={id:randomUUID(),organization_id:org,user_id:user.id,role_id:i.role_id,status:'active',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};memberships.push(m);access.push({organization_membership_id:m.id,branch_id:i.branch_id});i.status='accepted';i.accepted_by=user.id;i.accepted_at=new Date().toISOString();user.display_name=i.display_name;events.push({event:'accepted',id:i.id});return org;
 }
 if(!can(user,'staff.manage'))fail('AUTH_FORBIDDEN');
 if(name==='staff_directory_details')return memberships.map(m=>({user_id:m.user_id,email:[...users.values()].find(u=>u.id===m.user_id)?.email,access_changed_at:m.updated_at}));
 if(name==='invite_staff'){
   const email=p.p_email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVITATION_INVALID');
   if(memberships.some(m=>[...users.values()].find(u=>u.id===m.user_id)?.email===email))fail('INVITATION_ALREADY_MEMBER');
   const pending=invitations.find(i=>i.email===email&&i.status==='pending');
   if(pending&&Date.parse(pending.expires_at)>Date.now()){if(pending.display_name===p.p_display_name&&pending.role_id===p.p_role_id&&pending.branch_id===p.p_branch_id)return pending.id;fail('INVITATION_PENDING');}
   if(pending)pending.status='cancelled';const i={id:randomUUID(),organization_id:org,email,display_name:p.p_display_name,role_id:p.p_role_id,branch_id:p.p_branch_id,status:'pending',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+604800000).toISOString(),accepted_at:null};invitations.unshift(i);events.push({event:'invited',id:i.id});return i.id;
 }
 if(name==='cancel_staff_invitation'){const i=invitations.find(i=>i.id===p.p_invitation_id);if(i?.status==='pending'){i.status='cancelled';events.push({event:'cancelled',id:i.id});}return null;}
 if(name==='maintain_staff_access'){
   const m=memberships.find(m=>m.id===p.p_membership_id);if(!m||m.user_id===user.id)fail('AUTH_FORBIDDEN');if(m.role_id==='OWNER')fail('STAFF_OWNER_PROTECTED');
   const current=state(m),next={role_id:p.p_next.role_id,status:p.p_next.status,branch_ids:[...p.p_next.branch_ids].sort()};
   if(JSON.stringify(current)===JSON.stringify(next))return null;
   if(JSON.stringify(current)!==JSON.stringify(p.p_expected))fail('STAFF_ACCESS_CHANGED');
   Object.assign(m,{role_id:next.role_id,status:next.status,updated_at:new Date().toISOString()});
   for(let index=access.length-1;index>=0;index--)if(access[index].organization_membership_id===m.id)access.splice(index,1);
   access.push(...next.branch_ids.map(branch_id=>({organization_membership_id:m.id,branch_id})));events.push({event:'access',id:m.id,before:current,after:next});return null;
 }
 return [];
}
createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);if(req.method==='OPTIONS')return json(res,{});
 if(url.pathname==='/auth/v1/health')return json(res,{name:'fictional-local-fixture'});
 if(url.pathname==='/fixture/state')return json(res,{memberships,access,invitations,events,users:[...users.values()].map(u=>({id:u.id,email:u.email,display_name:u.display_name}))});
 if(url.pathname==='/fixture/drop-next'){dropNext=true;return json(res,{armed:true});}
 if(url.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");}
 let body='';for await(const chunk of req)body+=chunk;const p=body?JSON.parse(body):{};
 if(url.pathname==='/auth/v1/token'){const user=userFor(p.email);const token=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,email:user.email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');return json(res,{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture',user});}
 if(url.pathname==='/auth/v1/logout')return json(res,{});
 if(url.pathname==='/auth/v1/signup')return json(res,{user:userFor(p.email),session:null});
 let user=null;try{const claims=JSON.parse(Buffer.from(req.headers.authorization?.split('.')[1]??'','base64url'));user=[...users.values()].find(u=>u.id===claims.sub);}catch{}
 if(url.pathname==='/auth/v1/user')return json(res,user);
 if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.split('/').at(-1),result=rpc(name,p,user);if(dropNext&&['maintain_staff_access','invite_staff','accept_staff_invitation'].includes(name)){dropNext=false;return res.destroy();}return json(res,result);}
 if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.split('/').at(-1),m=memberFor(user);
   let rows=({organizations:m?[{id:org,name:'Fictional Staff Pharmacy',status:'active',currency_code:'CAD',timezone:'America/Toronto',default_locale:'en'}]:[],branches:branches.filter(b=>m&&(can(user,'branch.manage')||can(user,'staff.manage')||access.some(a=>a.organization_membership_id===m.id&&a.branch_id===b.id))),organization_memberships:m?memberships:[],branch_memberships:access,roles,role_permissions:roles.flatMap(r=>(rolePermissions[r.id]??[]).map(permission_code=>({role_id:r.id,permission_code}))),profiles:[...users.values()].map(u=>({user_id:u.id,display_name:u.display_name??(u===owner?'Fictional Owner':u.email)})),staff_invitations:can(user,'staff.manage')?invitations:[]})[table]??[];
   for(const[key,value]of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));if(value.startsWith('in.('))rows=rows.filter(r=>value.slice(4,-1).split(',').includes(String(r[key])));}
   return json(res,req.headers.accept?.includes('vnd.pgrst.object')?rows[0]??null:rows);
 }
 const path=decodeURIComponent(url.pathname),file=resolve(root,`.${path==='/'?'/index.html':path}`);if(!file.startsWith(root+sep))return json(res,{},404);
 let content,filename=file;try{content=await readFile(filename);}catch{filename=extname(file)?resolve(root,'index.html'):`${file}.html`;content=await readFile(filename);}
 res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.wasm':'application/wasm'})[extname(filename)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Embedder-Policy':'credentialless','Cross-Origin-Opener-Policy':'same-origin'});res.end(content);
}catch(cause){json(res,{message:cause.message},400);}}).listen(port,'127.0.0.1',()=>console.log(`Fictional staff fixture http://127.0.0.1:${port}`));
