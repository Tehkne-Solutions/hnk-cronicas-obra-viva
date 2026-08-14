import { describe, expect, it } from "vitest";
import { PACK00_ART_FOUNDATION, pack00Asset } from "./art-foundation.js";
describe("PACK-00 Art Foundation runtime contract", () => {
  it("binds the candidate pack to Tehkné Solutions and runtime-safe asset paths", () => {
    expect(PACK00_ART_FOUNDATION.packId).toBe("PACK-00");
    expect(PACK00_ART_FOUNDATION.status).toBe("candidate-applied");
    expect(PACK00_ART_FOUNDATION.signature).toBe("Tehkné Solutions");
    expect(Object.values(PACK00_ART_FOUNDATION.assets)).toHaveLength(12);
    expect(Object.values(PACK00_ART_FOUNDATION.assets).every((path) => path.startsWith("/pack00/"))).toBe(true);
  });
  it("preserves the approved anti-app visual policy", () => {
    expect(PACK00_ART_FOUNDATION.policy).toEqual({ gradients: false, glow: false, appLikeUi: false, runtimeStatus: "candidate" });
  });
  it("resolves the primary elemental and character assets deterministically", () => {
    expect(pack00Asset("fireIcon")).toBe("/pack00/elements/fire-icon.svg");
    expect(pack00Asset("waterIcon")).toBe("/pack00/elements/water-icon.svg");
    expect(pack00Asset("mentorPortrait")).toBe("/pack00/characters/mentor-neutral.webp");
    expect(pack00Asset("sparkPortrait")).toBe("/pack00/characters/spark-curious.webp");
  });
  it("keeps the blocked laboratory binary explicit instead of silently replacing it", () => {
    expect(PACK00_ART_FOUNDATION.pending.laboratory).toContain("pending binary materialization");
  });
});
