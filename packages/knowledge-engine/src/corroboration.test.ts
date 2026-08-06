import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ClaimId, type EvidenceId } from "@hnk/domain";
import { assessClaim, evidenceKindsForClaim } from "./corroboration.js";

const claimId = "claim.manuscript.date" as ClaimId;

describe("claim corroboration", () => {
  it("marks a claim contested when documentary and testimony evidence disagree", () => {
    const state = {
      ...createEmptyKnowledgeState(),
      evidence: {
        "evidence.document.date": {
          id: "evidence.document.date" as EvidenceId,
          kind: "document" as const,
          producedAt: { day: 1, minuteOfDay: 100 },
          supports: [claimId],
          contradicts: [],
          payload: {},
        },
        "evidence.testimony.date": {
          id: "evidence.testimony.date" as EvidenceId,
          kind: "testimony" as const,
          producedAt: { day: 1, minuteOfDay: 110 },
          supports: [],
          contradicts: [claimId],
          payload: {},
        },
      },
    };

    expect(assessClaim(state, claimId as string).status).toBe("contested");
    expect(evidenceKindsForClaim(state, claimId as string).sort()).toEqual(["document", "testimony"]);
  });
});
