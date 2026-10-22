/**
 * Prints exactly how to expose FileBridge over HTTPS with Tailscale Serve
 * (private network, real certificate) and how to point the pairing QR at it.
 *
 *   npm run tailscale
 */
import { execFileSync } from 'node:child_process';

const isWin = process.platform === 'win32';

function have(cmd) {
  try {
    execFileSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tailscale(args) {
  try {
    return execFileSync('tailscale', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const line = '─'.repeat(64);

console.log(`\n${line}\n  FileBridge over HTTPS with Tailscale\n${line}\n`);

if (!have('tailscale')) {
  console.log('Tailscale CLI not found on this machine.');
  console.log('  1) install it:  https://tailscale.com/download/windows');
  console.log('  2) sign in with the same account you use on your phone');
  console.log('  3) re-run:  npm run tailscale\n');
} else {
  let dns = null;
  const status = tailscale(['status', '--json']);
  if (status) {
    try {
      const j = JSON.parse(status);
      dns = j?.Self?.DNSName?.replace(/\.$/, '') || null;
    } catch { /* not json */ }
  }
  console.log('Tailscale CLI: found ✓');
  if (dns) console.log(`This machine:  https://${dns}`);
  else console.log('This machine:  (not logged in — run: tailscale up)');

  console.log(`
1) Expose the local server over HTTPS (only devices in your tailnet can reach it):

     tailscale serve --bg http://127.0.0.1:3000

2) Start FileBridge so the QR code points to that https address:

     set PUBLIC_URL=https://${dns || 'your-machine.your-tailnet.ts.net'}
     FileBridge.exe

   (PowerShell:  $env:PUBLIC_URL="https://${dns || 'your-machine.your-tailnet.ts.net'}"; .\\FileBridge.exe)

3) On the phone: install Tailscale, join the same tailnet, then open

     https://${dns || 'your-machine.your-tailnet.ts.net'}

   Chrome will now offer "Add to Home screen" — a real installable PWA
   (secure context: clipboard read, notifications, offline shell all work).
`);
}

console.log(`Notes
- Tailscale Serve gives you a real certificate; no port forwarding, no router setup.
- The bridge stays private: only devices in your tailnet can reach it.
- PUBLIC_URL is optional — without it the QR keeps pointing at the plain LAN address.
- Stop serving again with:  tailscale serve reset
`);
