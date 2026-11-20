// Explicit staging launcher. Never loads or changes the ordinary application env files.
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const stagingRef = 'mncvahzdnofyisflympy';
const productionRef = 'jeravdvssuzbthkxfvjy';
loadEnvFile(resolve(root, '.env.staging.local'));
const url = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
if (url.hostname === `${productionRef}.supabase.co` ||
    url.origin !== `https://${stagingRef}.supabase.co` || url.pathname !== '/' ||
    url.username || url.password || url.search || url.hash) {
  throw new Error('Staging acceptance requires the dedicated non-production Supabase project.');
}
if (!process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw new Error('Staging frontend requires a public publishable key.');
}
// Reject accidental secret configuration inherited from another terminal/session.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('EXPO_PUBLIC_') &&
      (/(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY)/i.test(name) || value?.startsWith('sb_secret_'))) {
    throw new Error(`Private credential cannot enter frontend configuration: ${name}`);
  }
}
process.env.EXPO_NO_DOTENV = '1';
console.log(`NON-PRODUCTION / STAGING: ${stagingRef}`);
const args = process.argv.length > 2 ? process.argv.slice(2) : ['--serve'];
if (args[0] === 'export' && !args.includes('--clear')) args.splice(1, 0, '--clear');
if (args.length === 1 && args[0] === '--check') process.exit(0);
if (args.length === 1 && args[0] === '--serve') {
  const { createServer } = await import('node:http');
  const { readFile, readdir, stat } = await import('node:fs/promises');
  const web = resolve(root, '.expo/staging-preparation/web');
  const bundles = resolve(web, '_expo/static/js/web');
  const entries = (await readdir(bundles)).filter(name => /^entry-.*\.js$/.test(name));
  if (entries.length !== 1) throw new Error('Create a fresh staging web export before serving.');
  const entry = await readFile(resolve(bundles, entries[0]), 'utf8');
  if (!entry.includes(url.origin) || !entry.includes(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
      entry.includes(productionRef) || /sb_secret_[A-Za-z0-9_-]{10,}/.test(entry)) {
    throw new Error('Staging build credentials do not match the verified public staging configuration.');
  }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
    '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
  const { extname, sep } = await import('node:path');
  createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost:8094').pathname);
      let file = resolve(web, `.${pathname}`);
      if (file !== web && !file.startsWith(web + sep)) throw new Error('Invalid path');
      if (file === web) file = resolve(web, 'index.html');
      else if (!(await stat(file).catch(() => null))?.isFile()) file += '.html';
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch { response.writeHead(404); response.end('Not found'); }
  }).listen(8094, '127.0.0.1', () => console.log('Staging app: http://localhost:8094'));
} else {
const expoArgs = args.length ? args : ['start', '--web', '--port', '8094'];
const child = spawn(process.execPath, [resolve(root, 'node_modules/expo/bin/cli'), ...expoArgs], {
  cwd: root, env: process.env, stdio: 'inherit', windowsHide: true,
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

}
