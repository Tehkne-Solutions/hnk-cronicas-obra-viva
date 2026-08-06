import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadChronicleFromBrowser } from "./storage.js";

function openRawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hnk-cronicas-obra-viva", 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("chronicles")) {
        request.result.createObjectStore("chronicles");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

describe("browser Chronicle validation", () => {
  it("rejects an incompatible schema instead of silently hydrating it", async () => {
    const db = await openRawDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("chronicles", "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      tx.objectStore("chronicles").put({ schemaVersion: 999 }, "chronicle.invalid");
    });
    db.close();

    await expect(loadChronicleFromBrowser("chronicle.invalid")).rejects.toThrow();
  });
});
