// Persistent storage. On iOS: real files (Capacitor Filesystem).
//  - Documents/Notebooks/*.ipynb  → visible in the Files app ("On My iPhone › Querly")
//  - Documents/Data/*             → imported data files (CSV, Parquet, JSON, Excel…), also visible in Files
//  - Library/querly/              → database snapshots and preferences (not shown to the user)
// In a desktop browser (development): IndexedDB.
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const native = Capacitor.isNativePlatform();

// ---------- IndexedDB fallback ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('querly-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('files', mode).objectStore('files'));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(b);
  });
}
function base64ToBlob(b64: string, type = 'application/octet-stream'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

type Area = 'docs' | 'lib';
const dir = (a: Area) => (a === 'docs' ? Directory.Documents : Directory.Library);
const prefix = (a: Area) => (a === 'docs' ? '' : 'querly/');

export async function writeText(area: Area, path: string, text: string): Promise<void> {
  if (!native) return void (await idbOp('readwrite', (s) => s.put(text, `${area}:${path}`)));
  await Filesystem.writeFile({ directory: dir(area), path: prefix(area) + path, data: text, encoding: Encoding.UTF8, recursive: true });
}

export async function readText(area: Area, path: string): Promise<string | null> {
  if (!native) return (await idbOp<string | undefined>('readonly', (s) => s.get(`${area}:${path}`))) ?? null;
  try {
    const r = await Filesystem.readFile({ directory: dir(area), path: prefix(area) + path, encoding: Encoding.UTF8 });
    return typeof r.data === 'string' ? r.data : await (r.data as Blob).text();
  } catch {
    return null;
  }
}

export async function writeBlob(area: Area, path: string, blob: Blob): Promise<void> {
  if (!native) { const buf = await blob.arrayBuffer(); return void (await idbOp('readwrite', (s) => s.put(buf, `${area}:${path}`))); }
  const tmp = prefix(area) + path + '.tmp';
  await Filesystem.writeFile({ directory: dir(area), path: tmp, data: await blobToBase64(blob), recursive: true });
  await Filesystem.rename({ directory: dir(area), from: tmp, to: prefix(area) + path, toDirectory: dir(area) });
}

export async function readBlob(area: Area, path: string): Promise<Blob | null> {
  if (!native) { const v = await idbOp<Blob | ArrayBuffer | undefined>('readonly', (s) => s.get(`${area}:${path}`)); return v === undefined ? null : v instanceof ArrayBuffer ? new Blob([v]) : v; }
  try {
    const r = await Filesystem.readFile({ directory: dir(area), path: prefix(area) + path });
    return typeof r.data === 'string' ? base64ToBlob(r.data) : (r.data as Blob);
  } catch {
    return null;
  }
}

export async function remove(area: Area, path: string): Promise<void> {
  if (!native) return void (await idbOp('readwrite', (s) => s.delete(`${area}:${path}`)));
  await Filesystem.deleteFile({ directory: dir(area), path: prefix(area) + path }).catch(() => {});
}

export async function list(area: Area, folder: string): Promise<string[]> {
  if (!native) {
    const keys = await idbOp<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const p = `${area}:${folder}/`;
    return keys.map(String).filter((k) => k.startsWith(p) && !k.slice(p.length).includes('/')).map((k) => k.slice(p.length));
  }
  try {
    const r = await Filesystem.readdir({ directory: dir(area), path: prefix(area) + folder });
    return r.files.filter((f) => f.type === 'file').map((f) => f.name);
  } catch {
    return [];
  }
}

export { blobToBase64 };

/** Size and modification time of a file, or null when it does not exist. */
export async function stat(area: Area, path: string): Promise<{ size: number; mtime: number } | null> {
  if (!native) {
    const b = await idbOp<Blob | ArrayBuffer | string | undefined>('readonly', (s) => s.get(`${area}:${path}`));
    if (b === undefined) return null;
    return { size: typeof b === 'string' ? b.length : b instanceof ArrayBuffer ? b.byteLength : b.size, mtime: Date.now() };
  }
  try {
    const r = await Filesystem.stat({ directory: dir(area), path: prefix(area) + path });
    return { size: r.size, mtime: r.mtime };
  } catch {
    return null;
  }
}

/**
 * Write a large file in base64 chunks (the bridge copies strings, so one huge write would need several times the file
 * size in memory). Writes to a temporary name first so a failed import never leaves half a file behind.
 */
export async function writeLarge(area: Area, path: string, data: Blob, onProgress?: (done: number) => void): Promise<void> {
  if (!native) { const buf = await data.arrayBuffer(); onProgress?.(data.size); return void (await idbOp('readwrite', (s) => s.put(buf, `${area}:${path}`))); }
  const CHUNK = 3 * 1024 * 1024; // multiple of 3 → base64 chunks concatenate cleanly
  const tmp = prefix(area) + path + '.part';
  for (let off = 0; off < data.size || off === 0; off += CHUNK) {
    const b64 = await blobToBase64(data.slice(off, off + CHUNK));
    if (off === 0) await Filesystem.writeFile({ directory: dir(area), path: tmp, data: b64, recursive: true });
    else await Filesystem.appendFile({ directory: dir(area), path: tmp, data: b64 });
    onProgress?.(Math.min(data.size, off + CHUNK));
    if (data.size === 0) break;
  }
  await Filesystem.deleteFile({ directory: dir(area), path: prefix(area) + path }).catch(() => {});
  await Filesystem.rename({ directory: dir(area), from: tmp, to: prefix(area) + path, toDirectory: dir(area) });
}

/** Read a (possibly large) file as bytes. Native: through the web view's file URL, which avoids base64 entirely. */
export async function readBytes(area: Area, path: string): Promise<Uint8Array | null> {
  if (!native) {
    const b = await idbOp<Blob | ArrayBuffer | string | undefined>('readonly', (s) => s.get(`${area}:${path}`));
    if (b === undefined) return null;
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    return new Uint8Array(await (typeof b === 'string' ? new Blob([b]) : b).arrayBuffer());
  }
  try {
    const { uri } = await Filesystem.getUri({ directory: dir(area), path: prefix(area) + path });
    const r = await fetch(Capacitor.convertFileSrc(uri));
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  } catch { /* fall back to the bridge */ }
  const b = await readBlob(area, path);
  return b ? new Uint8Array(await b.arrayBuffer()) : null;
}

export async function fileUri(area: Area, path: string): Promise<string | null> {
  if (!native) return null;
  try { return (await Filesystem.getUri({ directory: dir(area), path: prefix(area) + path })).uri; } catch { return null; }
}
