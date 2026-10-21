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
  try {
    run(PKG_BIN, ['-c', cfg, APP_BUNDLE, '--target', 'node24-win-x64', '--output', EXE]);
  } catch {
    console.warn('node24 base binary unavailable — falling back to node22');
    run(PKG_BIN, ['-c', cfg, APP_BUNDLE, '--target', 'node22-win-x64', '--output', EXE]);
  }
  console.log(`exe ready: ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB → ${EXE}`);
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
