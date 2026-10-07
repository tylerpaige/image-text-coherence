export type ScoreEmbeddingRecord = {
  name: string;
  size: number;
  embedding: number[];
};

// Separate from the corpus database so clearing one does not touch the other.
const DB_NAME = "image-text-coherence-score";
const STORE = "embeddings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: ["name", "size"] });
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

export async function loadScoreEmbedding(name: string, size: number): Promise<number[] | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await new Promise<ScoreEmbeddingRecord | undefined>((resolve, reject) => {
      const request = tx.objectStore(STORE).get([name, size]);
      request.onsuccess = () => resolve(request.result as ScoreEmbeddingRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    await txDone(tx);
    return row?.embedding ?? null;
  } finally {
    db.close();
  }
}

export async function saveScoreEmbedding(record: ScoreEmbeddingRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}
