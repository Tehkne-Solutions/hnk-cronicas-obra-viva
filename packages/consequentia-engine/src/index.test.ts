import { describe, expect, it } from "vitest";
import type { EventId } from "@hnk/domain";
import {
  materializeConsequence,
  resolveDueConsequences,
  scheduleConsequence,
} from "./index.js";

describe("CONSEQUENTIA", () => {
  it("keeps future effects pending until world time reaches them", () => {
    const scheduled = scheduleConsequence({
      id: "consequence.rumour.01",
      causeEventId: "event.publish.01" as EventId,
      dueAt: { day: 3, minuteOfDay: 600 },
      eventType: "RumourSpread",
      payload: { topic: "manuscript-origin" },
      correlationId: "publication.manuscript.01",
    });

    expect(resolveDueConsequences([scheduled], { day: 2, minuteOfDay: 900 }).due).toHaveLength(0);
    expect(resolveDueConsequences([scheduled], { day: 3, minuteOfDay: 600 }).due).toHaveLength(1);
  });

  it("materializes a delayed event with its original cause preserved", () => {
    const scheduled = scheduleConsequence({
      id: "consequence.miriam.01",
      causeEventId: "event.dialogue.choice.01" as EventId,
      dueAt: { day: 4, minuteOfDay: 480 },
      eventType: "MiriamWithholdsArchiveKey",
      payload: { reason: "trust-broken" },
    });

    const event = materializeConsequence(scheduled, "event.consequence.01" as EventId);
    expect(event.causationId).toBe("event.dialogue.choice.01");
    expect(event.type).toBe("MiriamWithholdsArchiveKey");
    expect(event.payload).toEqual({ reason: "trust-broken" });
  });
});
