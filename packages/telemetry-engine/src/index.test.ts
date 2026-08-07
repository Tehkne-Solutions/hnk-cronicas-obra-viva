import { describe, expect, it } from "vitest";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { createErrorTelemetry, createTelemetryEvent, observeChronicleTransition } from "./index.js";

function chronicle(eventTypes: string[] = [], location = "aurea.officina", minute = 465): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.telemetry" as never,
    activePersonaId: "persona.player" as never,
    world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: minute }, locations: { [location]: { id: location as never, illumination: "lit", entityIds: [] } }, entities: {} },
    personas: { "persona.player": { id: "persona.player" as never, currentLocation: location as never, inventory: [], capabilities: { observatio: 1, litterae: 1, discernimentum: 1 } } },
    knowledgeByPersona: { "persona.player": { nodes: {}, claims: {}, evidence: {}, questions: {} } },
    eventLedger: eventTypes.map((type, index) => ({ id: `event.${index}` as never, type, occurredAt: { day: 1, minuteOfDay: minute }, payload: { index } })),
    scheduledConsequences: [],
    contentVersion: "telemetry-test",
  };
}

describe("telemetry engine", () => {
  it("derives gameplay, time and location signals from Chronicle transitions", () => {
    const previous = chronicle(["ProloguePathChosen"]);
    const current = chronicle(["ProloguePathChosen", "CombustionStarted"], "aurea.archivum", 480);
    const events = observeChronicleTransition({ sessionId: "session.test", previous, current });
    expect(events.some((event) => event.name === "CombustionStarted" && event.kind === "game_event")).toBe(true);
    expect(events.some((event) => event.name === "location_changed")).toBe(true);
    expect(events.some((event) => event.name === "world_time_changed")).toBe(true);
  });

  it("redacts sensitive keys before emission", () => {
    const event = createTelemetryEvent({ sessionId: "s", kind: "health", name: "privacy", data: { email: "private@example.com", token: "secret", safe: "ok" } });
    expect(event.data).toEqual({ safe: "ok" });
  });

  it("normalizes runtime errors without throwing", () => {
    const event = createErrorTelemetry({ sessionId: "s", source: "window.error", error: new TypeError("boom") });
    expect(event.kind).toBe("error");
    expect(event.data.errorName).toBe("TypeError");
    expect(event.data.message).toBe("boom");
  });
});
