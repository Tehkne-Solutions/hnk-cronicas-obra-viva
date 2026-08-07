import { describe, expect, it } from "vitest";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { observeChronicleTransition } from "@hnk/telemetry-engine";
import { analyzeTelemetry } from "@hnk/telemetry-engine/diagnostics";

const criticalMilestones = [
  "ProloguePathChosen",
  "CombustionStarted",
  "IgnisManuscriptRead",
  "IgnisQuaestioIntegrated",
  "MiriamIgnisTestimonyReceived",
  "MissingFolioEvidenceCompared",
  "MiriamFolioLocationTestimonyReceived",
  "TransferBox7Opened",
  "RecoveredFolioRead",
  "TomasMemoryHeard",
  "BeatriceMemoryHeard",
  "MemoryWitnessesCompared",
  "ThreeWitnessesUnderstood",
] as const;

function state(events: readonly string[]): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.observability-gate" as never,
    activePersonaId: "persona.player" as never,
    world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 840 }, locations: { "aurea.forum": { id: "aurea.forum" as never, illumination: "lit", entityIds: [] } }, entities: {} },
    personas: { "persona.player": { id: "persona.player" as never, currentLocation: "aurea.forum" as never, inventory: [], capabilities: { observatio: 2, litterae: 2, discernimentum: 2 } } },
    knowledgeByPersona: { "persona.player": { nodes: {}, claims: {}, evidence: {}, questions: {} } },
    eventLedger: events.map((type, index) => ({ id: `event.observability.${index}` as never, type, occurredAt: { day: 1, minuteOfDay: 840 }, payload: {} })),
    scheduledConsequences: [],
    contentVersion: "observability-gate",
  };
}

describe("game observability gate", () => {
  it("emits telemetry for every critical milestone protected by the full playthrough", () => {
    const telemetry = observeChronicleTransition({
      sessionId: "session.ci",
      previous: state([]),
      current: state(criticalMilestones),
    });
    const names = new Set(telemetry.filter((event) => event.kind === "game_event").map((event) => event.name));
    for (const milestone of criticalMilestones) expect(names.has(milestone)).toBe(true);
    expect(analyzeTelemetry(telemetry)).toEqual([]);
  });
});
