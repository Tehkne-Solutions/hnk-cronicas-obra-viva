import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ClaimId,
  type EntityId,
  type EvidenceId,
  type KnowledgeNodeId,
} from "@hnk/domain";
import { recordProvenanceClaim, recordScriptumObservation } from "./knowledge.js";

const documentId = "document.ardel.manuscript" as EntityId;
const at = { day: 1, minuteOfDay: 120 } as const;

describe("SCRIPTUM → Knowledge", () => {
  it("records readable text as document evidence, not world truth", () => {
    const state = recordScriptumObservation(
      createEmptyKnowledgeState(),
      {
        documentId,
        layerId: "main-text",
        kind: "text",
        conceptId: "scriptum.document.ardel.manuscript.main-text",
        textKey: "scriptum.ardel.main_text",
      },
      at,
      {
        nodeId: "knowledge.document.ardel" as KnowledgeNodeId,
        claimId: "claim.document.ardel.text" as ClaimId,
        evidenceId: "evidence.document.ardel.text" as EvidenceId,
      },
    );
    const claim = state.claims["claim.document.ardel.text"];
    expect(claim?.status).toBe("observed");
    expect(claim?.value).toBe("scriptum.ardel.main_text");
    expect(state.evidence["evidence.document.ardel.text"]?.kind).toBe("document");
  });

  it("keeps conflicting provenance reports side by side", () => {
    let state = createEmptyKnowledgeState();
    state = recordProvenanceClaim(state, documentId, {
      id: "prov.catalogue",
      sourceRef: "source.archivum.catalogue",
      claimKey: "provenance.catalogue.1674",
    }, at, "claim.prov.catalogue" as ClaimId, "evidence.prov.catalogue" as EvidenceId);
    state = recordProvenanceClaim(state, documentId, {
      id: "prov.margin",
      sourceRef: "source.margin.note",
      claimKey: "provenance.margin.medieval",
    }, at, "claim.prov.margin" as ClaimId, "evidence.prov.margin" as EvidenceId);

    expect(state.claims["claim.prov.catalogue"]?.status).toBe("reported");
    expect(state.claims["claim.prov.margin"]?.status).toBe("reported");
    expect(Object.keys(state.claims)).toHaveLength(2);
  });
});
