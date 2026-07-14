import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_SPLIT_THRESHOLD } from "../app/types";

const DB_NAME = "voucher-receipt-app";
const DB_VERSION = 1;
const STORE = "kv";

const LS_KEYS = ["splitThreshold"] as const;

interface VoucherDB extends DBSchema {
  kv: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<VoucherDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<VoucherDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function getItem<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB();
  const value = await db.get(STORE, key);
  return value !== undefined ? (value as T) : fallback;
}

export async function setItem(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put(STORE, value, key);
}

function readLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function migrateFromLocalStorage(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);

  for (const key of LS_KEYS) {
    const existing = await store.get(key);
    if (existing !== undefined) continue;

    const fromLS = readLocalStorage(key);
    if (fromLS !== null) {
      await store.put(fromLS, key);
      localStorage.removeItem(key);
    }
  }

  await tx.done;
}

export async function initAppData(): Promise<{ splitThreshold: number }> {
  await migrateFromLocalStorage();

  const splitThreshold = await getItem<number>("splitThreshold", DEFAULT_SPLIT_THRESHOLD);

  return { splitThreshold };
}
