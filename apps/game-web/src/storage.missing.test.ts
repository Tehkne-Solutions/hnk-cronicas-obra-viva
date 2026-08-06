import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadChronicleFromBrowser } from "./storage.js";

describe("browser Chronicle missing save", () => {
  it("returns null when the Chronicle does not exist", async () => {
    await expect(loadChronicleFromBrowser("chronicle.missing")).resolves.toBeNull();
  });
});
