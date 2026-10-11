import type { SampleRead, Study } from "./study";

export type LibMeta =
  | { id: string; kind: "preset"; name: string; author: string; added: number; study: Study }
  | { id: string; kind: "sample"; name: string; added: number; read: SampleRead };

type Row = LibMeta & { file?: ArrayBuffer };

const DB = "neuroman-lib";
const STORE = "sources";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function metaOf(row: Row): LibMeta {
  if (row.kind === "preset") {
    return { id: row.id, kind: "preset", name: row.name, author: row.author, added: row.added, study: row.study };
  }
  return { id: row.id, kind: "sample", name: row.name, added: row.added, read: row.read };
}

export async function listSources(): Promise<LibMeta[]> {
  const db = await openDb();
  const rows = await new Promise<Row[]>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Row[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.map(metaOf).sort((a, b) => b.added - a.added);
}

export async function saveSource(row: Row) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const rows = await new Promise<Row[]>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Row[]);
    req.onerror = () => reject(req.error);
  });
  const extras = rows.sort((a, b) => b.added - a.added).slice(16);
  if (extras.length) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const extra of extras) tx.objectStore(STORE).delete(extra.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  db.close();
}

export async function loadFile(id: string) {
  const db = await openDb();
  const row = await new Promise<Row | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as Row | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return row?.file ?? null;
}

export async function removeSource(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
