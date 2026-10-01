export const MAX_CORPUS_IMAGES = 100;

export type CorpusRecord = {
  id: string;
  name: string;
  createdAt: number;
  blob: Blob;
  embedding: number[];
};

const DB_NAME = "image-text-coherence-corpus";
const LEGACY_DB_NAME = "laion-corpus";
const STORE = "images";

let legacyMigrated: Promise<void> | null = null;

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
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

async function legacyDatabaseExists(): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") return false;
  const existing = await indexedDB.databases();
  return existing.some((db) => db.name === LEGACY_DB_NAME);
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function migrateLegacyCorpus(): Promise<void> {
  if (!(await legacyDatabaseExists())) return;

  const legacy = await openNamed(LEGACY_DB_NAME);
  try {
    if (legacy.objectStoreNames.contains(STORE)) {
      const tx = legacy.transaction(STORE, "readonly");
      const rows = await new Promise<CorpusRecord[]>((resolve, reject) => {
        const request = tx.objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result as CorpusRecord[]);
        request.onerror = () => reject(request.error);
      });
      await txDone(tx);
      if (rows.length > 0) {
        const db = await openNamed(DB_NAME);
        try {
          const write = db.transaction(STORE, "readwrite");
          for (const row of rows) write.objectStore(STORE).put(row);
          await txDone(write);
        } finally {
          db.close();
        }
      }
    }
  } finally {
    legacy.close();
  }

  await deleteDatabase(LEGACY_DB_NAME);
}

function ensureMigrated(): Promise<void> {
  if (!legacyMigrated) legacyMigrated = migrateLegacyCorpus();
  return legacyMigrated;
}

function openDb(): Promise<IDBDatabase> {
  return ensureMigrated().then(() => openNamed(DB_NAME));
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
