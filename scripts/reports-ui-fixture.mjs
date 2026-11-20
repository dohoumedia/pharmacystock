// Fictional loopback auth and a read-only API backed by the disposable report-test PostgreSQL.
// Start after test-reports-functional.ps1 -KeepFixture. No hosted/production endpoints.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.expo/reports-web'), port = 54374;
const container = readFileSync('.expo/reports-db-container.txt', 'utf8').trim();
if (!/^pharmacystock-reports-[a-f0-9]{10}$/.test(container)) throw new Error('Invalid disposable fixture container');
const uid = '66000000-0000-0000-0000-000000000001', org = '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const now = new Date().toISOString();
const user = { id: uid, email: 'reports@example.test', aud: 'authenticated', role: 'authenticated', email_confirmed_at: now, created_at: now, app_metadata: {}, user_metadata: {} };
const quote = value => value === null || value === undefined ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
function sql(statement) {
  const source = `begin;set local role authenticated;set local request.jwt.claim.sub=${quote(uid)};${statement};rollback;`;
  const result = execFileSync('docker', ['exec', '-i', container, 'psql', '-qAtX', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: source, encoding: 'utf8', windowsHide: true });
  return JSON.parse(result.trim());
}
function rpc(name, p) {
  if (name === 'my_membership_unavailable') return false;
  if (name === 'my_staff_invitations') return [];
  if (name === 'owner_setup_progress') return { pharmacy: true, branch: true, staff: true, supplier: true, product: true, purchase: true };
  if (name === 'read_stock_transfer_context') return sql(`select public.read_stock_transfer_context(${quote(p.p_transfer_id)})`);
  if (name === 'read_operational_report') {
    const args = ['p_organization_id','p_branch_id','p_report','p_start','p_end','p_search','p_state','p_supplier','p_days','p_page','p_product_id'];
    return sql(`select public.read_operational_report(${args.map(key => quote(p[key])).join(',')})`);
  }
  return [];
}
const tables = new Set(['organizations','branches','organization_memberships','branch_memberships','roles','role_permissions','profiles','organization_settings','expiry_policies','products','product_barcodes','batches','inventory_balances','inventory_movements','sales','sale_items','payments','sale_refunds','sale_refund_items','suppliers','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','inventory_stock_counts','inventory_stock_count_lines','stock_transfers','stock_transfer_lines','report_daily_sales']);
function records(table, params, single) {
  if (!tables.has(table)) return single ? null : [];
  const where = [];
  for (const [key,value] of params) {
    if (!/^[a-z_]+$/.test(key)) continue;
    if (value.startsWith('eq.')) where.push(`"${key}"=${quote(value.slice(3))}`);
    if (value.startsWith('in.(') && value.endsWith(')')) where.push(`"${key}" in (${value.slice(4,-1).split(',').map(quote).join(',')})`);
    if (value.startsWith('gte.')) where.push(`"${key}">=${quote(value.slice(4))}`);
    if (value.startsWith('lt.')) where.push(`"${key}"<${quote(value.slice(3))}`);
    if (value.startsWith('ilike.')) where.push(`"${key}" ilike ${quote(value.slice(6))}`);
  }
  const order = (params.get('order') || '').split(',').filter(s => /^[a-z_]+\.(asc|desc)(\.(nullsfirst|nullslast))?$/.test(s)).map(s => s.replaceAll('.', ' ')).join(',');
  const limit = Math.max(0, Math.min(Number(params.get('limit') || 1000), 1000));
  const offset = Math.max(0, Math.min(Number(params.get('offset') || 0), 100000));
  const rows = sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select * from public."${table}" ${where.length ? 'where '+where.join(' and ') : ''} ${order ? 'order by '+order : ''} limit ${limit} offset ${offset}) t`);
  return single ? rows[0] || null : rows;
}
function json(res,value,status=200) { res.writeHead(status, { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*','Cache-Control':'no-store' }); res.end(JSON.stringify(value)); }
let offline = false;
createServer(async(req,res) => { try {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'OPTIONS') return json(res, {});
  if (url.pathname === '/fixture/control') { offline = url.searchParams.get('offline') === '1'; return json(res, { offline }); }
  if (url.pathname === '/fixture/reconcile') return json(res, sql(`select jsonb_build_object('sales',(select coalesce(sum(total_amount),0) from public.sales where organization_id=${quote(org)} and completed_at>='2026-11-18T05:00Z' and completed_at<'2026-11-19T05:00Z'),'refunds',(select coalesce(sum(amount),0) from public.sale_refunds where organization_id=${quote(org)} and created_at>='2026-11-18T05:00Z' and created_at<'2026-11-19T05:00Z'),'payments',(select coalesce(sum(amount),0) from public.payments where organization_id=${quote(org)} and created_at>='2026-11-18T05:00Z' and created_at<'2026-11-19T05:00Z'))`));
  if (offline && (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/'))) return json(res,{message:'Offline fixture'},503);
  if (url.pathname === '/auth/v1/health') return json(res, {});
  let body=''; for await (const chunk of req) body+=chunk; const p=body?JSON.parse(body):{};
  if (url.pathname === '/auth/v1/token') { const token=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,email:user.email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.'); return json(res,{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture',user}); }
  if (url.pathname === '/auth/v1/user') return json(res,user);
  if (url.pathname === '/auth/v1/logout') return json(res,{});
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(res,rpc(url.pathname.split('/').at(-1),p));
  if (url.pathname.startsWith('/rest/v1/')) return json(res,records(url.pathname.split('/').at(-1),url.searchParams,req.headers.accept?.includes('vnd.pgrst.object')));
  if (url.pathname === '/sw.js') { res.writeHead(200,{'Content-Type':'text/javascript'}); return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"); }
  const relative = decodeURIComponent(url.pathname)==='/'?'/index.html':decodeURIComponent(url.pathname);
  let filename=resolve(root,`.${relative}`); if (!filename.startsWith(root+sep)) return json(res,{},404);
  let content; try {content=await readFile(filename);} catch {filename=extname(filename)?resolve(root,'index.html'):`${filename}.html`; content=await readFile(filename);}
  res.writeHead(200,{'Content-Type':({'js':'application/javascript','css':'text/css','html':'text/html','json':'application/json','png':'image/png','svg':'image/svg+xml','ico':'image/x-icon'})[extname(filename).slice(1)] || 'application/octet-stream'});res.end(content);
} catch(error) { console.error(error.message); json(res,{message:error.message,code:'FIXTURE_READ_FAILED'},400); } }).listen(port,'127.0.0.1',()=>console.log(`Reports fixture: http://127.0.0.1:${port} -> ${container}`));
