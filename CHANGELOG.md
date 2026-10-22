# Changelog

All notable changes to FileBridge are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [0.1.0] — 2026-10-22

First public release.

### Added
- **QR pairing** — the host shows a QR code, the phone scans it and joins in one step (8-character code as a fallback). Pairing codes expire after 10 minutes and are single-use.
- **Two-way transfer** — files, photos, PDFs, text and clipboard, in both directions, over WebSocket.
- **Chunked uploads with resume** — 4 MB chunks, up to 2 GB per file; an interrupted upload continues from the last acknowledged offset.
- **Live progress** — per-file progress bars for uploads and downloads (percent + bytes transferred).
- **Previews** — images, video, audio and PDF preview inline at original quality; other types are served as safe downloads with magic-byte type detection.
- **Clipboard & quick text** — send/paste clipboard content, small text history with copy / reuse / delete.
- **Session management** — device rename, guest revocation, leave-session, retention policy (1 h / 24 h / 7 d / never), end-session wipes every received file immediately.
- **Connection status** — 🟢 connected / 🟡 reconnecting / 🔴 offline with automatic reconnection and list resync.
- **Standalone Windows build** — `FileBridge.exe` with the Node runtime inside, an icon, and a portable data folder next to it.
- **Graceful close** — `Settings → Close FileBridge` wipes the session and shuts the app down cleanly.
- **Dark & light themes**, mobile-first layout, toasts, and a Persian README.

### Security
- HttpOnly `fb_tok` cookie, SHA-256 hashed at rest; sessions isolated from each other.
- Uploaded files are never executed: real type detected by magic bytes, served with `Content-Security-Policy: default-src 'none'; sandbox allow-downloads` and `X-Content-Type-Options: nosniff`.
- Filename sanitisation, UUID on-disk paths, rate limiting, size/length caps, device cap per session.
- No tokens or secrets are ever written to the logs.

### Known limitations
- On plain `http://` LAN addresses browsers restrict some APIs: clipboard *read*, notifications, PWA install and Web Crypto. The UI provides honest fallbacks for each.
- Some Chrome builds warn about downloads coming from a plain-HTTP page — keep the file via the download item's overflow menu.
- HEIC/HEIF photos transfer fine but have no thumbnail.
