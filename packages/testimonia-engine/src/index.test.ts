import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ClaimId,
  type EntityId,
  type EvidenceId,
} from "@hnk/domain";
import { recordTestimony, speakTestimony, type TestimonyActorState } from "./index.js";

const miriam = "npc.miriam" as EntityId;
const at = { day: 1, minuteOfDay: 180 } as const;

function actor(overrides: Partial<TestimonyActorState> = {}): TestimonyActorState {
  return {
    actorId: miriam,
    knows: [],
    believes: [],
    willingToSay: [],
    ...overrides,
  };
}

describe("TESTIMONIA", () => {
  it("allows sincere error: believes and says something not known as fact", () => {
    const spoken = speakTestimony(actor({
      believes: [{ key: "manuscript.date", value: "medieval" }],
      willingToSay: [{ key: "manuscript.date", value: "medieval" }],
    }), "manuscript.date");
    expect(spoken?.relationToSpeakerState).toBe("believed");
  });

  it("allows deliberate contradiction between known state and spoken statement", () => {
    const spoken = speakTestimony(actor({
      knows: [{ key: "manuscript.date", value: 1674 }],
      willingToSay: [{ key: "manuscript.date", value: "medieval" }],
    }), "manuscript.date");
    expect(spoken?.relationToSpeakerState).toBe("withheld_truth");
  });

  it("supports omission by simply refusing to produce testimony", () => {
    const spoken = speakTestimony(actor({
      knows: [{ key: "manuscript.author", value: "Matthias" }],
      willingToSay: [],
    }), "manuscript.author");
    expect(spoken).toBeNull();
  });

  it("records only the spoken claim in player knowledge, never the hidden internal relation", () => {
    const spoken = speakTestimony(actor({
      knows: [{ key: "manuscript.date", value: 1674 }],
      willingToSay: [{ key: "manuscript.date", value: "medieval" }],
    }), "manuscript.date")!;

    const state = recordTestimony(
      createEmptyKnowledgeState(),
      spoken,
      at,
      "claim.miriam.date" as ClaimId,
      "evidence.miriam.date" as EvidenceId,
    );

    expect(state.claims["claim.miriam.date"]?.status).toBe("reported");
    expect(state.claims["claim.miriam.date"]?.value).toBe("medieval");
    expect(state.evidence["evidence.miriam.date"]?.kind).toBe("testimony");
    expect(JSON.stringify(state)).not.toContain("withheld_truth");
    expect(JSON.stringify(state)).not.toContain("1674");
  });
});
