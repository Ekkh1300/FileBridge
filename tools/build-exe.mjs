/**
 * Builds the standalone Windows executable:
 *   1) esbuild bundles the ESM server into one CJS file  → build/app.cjs
 *   2) pkg wraps that file + a Node runtime + the client build
 *      into release/FileBridge.exe  (+ release/FileBridge.zip with a Persian quick-start)
 *   3) client/dist is embedded automatically via the "pkg.assets" field
 *
 *   node tools/build-exe.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const RELEASE_DIR = path.join(ROOT, 'release');
const APP_BUNDLE = path.join(BUILD_DIR, 'app.cjs');
const EXE = path.join(RELEASE_DIR, 'FileBridge.exe');

/** Invoke the JS entrypoints directly with `node` — no .cmd shims (spawn-safe). */
const ESBUILD_BIN = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const PKG_BIN = path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');

function run(cmd, args, opts = {}) {
  console.log(`\n> node ${path.relative(ROOT, cmd)} ${args.join(' ')}`);
  execFileSync('node', [cmd, ...args], { stdio: 'inherit', cwd: ROOT, ...opts });
}

function checkPreflight() {
  if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) {
    console.error('client build missing — run:  npm run build  (first)');
    process.exit(1);
  }
  const ico = path.join(BUILD_DIR, 'FileBridge.ico');
  if (!fs.existsSync(ico)) {
    console.error('icon missing — run:  node tools/make-ico.mjs');
    process.exit(1);
  }
}

function bundle() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.rmSync(APP_BUNDLE, { force: true });
  run(ESBUILD_BIN, [
    'server/src/index.js',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node24',
    `--outfile=${APP_BUNDLE}`,
    '--log-level=warning',
  ]);
  console.log(`bundle ready: ${(fs.statSync(APP_BUNDLE).size / 1024).toFixed(0)} KB`);
}

function packageExe() {
  fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const cfg = path.join(ROOT, 'package.json'); // provides the pkg.assets field
  const args = ['-c', cfg, APP_BUNDLE, '--target', 'node22-win-x64', '--output', EXE];

  let base = iconBaseBinary();
  if (base) {
    // PKG_NODE_PATH also makes pkg-fetch skip the base-binary hash check.
    run(PKG_BIN, args, { env: { ...process.env, PKG_NODE_PATH: base } });
  } else {
    // First build: let pkg fetch a base, then rebuild with the icon inside it.
    console.log('no pkg base yet — fetching one first');
    run(PKG_BIN, args);
    base = iconBaseBinary();
    if (!base) throw new Error('pkg base still missing after fetch');
    run(PKG_BIN, args, { env: { ...process.env, PKG_NODE_PATH: base } });
  }
  console.log(`exe ready: ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB → ${EXE}`);
}

/* ------------------------------- icon + base ------------------------------ */

const PKG_CACHE = process.env.PKG_CACHE_PATH
  || path.join(process.env.USERPROFILE || process.env.HOME || '', '.pkg-cache');

/**
 * pkg cannot add an icon, and the usual trick (BeginUpdateResource after the
 * build) destroys the payload pkg appends after the PE image. So the icon goes
 * into the base Node binary *before* pkg runs: tools/add-icon-section.mjs adds
 * a resource section, then pkg copies that binary and appends its payload as
 * usual.
 *
 * Returns the path to a Node binary that already carries our icon, or null when
 * no base has been fetched yet.
 */
function iconBaseBinary() {
  const ico = path.join(BUILD_DIR, 'FileBridge.ico');
  const bases = fs.existsSync(PKG_CACHE)
    ? fs.readdirSync(PKG_CACHE, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) => {
          const dir = path.join(PKG_CACHE, d.name);
          return fs.readdirSync(dir)
            .filter((f) => f.startsWith('fetched-v') && f.endsWith('-win-x64'))
            .map((f) => path.join(dir, f))
            .sort()
            .reverse();
        })
    : [];
  if (!bases.length) return null;

  const patched = path.join(BUILD_DIR, 'base-with-icon.exe');
  execFileSync('node', [path.join(__dirname, 'add-icon-section.mjs'), bases[0], patched, ico], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  console.log(`icon base ready: ${path.basename(bases[0])}`);
  return patched;
}

function zip() {
  // small "portable zip" with a Persian quick-start, via PowerShell Compress-Archive
  const quickStart = path.join(RELEASE_DIR, 'راهنمای باز شدن FileBridge.txt');
  fs.writeFileSync(quickStart, [
    'FileBridge — انتقال فایل بین موبایل و کامپیوتر روی وای‌فای',
    '==========================================================',
    '',
    '۱) روی FileBridge.exe دوبار کلیک کنید.',
    '   (اگر ویندوز پرسید یا SmartScreen هشدار داد: More info → Run anyway)',
    '',
    '۲) مرورگر خودش باز می‌شود؛ دکمه Start را بزنید.',
    '',
    '۳) با دوربین گوشی، QR را اسکن کنید — گوشی و کامپیوتر باید',
    '    به یک وای‌فای وصل باشند.',
    '',
    '۴) اولین بار فایروال ویندوز اجازه می‌خواهد: تیک Private networks',
    '   را بزنید و Allow.',
    '',
    'بستن برنامه: پنجره سیاه FileBridge را ببندید (همه فایل‌های جلسهٔ',
    'در حال اجرا پاک می‌شود).',
    '',
    'داده‌ها (فایل‌های دریافت‌شده و پایگاه داده) کنار همین exe، در پوشه',
    '"FileBridge Data" نگه‌داری می‌شوند.',
    '',
    'پورت پیش‌فرض 3000 است؛ برای تغییر، پیش از اجرا متغیر PORT بدهید:',
    '  set PORT=3100 && FileBridge.exe',
  ].join('\r\n'), 'utf8');
  const zipPath = path.join(RELEASE_DIR, 'FileBridge-Portable.zip');
  fs.rmSync(zipPath, { force: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Compress-Archive -Force -Path "${EXE}", "${quickStart}" -DestinationPath "${zipPath}"`,
  ], { stdio: 'inherit', cwd: RELEASE_DIR });
  console.log(`zip ready: ${zipPath}`);
}

checkPreflight();
bundle();
packageExe();
try { zip(); } catch (e) { console.warn('zip skipped:', e.message); }
console.log('\nDone.');
