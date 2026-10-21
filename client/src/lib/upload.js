/**
 * Upload engine: queue with 2 concurrent transfers, 4 MiB chunks,
 * resume-after-failure via server-side received offsets, cancel via AbortController.
 * The engine owns nothing about storage — it patches the store through onPatch/onAdd/onToast.
 *
 * Store item shape (engine-managed items):
 * { id (local uid), serverId, kind, filename, mime, size, sent, received, status,
 *   sourceDeviceId: 'me', sourceName, previewUrl, createdAt, error }
 */
import { api, ApiError } from './api.js';
import { guessMime, kindOf } from './files.js';

const CHUNK = 4 * 1024 * 1024; // must stay <= server CHUNK_LIMIT (4 MiB)
const CONCURRENCY = 2;
const CHUNK_RETRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
const uid = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

class UploadQueue {
  constructor() {
    this.running = 0;
    this.onPatch = () => {};   // (id, patch)
    this.onAdd = () => {};     // (item)
    this.onRemove = () => {};  // (id)
    this.onToast = () => {};   // (text, tone)
  }

  add(files) {
    const list = Array.from(files || []);
    for (const file of list) {
      const image = /^(image\/(png|jpeg|jpg|gif|webp|bmp|avif)|$)/.test(file.type || '');
      const previewUrl = image || (file.type || '').startsWith('video/')
        ? URL.createObjectURL(file)
        : null;
      const item = {
        id: uid(),
        serverId: null,
        fileRef: file,
        kind: kindOf(file.type, file.name),
        filename: file.name || 'file',
        mime: file.type || guessMime(file.name || ''),
        size: file.size,
        sent: 0,
        received: 0,
        status: 'waiting',     // waiting|uploading|done|failed|canceled
        sourceIsMe: true,
        previewUrl,
        createdAt: Date.now(),
        error: null,
      };
      this.items.push(item);
      this.onAdd(item);
      this._schedule();
    }
  }

  retry(localId) {
    this._patch(localId, { status: 'waiting', error: null });
    this._schedule();
  }

  cancel(localId) {
    const item = this._find(localId);
    if (!item) return;
    if (item.ac) { try { item.ac.abort(); } catch { /* ignore */ } }
    item.status = 'canceled';
    this.items = this.items.filter((i) => i.id !== localId);
    this.onRemove(localId);
    if (item.serverId) {
      api.cancelTransfer(item.serverId).catch(() => { /* already gone */ });
    }
  }

  deleteListed(localId) {
    const item = this._find(localId);
    if (!item) return;
    if (item.serverId) {
      api.deleteTransfer(item.serverId).catch(() => {
        this.onRemove(localId);
      });
    } else {
      this.onRemove(localId);
    }
    if (item.previewUrl) { try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ } }
    this.items = this.items.filter((i) => i.id !== localId);
  }

  /** Called by the store right after the WS comes back online. */
  retryTransient() {
    for (const item of this.items) {
      if (item.status === 'failed' && item.error?.transient) {
        this.retry(item.id);
      }
    }
  }

  /* ------------------------------ internals ------------------------------ */

  items = [];

  _find(localId) {
    return this.items.find((i) => i.id === localId);
  }
  _patch(localId, patch) {
    for (const i of this.items) if (i.id === localId) Object.assign(i, patch);
    this.onPatch(localId, patch);
  }

  _schedule() {
    while (this.running < CONCURRENCY) {
      const next = this.items.find((i) => i.status === 'waiting');
      if (!next) return;
      this._run(next);
    }
  }

  async _run(item) {
    this.running += 1;
    this._patch(item.id, { status: 'uploading', sent: item.received });
    const ac = new AbortController();
    item.ac = ac;
    try {
      const init = await api.initUpload({
        clientKey: item.key || (item.key = `${Date.now().toString(36)}.${item.id}`),
        filename: item.filename,
        mime: item.mime,
        size: item.size,
      });
      this._patch(item.id, {
        serverId: init.transfer.id,
        kind: init.transfer.kind || item.kind,
        received: init.received || 0,
        sent: init.received || 0,
      });

      for (let offset = init.received || 0; offset < item.size; offset += CHUNK) {
        const end = Math.min(offset + CHUNK, item.size);
        const blob = item.fileRef.slice(offset, end);
        await this._chunk(item, offset, blob, ac.signal);
        this._patch(item.id, { sent: end, received: end });
      }
      await api.completeUpload(init.transfer.id);
      this._patch(item.id, { status: 'done', sent: item.size, received: item.size });
      this.onToast(`${item.filename} sent ✓`, 'ok');
    } catch (err) {
      if (ac.signal.aborted) {
        // user canceled silently
      } else {
        const transient = err instanceof TypeError || (err instanceof ApiError && err.network);
        this._patch(item.id, {
          status: 'failed',
          error: { transient, message: err?.message || 'Transfer failed' },
        });
      }
    } finally {
      item.ac = null;
      this.running -= 1;
      this._schedule();
    }
  }

  async _chunk(item, offset, blob, signal) {
    for (let tryNo = 0; tryNo <= CHUNK_RETRIES; tryNo++) {
      try {
        await api.chunk(item.serverId, offset, blob, signal);
        return;
      } catch (e) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (tryNo === CHUNK_RETRIES) throw e;
        await sleep(500 * (tryNo + 1));
      }
    }
  }
}

export const queue = new UploadQueue();
