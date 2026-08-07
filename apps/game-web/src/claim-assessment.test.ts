import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ClaimId, type EvidenceId } from "@hnk/domain";
import { projectClaimAssessment, projectMemoryAssessments } from "./claim-assessment.js";

const beatriceClaimId = "claim.memory.beatrice.box-3" as ClaimId;
const rumourClaimId = "claim.folio.rumour-box-3" as ClaimId;
const contaminationClaimId = "claim.memory.beatrice-rumour-contaminated" as ClaimId;

describe("qualitative corroboration projection", () => {
  it("changes Beatrice from supported to contested when source comparison contradicts her claim", () => {
    const before = {
      ...createEmptyKnowledgeState(),
      claims: {
        [beatriceClaimId as string]: {
          id: beatriceClaimId,
          subjectId: beatriceClaimId as never,
          predicate: "memory_witness_report",
          value: "archivum.transfer-box.3",
          status: "reported" as const,
          createdAt: { day: 1, minuteOfDay: 800 },
          sourceRefs: ["evidence.memory.beatrice.box-3"],
        },
      },
      evidence: {
        "evidence.memory.beatrice.box-3": {
          id: "evidence.memory.beatrice.box-3" as EvidenceId,
          kind: "testimony" as const,
          producedAt: { day: 1, minuteOfDay: 800 },
          supports: [beatriceClaimId],
          contradicts: [],
          payload: { heardForumRumourBeforeRecall: true },
        },
      },
    };

    expect(projectClaimAssessment(before, beatriceClaimId as string).label).toBe("Apoiada");

    const after = {
      ...before,
      claims: {
        ...before.claims,
        [rumourClaimId as string]: {
          id: rumourClaimId,
          subjectId: rumourClaimId as never,
          predicate: "folio_last_seen_container",
          value: "archivum.transfer-box.3",
          status: "reported" as const,
          createdAt: { day: 1, minuteOfDay: 790 },
          sourceRefs: ["evidence.folio.forum-rumour"],
        },
        [contaminationClaimId as string]: {
          id: contaminationClaimId,
          subjectId: contaminationClaimId as never,
          predicate: "memory_contaminated_by_prior_report",
          value: true,
          status: "supported" as const,
          createdAt: { day: 1, minuteOfDay: 820 },
          sourceRefs: ["evidence.memory.source-comparison"],
        },
      },
      evidence: {
        ...before.evidence,
        "evidence.folio.forum-rumour": {
          id: "evidence.folio.forum-rumour" as EvidenceId,
          kind: "testimony" as const,
          producedAt: { day: 1, minuteOfDay: 790 },
          supports: [rumourClaimId],
          contradicts: [],
          payload: {},
        },
        "evidence.memory.source-comparison": {
          id: "evidence.memory.source-comparison" as EvidenceId,
          kind: "event" as const,
          producedAt: { day: 1, minuteOfDay: 820 },
          supports: [contaminationClaimId],
          contradicts: [beatriceClaimId, rumourClaimId],
          payload: {
            sharedInformationPath: "forum-rumour-box-3",
            independenceAssessment: "beatrice_not_independent",
          },
        },
      },
    };

    const beatrice = projectClaimAssessment(after, beatriceClaimId as string);
    expect(beatrice.label).toBe("Contestada");
    expect(beatrice.independence).toBe("dependent");
    expect(beatrice.supportingCount).toBe(1);
    expect(beatrice.contradictingCount).toBe(1);

    const memory = projectMemoryAssessments(after);
    expect(memory.summary).toContain("não aumenta a corroboration");
    expect(memory.forumRumour?.label).toBe("Contestada");
  });
});
