export const MAX_CORPUS_IMAGES = 100;

export type CorpusRecord = {
  id: string;
  name: string;
  createdAt: number;
  blob: Blob;
  embedding: number[];
};

const DB_NAME = "laion-corpus";
const STORE = "images";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadCorpus(): Promise<CorpusRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const rows = await new Promise<CorpusRecord[]>((resolve, reject) => {
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as CorpusRecord[]);
      request.onerror = () => reject(request.error);
    });
    await txDone(tx);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function saveCorpusImage(record: CorpusRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function clearCorpus(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}
