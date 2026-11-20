// Local UI smoke fixture, not a Supabase server. Never use with real accounts.
// Build with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 and a dummy public
// key, then run this file. All records are fictional and reset on restart.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const now = new Date().toISOString();
const users = new Map(); const organizations = []; const branches = []; const memberships = []; const invitations = [];
const roles = [{ id: 'owner-role', code: 'OWNER', name_en: 'Owner', name_fr: 'Propriétaire' }, { id: 'cashier-role', code: 'CASHIER', name_en: 'Cashier', name_fr: 'Caissier' }];
const permissions = ['organization.manage','branch.manage','staff.manage','inventory.read','inventory.product.create','purchase.read','purchase.create','purchase.receive','reports.read'];
function userFor(email) { if (!users.has(email)) users.set(email, { id: randomUUID(), email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: now, confirmed_at: now, created_at: now, app_metadata: {}, user_metadata: {} }); return users.get(email); }
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(JSON.stringify(value)); };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:54329');
    if (req.method === 'OPTIONS') return json(res, {});
    if (url.pathname === '/auth/v1/health') return json(res, { name: 'local-fictional-fixture' });
    // The real API is cross-origin. Do not let the PWA shell cache this
    // same-origin fictional API during browser tests.
    if (url.pathname === '/sw.js') { res.writeHead(200, { 'Content-Type':'text/javascript', 'Cache-Control':'no-store' }); return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));"); }
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    if (url.pathname === '/auth/v1/token') {
      const user = userFor(payload.email);
      const token = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'local-fixture'].join('.');
      return json(res, { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'local-fixture', user });
    }
    if (url.pathname === '/auth/v1/logout') return json(res, {});
    if (url.pathname === '/auth/v1/signup') return json(res, { user: userFor(payload.email), session: null });
    let user = null;
    try { const claims = JSON.parse(Buffer.from(req.headers.authorization?.split('.')[1] ?? '', 'base64url').toString()); user = [...users.values()].find((candidate) => candidate.id === claims.sub); } catch { /* unsigned fixture token only */ }
    if (url.pathname === '/auth/v1/user') return json(res, user);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const rpc = url.pathname.split('/').at(-1);
      if (rpc === 'my_membership_unavailable') return json(res, false);
      if (rpc === 'complete_owner_setup') {
        let org = organizations[0];
        if (!org) { org = { id: randomUUID(), name: payload.p_name, status: 'active', country_code: payload.p_country_code, currency_code: payload.p_currency_code, timezone: payload.p_timezone, default_locale: payload.p_locale }; organizations.push(org); branches.push({ id: randomUUID(), organization_id: org.id, name: payload.p_branch_name, code: 'MAIN', status: 'active' }); memberships.push({ id: randomUUID(), organization_id: org.id, user_id: user.id, role_id: 'owner-role', status: 'active' }); }
        return json(res, { organization_id: org.id, branch_id: branches[0].id });
      }
      if (rpc === 'create_branch_with_access') { if (!branches.some((item) => item.id === payload.p_branch_id)) branches.push({ id: payload.p_branch_id, organization_id: payload.p_organization_id, name: payload.p_name, code: payload.p_code, status: 'active' }); return json(res, payload.p_branch_id); }
      if (rpc === 'owner_setup_progress') return json(res, { pharmacy: true, branch: true, staff: invitations.length > 0, supplier: false, product: false, purchase: false });
      if (rpc === 'invite_staff') { const item = { id: randomUUID(), organization_id: payload.p_organization_id, branch_id: payload.p_branch_id, role_id: payload.p_role_id, display_name: payload.p_display_name, email: payload.p_email, status: 'pending', expires_at: new Date(Date.now()+604800000).toISOString(), created_at: now }; invitations.push(item); return json(res, item.id); }
      if (rpc === 'my_staff_invitations') return json(res, invitations.filter((item) => item.email === user?.email && item.status === 'pending').map((item) => ({ ...item, organization_name: organizations[0].name, branch_name: branches.find((b) => b.id === item.branch_id).name, role_name_en: 'Cashier', role_name_fr: 'Caissier' })));
      if (rpc === 'accept_staff_invitation') { const item = invitations.find((candidate) => candidate.id === payload.p_invitation_id); item.status = 'accepted'; memberships.push({ id: randomUUID(), organization_id: item.organization_id, user_id: user.id, role_id: item.role_id, status: 'active' }); return json(res, item.organization_id); }
      if (rpc === 'cancel_staff_invitation') { invitations.find((item) => item.id === payload.p_invitation_id).status = 'cancelled'; return json(res, null); }
      return json(res, []);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1);
      let rows = ({ organizations, branches, organization_memberships: memberships, roles, role_permissions: permissions.map((permission_code) => ({ permission_code, role_id: 'owner-role' })), profiles: [...users.values()].map((item) => ({ user_id: item.id, display_name: item.email })), staff_invitations: invitations, branch_memberships: memberships.map((item) => ({ organization_membership_id: item.id, branch_id: branches[0]?.id })) })[table] ?? [];
      for (const [key, value] of url.searchParams) { if (value.startsWith('eq.')) rows = rows.filter((row) => String(row[key]) === value.slice(3)); if (value.startsWith('in.(')) rows = rows.filter((row) => value.slice(4,-1).split(',').includes(String(row[key]))); }
      return json(res, req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows);
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return json(res, {}, 404);
    let contents; let filename = file;
    try { contents = await readFile(filename); } catch { filename = extname(file) ? resolve(root, 'index.html') : `${file}.html`; contents = await readFile(filename); }
    const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.wasm':'application/wasm', '.json':'application/json' }[extname(filename)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cross-Origin-Embedder-Policy':'credentialless', 'Cross-Origin-Opener-Policy':'same-origin' }); res.end(contents);
  } catch (cause) { console.error('Local fixture request failed:', cause.message); json(res, { message: 'LOCAL_FIXTURE_ERROR' }, 500); }
}).listen(54329, '127.0.0.1', () => console.log('Fictional UI fixture: http://127.0.0.1:54329 (not production)'));
