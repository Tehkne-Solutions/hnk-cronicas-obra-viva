import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EventId, type LocationId, type PersonaId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { projectRecoveredFolio, readRecoveredFolio } from "./recovered-folio.js";

const personaId = "persona.player" as PersonaId;
const archivum = "aurea.archivum" as LocationId;

function fixture(litterae: number, discernimentum: number, illumination: "dark" | "dim" | "lit" = "lit"): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.recovered-folio" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 660 },
      locations: { [archivum]: { id: archivum, illumination, entityIds: [] } },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: archivum,
        inventory: [],
        capabilities: { observatio: 1, litterae, discernimentum },
      },
    },
    knowledgeByPersona: {
      [personaId]: {
        ...createEmptyKnowledgeState(),
        evidence: {
          "evidence.folio.archivum-ledger": {
            id: "evidence.folio.archivum-ledger" as never,
            kind: "document",
            producedAt: { day: 1, minuteOfDay: 600 },
            supports: [],
            contradicts: [],
            payload: { source: "archivum.transfer-ledger", box: 7 },
          },
        },
      },
    },
    eventLedger: [{
      id: "event.transfer-box.opened" as EventId,
      type: "TransferBox7Opened",
      occurredAt: { day: 1, minuteOfDay: 650 },
      payload: { outcome: "folio_present" },
    }],
    scheduledConsequences: [],
    contentVersion: "recovered-folio-test",
  };
}

describe("recovered folio SCRIPTUM", () => {
  it("reveals only layers allowed by light and capabilities", () => {
    const basic = projectRecoveredFolio(fixture(1, 0));
    expect(basic.textKeys).toContain("folio.text.three_witnesses");
    expect(basic.textKeys).not.toContain("folio.margin.do_not_trust_one_witness");

    const trained = projectRecoveredFolio(fixture(1, 1));
    expect(trained.textKeys).toContain("folio.margin.do_not_trust_one_witness");
    expect(trained.textKeys).toContain("folio.damage.scorched_lower_edge");
  });

  it("records visible layers as document evidence and opens the first content QUAESTIO", () => {
    const chronicle = readRecoveredFolio(fixture(1, 1));
    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    expect(knowledge.claims["claim.folio.main-text"]?.status).toBe("observed");
    expect(knowledge.claims["claim.folio.margin-hand"]?.status).toBe("observed");
    expect(knowledge.claims["claim.prov.folio.transfer-ledger"]?.status).toBe("reported");
    expect(knowledge.questions["question.folio.three-witnesses"]?.status).toBe("open");
    expect(chronicle.eventLedger.some((event) => event.type === "RecoveredFolioRead")).toBe(true);
  });

  it("does not duplicate knowledge or the read event when read again", () => {
    const once = readRecoveredFolio(fixture(1, 1));
    const twice = readRecoveredFolio(once);
    expect(Object.keys(twice.knowledgeByPersona[personaId]!.claims)).toHaveLength(Object.keys(once.knowledgeByPersona[personaId]!.claims).length);
    expect(twice.eventLedger.filter((event) => event.type === "RecoveredFolioRead")).toHaveLength(1);
  });
});
