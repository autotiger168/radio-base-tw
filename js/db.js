// =============================================================
//  瀏覽器內的資料庫（IndexedDB）
//  錄音、收聽日誌、QSL 卡都存在「這台裝置、這個瀏覽器」裡，
//  換手機或清除網站資料就會消失 → 請定期用「匯出備份」。
// =============================================================
const DB_NAME = "radio-base-tw";
const DB_VERSION = 2;
const STORES = ["recordings", "logs", "qsl"];

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

// 記憶體備援（私密瀏覽或資料庫被封鎖時，至少這次開著的時候能用）
const memory = Object.fromEntries(STORES.map(s => [s, new Map()]));

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  }));
}

export const db = {
  async put(store, item) {
    memory[store].set(item.id, item);
    try { await run(store, "readwrite", s => s.put(item)); } catch (e) { console.warn("僅暫存於記憶體", e); }
    return item;
  },
  async all(store) {
    try { (await run(store, "readonly", s => s.getAll()) || []).forEach(i => memory[store].set(i.id, i)); } catch {}
    return [...memory[store].values()];
  },
  async get(store, id) {
    if (memory[store].has(id)) return memory[store].get(id);
    try { return await run(store, "readonly", s => s.get(id)); } catch { return null; }
  },
  async remove(store, id) {
    memory[store].delete(id);
    try { await run(store, "readwrite", s => s.delete(id)); } catch {}
  },
  async clear(store) {
    memory[store].clear();
    try { await run(store, "readwrite", s => s.clear()); } catch {}
  },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 下載檔案給使用者
export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const blobToDataURL = blob => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
});
export const dataURLToBlob = async url => (await fetch(url)).blob();
