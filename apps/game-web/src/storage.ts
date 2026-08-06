import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { assertChronicleSaveV2 } from "@hnk/save-contract/v2";

const DB_NAME = "hnk-cronicas-obra-viva";
const DB_VERSION = 1;
const STORE = "chronicles";

export interface ChronicleBrowserSummary {
  readonly chronicleId: string;
  readonly day: number;
  readonly minuteOfDay: number;
  readonly currentLocation: string;
  readonly eventCount: number;
  readonly contentVersion: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveChronicleToBrowser(save: ChronicleSaveV2): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save Chronicle."));
      tx.oncomplete = () => resolve();
      tx.objectStore(STORE).put(structuredClone(save), save.chronicleId as string);
    });
  } finally {
    db.close();
  }
}

export async function loadChronicleFromBrowser(id: string): Promise<ChronicleSaveV2 | null> {
  const db = await openDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      tx.onerror = () => reject(tx.error ?? new Error("Failed to load Chronicle."));
      const request = tx.objectStore(STORE).get(id);
      request.onerror = () => reject(request.error ?? new Error("Failed to load Chronicle."));
      request.onsuccess = () => resolve(request.result);
    });
    if (value === undefined) return null;
    assertChronicleSaveV2(value);
    return value;
  } finally {
    db.close();
  }
}

export async function listChroniclesFromBrowser(): Promise<readonly ChronicleBrowserSummary[]> {
  const db = await openDb();
  try {
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      tx.onerror = () => reject(tx.error ?? new Error("Failed to list Chronicles."));
      const request = tx.objectStore(STORE).getAll();
      request.onerror = () => reject(request.error ?? new Error("Failed to list Chronicles."));
      request.onsuccess = () => resolve(request.result as unknown[]);
    });
    return values.map((value) => {
      assertChronicleSaveV2(value);
      const persona = value.personas[value.activePersonaId as string];
      return Object.freeze({
        chronicleId: value.chronicleId as string,
        day: value.world.timestamp.day,
        minuteOfDay: value.world.timestamp.minuteOfDay,
        currentLocation: persona?.currentLocation as string,
        eventCount: value.eventLedger.length,
        contentVersion: value.contentVersion,
      });
    });
  } finally {
    db.close();
  }
}

export async function deleteChronicleFromBrowser(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete Chronicle."));
      tx.oncomplete = () => resolve();
      tx.objectStore(STORE).delete(id);
    });
  } finally {
    db.close();
  }
}
