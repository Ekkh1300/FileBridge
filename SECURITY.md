# Security Policy

FileBridge transfers data over your **own local network** — it is designed so that nothing ever reaches the internet. That also means the threat model is *your own network*, not the public internet.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |

## What the app already does

- **Device token** in an `HttpOnly` cookie (`fb_tok`); only its SHA-256 hash is stored in the database. Page JavaScript cannot read it.
- **Session isolation** — a device can only read files/messages of the session it belongs to (cross-session access returns `404`).
- **Files are never executed** — the real type is detected from the file's magic bytes; only inert types (image, PDF, video, audio, plain text) are served inline, everything else is a download with `Content-Disposition: attachment`.
- **Hardened response headers** — `Content-Security-Policy: default-src 'none'; sandbox allow-downloads`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **Path safety** — filenames are sanitised, stored paths are UUIDs, chunk writes are restricted to the upload owner, path traversal is rejected (covered by the smoke tests).
- **Limits** — rate limiting per API, 2 GB per file, 100 000 characters per text message, 8 devices per session, 10-minute single-use pairing codes.
- **No secrets in logs** — tokens are never printed; the `/files/` log lines contain only method, path, status and size.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Open a private advisory instead: **Security → Report a vulnerability** on this repository, or email the maintainer via the profile page. Include:

- what you found and how to reproduce it,
- the impact you believe it has,
- the version/commit and your environment (OS, browser, Node version).

You can expect an acknowledgement within a few days. Fixes for confirmed issues are released as a new patch version, and the advisory is published after the fix is out.

## Hardening your own setup

1. Run FileBridge only on a network you trust (home Wi-Fi, not a café hotspot).
2. Allow the Windows firewall prompt on **Private networks** only.
3. If you need access from outside your LAN, put it behind a VPN (e.g. Tailscale) or an HTTPS reverse proxy with a self-signed certificate — never expose the plain-HTTP port directly to the internet.
4. Use the retention setting that suits you (`1h` / `24h` / `7d` / never) and press **End session for everyone** when you're done — that wipes received files immediately.
