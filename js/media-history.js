const DATABASE_NAME = "myai-media-history";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("Penyimpanan file lokal tidak tersedia di browser ini."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Database media lokal gagal dibuka."));
    request.onblocked = () => reject(new Error("Database media MyAI sedang dipakai tab lain. Tutup tab MyAI lain lalu coba lagi."));
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Operasi penyimpanan media gagal."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error("Penyimpanan media dibatalkan."));
    });
  } finally {
    database.close();
  }
}

export async function saveMediaAsset(blob, metadata = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new TypeError("File media kosong atau tidak valid.");
  const id = metadata.id || crypto.randomUUID();
  const record = {
    id,
    blob,
    name: String(metadata.name || "myai-file"),
    mimeType: String(metadata.mimeType || blob.type || "application/octet-stream"),
    size: blob.size,
    createdAt: Number.isFinite(metadata.createdAt) ? metadata.createdAt : Date.now(),
  };
  await withStore("readwrite", (store) => store.put(record));
  return { id: record.id, name: record.name, mimeType: record.mimeType, size: record.size, createdAt: record.createdAt };
}

export function getMediaAsset(id) {
  if (!id) return Promise.resolve(null);
  return withStore("readonly", (store) => store.get(id));
}

export async function deleteMediaAssets(ids) {
  const uniqueIds = [...new Set((ids || []).filter((id) => typeof id === "string" && id))];
  if (!uniqueIds.length) return;
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      uniqueIds.forEach((id) => store.delete(id));
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("File media lokal gagal dihapus."));
    });
  } finally {
    database.close();
  }
}
