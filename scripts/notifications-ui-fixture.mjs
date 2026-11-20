// Fictional loopback auth with actual operational notification SQL in disposable PostgreSQL.
// Start after test-notifications-functional.ps1 -KeepFixture. No hosted/production endpoints.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.expo/notifications-web'), port = 54377;
const container = readFileSync('.expo/notifications-db-container.txt', 'utf8').trim();
if (!/^pharmacystock-notifications-[a-f0-9]{10}$/.test(container)) throw new Error('Invalid disposable fixture container');
let uid = '66000000-0000-0000-0000-000000000001'; const org = '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const now = new Date().toISOString();
const user = { id: uid, email: 'settings@example.test', aud: 'authenticated', role: 'authenticated', email_confirmed_at: now, created_at: now, app_metadata: {}, user_metadata: {} };
const quote = value => value === null || value === undefined ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
function sql(statement, persist = false) {
  const source = `begin;set local role authenticated;set local request.jwt.claim.sub=${quote(uid)};${statement};${persist ? 'commit' : 'rollback'};`;
  const result = execFileSync('docker', ['exec', '-i', container, 'psql', '-qAtX', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: source, encoding: 'utf8', windowsHide: true });
  return JSON.parse(result.trim());
}
function rpc(name, p) {
  if (name === 'refresh_operational_notifications') { sql(`select public.refresh_operational_notifications(${quote(p.p_organization_id)}); select 'true'::jsonb`,true); return null; }
  if (name === 'my_membership_unavailable') return false;
  if (name === 'my_staff_invitations') return [];
  if (name === 'owner_setup_progress') return { pharmacy: true, branch: true, staff: true, supplier: true, product: true, purchase: true };
  if (name === 'search_catalog_products') return sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.search_catalog_products(${quote(p.p_organization_id)},${quote(p.p_search || '')},'active') t`);
  if (['search_catalog_batches','search_inventory_stock'].includes(name)) return sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${name}(${quote(p.p_organization_id)},${quote(p.p_branch_id)},${quote(p.p_search || '')}) t`);
  if (name === 'quote_sale') return sql(`select public.quote_sale(${quote(p.p_organization_id)},${quote(p.p_branch_id)},${quote(JSON.stringify(p.p_lines))}::jsonb)`);
  if (name === 'complete_sale_with_customer') return sql(`select to_jsonb(public.complete_sale_with_customer(${quote(p.p_organization_id)},${quote(p.p_branch_id)},${quote(p.p_sale_number)},${quote(JSON.stringify(p.p_lines))}::jsonb,${quote(JSON.stringify(p.p_payments))}::jsonb,${quote(p.p_idempotency_key)},${quote(p.p_notes)},${quote(p.p_customer_id)},${quote(JSON.stringify(p.p_expected_quote))}::jsonb,${quote(p.p_cash_tendered)}::numeric))`,true);
  if (name === 'refund_sale') return sql(`select to_jsonb(public.refund_sale(${quote(p.p_sale_id)},${quote(p.p_refund_number)},${quote(JSON.stringify(p.p_items))}::jsonb,${quote(p.p_idempotency_key)},${quote(p.p_reason)}))`,true);
  if (name === 'refresh_expiry_alerts') return sql(`select to_jsonb(public.refresh_expiry_alerts(${quote(p.p_organization_id)},${quote(p.p_branch_id)}))`,true);
  if (name === 'read_stock_transfer_context') return sql(`select public.read_stock_transfer_context(${quote(p.p_transfer_id)})`);
  if (name === 'read_operational_report') {
    const args = ['p_organization_id','p_branch_id','p_report','p_start','p_end','p_search','p_state','p_supplier','p_days','p_page','p_product_id'];
    return sql(`select public.read_operational_report(${args.map(key => quote(p[key])).join(',')})`);
  }
  return [];
}
const tables = new Set(['organizations','branches','organization_memberships','branch_memberships','roles','role_permissions','profiles','organization_settings','expiry_policies','products','product_barcodes','batches','inventory_balances','inventory_movements','sales','sale_items','payments','sale_refunds','sale_refund_items','suppliers','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','inventory_stock_counts','inventory_stock_count_lines','stock_transfers','stock_transfer_lines','report_daily_sales','expiry_risk','expiry_alerts','expiry_actions','customers','notifications','notification_preferences']);
function records(table, params, single) {
  if (!tables.has(table)) return single ? null : [];
  const where = [];
  for (const [key,value] of params) {
    if (!/^[a-z_]+$/.test(key)) continue;
    if (value === 'is.null') where.push(`"${key}" is null`);
    if (value.startsWith('eq.')) where.push(`"${key}"=${quote(value.slice(3))}`);
    if (value.startsWith('neq.')) where.push(`"${key}"<>${quote(value.slice(4))}`);
    if (value.startsWith('in.(') && value.endsWith(')')) where.push(`"${key}" in (${value.slice(4,-1).split(',').map(quote).join(',')})`);
    if (value.startsWith('gte.')) where.push(`"${key}">=${quote(value.slice(4))}`);
    if (value.startsWith('lte.')) where.push(`"${key}"<=${quote(value.slice(4))}`);
    if (value.startsWith('lt.')) where.push(`"${key}"<${quote(value.slice(3))}`);
    if (value.startsWith('ilike.')) where.push(`"${key}" ilike ${quote(value.slice(6))}`);
  }
  if(params.has('or')) {
    const raw=params.get('or').slice(1,-1), parts=[];
    const pattern=/([a-z_]+)\.(eq|ilike|match)\.("(?:[^"\\]|\\.)*"|[^,]+)(?:,|$)/g;
    let match;
    while((match=pattern.exec(raw))) {
      const value=match[3].startsWith('"')?JSON.parse(match[3]):match[3];
      parts.push(`"${match[1]}" ${match[2]==='eq'?'=':match[2]==='match'?'~':'ilike'} ${quote(value)}`);
    }
    if(!parts.length) throw new Error('Unsupported fixture OR filter');
    where.push(`(${parts.join(' or ')})`);
  }
  const order = (params.get('order') || '').split(',').filter(s => /^[a-z_]+\.(asc|desc)(\.(nullsfirst|nullslast))?$/.test(s)).map(s => s.replaceAll('.', ' ')).join(',');
  const limit = Math.max(0, Math.min(Number(params.get('limit') || 1000), 1000));
  const offset = Math.max(0, Math.min(Number(params.get('offset') || 0), 100000));
  const rows = sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select * from public."${table}" ${where.length ? 'where '+where.join(' and ') : ''} ${order ? 'order by '+order : ''} limit ${limit} offset ${offset}) t`);
  return single ? rows[0] || null : rows;
}

const writeColumns = {
  customers:['id','organization_id','full_name','phone','email','preferred_locale','notes','status'],
  organizations:['name','country_code','currency_code','timezone'],
  branches:['name','address_line1','address_line2','city','phone','email','timezone','status'],
  organization_settings:['organization_id','receipt_footer','default_payment_method','low_stock_default_threshold'],
  expiry_policies:['organization_id','thresholds_days'],
  notifications:['read_at'],
  notification_preferences:['organization_id','user_id','in_app','email','sms','whatsapp','push']
};
function saveRecord(table,params,body,method) {
  const allowed=writeColumns[table]; if (!allowed || !Object.keys(body).length || Object.keys(body).some(k=>!allowed.includes(k))) throw new Error('Unsupported fixture write');
  const value = (key,value) => Array.isArray(value) ? `array[${value.map(quote).join(',')}]::integer[]` : quote(value);
  const columns=Object.keys(body), where=[];
  for(const [k,v] of params) {
    if(!/^[a-z_]+$/.test(k)) continue;
    if(v.startsWith('eq.')) where.push(`"${k}"=${quote(v.slice(3))}`);
    if(v==='is.null') where.push(`"${k}" is null`);
  }
  if(method==='PATCH') {
    if(!where.length)throw new Error('Fixture update must be scoped');
    return sql(`with changed as (update public."${table}" set ${columns.map(k=>`"${k}"=${value(k,body[k])}`).join(',')} where ${where.join(' and ')} returning *) select coalesce(jsonb_agg(to_jsonb(changed)),'[]') from changed`,true);
  }
  if(table==='customers') return sql(`with changed as (insert into public.customers(${columns.map(k=>`"${k}"`).join(',')}) values(${columns.map(k=>value(k,body[k])).join(',')}) returning *) select to_jsonb(changed) from changed`,true);
  const conflict=table==='notification_preferences'?'organization_id,user_id':'organization_id';
  return sql(`with changed as (insert into public."${table}"(${columns.map(k=>`"${k}"`).join(',')}) values(${columns.map(k=>value(k,body[k])).join(',')}) on conflict(${conflict}) do update set ${columns.filter(k=>!conflict.split(',').includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(',')} returning *) select to_jsonb(changed) from changed`,true);
}

function json(res,value,status=200) { res.writeHead(status, { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*','Cache-Control':'no-store' }); res.end(JSON.stringify(value)); }
let offline = false, failSave = false, dropSave = false, delayReadMs = 0;
createServer(async(req,res) => { try {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'OPTIONS') return json(res, {});
  if (url.pathname === '/fixture/control') { offline = url.searchParams.get('offline') === '1'; failSave=url.searchParams.get('failSave')==='1'; dropSave=url.searchParams.get('dropSave')==='1'; delayReadMs=Math.max(0,Math.min(Number(url.searchParams.get('delayReadMs')||0),10000)); return json(res,{offline,failSave,dropSave}); }
  if (url.pathname === '/fixture/reconcile') return json(res, sql(`select jsonb_build_object('sales',(select coalesce(sum(total_amount),0) from public.sales where organization_id=${quote(org)} and completed_at>='2026-11-18T05:00Z' and completed_at<'2026-11-19T05:00Z'),'refunds',(select coalesce(sum(amount),0) from public.sale_refunds where organization_id=${quote(org)} and created_at>='2026-11-18T05:00Z' and created_at<'2026-11-19T05:00Z'),'payments',(select coalesce(sum(amount),0) from public.payments where organization_id=${quote(org)} and created_at>='2026-11-18T05:00Z' and created_at<'2026-11-19T05:00Z'))`));
  if (offline && (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/'))) return json(res,{message:'Offline fixture'},503);
  if (url.pathname === '/auth/v1/health') return json(res, {});
  let body=''; for await (const chunk of req) body+=chunk; const p=body?JSON.parse(body):{};
  if (url.pathname === '/auth/v1/token') { uid = p.email?.startsWith('staff') ? '66000000-0000-0000-0000-000000000002' : '66000000-0000-0000-0000-000000000001'; user.id=uid; user.email=p.email || user.email; const token=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,email:user.email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.'); return json(res,{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture',user}); }
  if (url.pathname === '/auth/v1/user') return json(res,user);
  if (url.pathname === '/auth/v1/logout') return json(res,{});
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(res,rpc(url.pathname.split('/').at(-1),p));
  if (url.pathname.startsWith('/rest/v1/') && ['PATCH','POST'].includes(req.method)) {
    if(failSave){failSave=false;return json(res,{message:'Local fixture: retry this save'},503);}
    const saved=saveRecord(url.pathname.split('/').at(-1),url.searchParams,p,req.method);
    if(url.pathname.endsWith('/notifications') && delayReadMs) await new Promise(resolve=>setTimeout(resolve,delayReadMs));
    if(dropSave){dropSave=false;return json(res,{message:'Local fixture: response lost after commit'},503);}
    return json(res,req.headers.accept?.includes('vnd.pgrst.object') && Array.isArray(saved) ? saved[0] ?? null : saved);
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const rows = records(url.pathname.split('/').at(-1),url.searchParams,req.headers.accept?.includes('vnd.pgrst.object'));
    if (req.method === 'HEAD') { res.writeHead(200,{'Content-Range':`0-0/${Array.isArray(rows)?rows.length:0}`,'Access-Control-Expose-Headers':'Content-Range'});return res.end(); }
    return json(res, rows);
  }
  if (url.pathname === '/sw.js') { res.writeHead(200,{'Content-Type':'text/javascript'}); return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"); }
  const relative = decodeURIComponent(url.pathname)==='/'?'/index.html':decodeURIComponent(url.pathname);
  let filename=resolve(root,`.${relative}`); if (!filename.startsWith(root+sep)) return json(res,{},404);
  let content; try {content=await readFile(filename);} catch {filename=extname(filename)?resolve(root,'index.html'):`${filename}.html`; content=await readFile(filename);}
  res.writeHead(200,{'Content-Type':({'js':'application/javascript','css':'text/css','html':'text/html','json':'application/json','png':'image/png','svg':'image/svg+xml','ico':'image/x-icon'})[extname(filename).slice(1)] || 'application/octet-stream'});res.end(content);
} catch(error) { console.error(error.message); json(res,{message:error.message,code:error.message.includes('duplicate key')?'23505':error.message.includes('SETTINGS_')?'22023':'FIXTURE_READ_FAILED'},400); } }).listen(port,'127.0.0.1',()=>console.log(`Notifications fixture: http://127.0.0.1:${port} -> ${container}`));
