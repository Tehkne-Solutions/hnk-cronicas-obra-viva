import { describe, expect, it } from "vitest";
import { type EventId } from "@hnk/domain";
import { dayPart, materializeAureaScheduleEntry, resolveAureaSchedule } from "./index.js";

describe("Aurea time foundation", () => {
  const bell = {
    id: "aurea.bell.noon.day1",
    occursAt: { day: 1, minuteOfDay: 12 * 60 },
    eventType: "AureaBellRang",
    payload: { district: "forum" },
  } as const;

  it("keeps city events pending until their own time independent of player action", () => {
    expect(resolveAureaSchedule([bell], { day: 1, minuteOfDay: 11 * 60 + 59 }).due).toHaveLength(0);
    expect(resolveAureaSchedule([bell], { day: 1, minuteOfDay: 12 * 60 }).due).toHaveLength(1);
  });

  it("materializes a scheduled city event without causationId", () => {
    const event = materializeAureaScheduleEntry(bell, "event.aurea.bell.01" as EventId);
    expect(event.type).toBe("AureaBellRang");
    expect(event.occurredAt).toEqual(bell.occursAt);
    expect(event.causationId).toBeUndefined();
  });

  it("derives narrative day parts deterministically", () => {
    expect(dayPart({ day: 1, minuteOfDay: 5 * 60 })).toBe("night");
    expect(dayPart({ day: 1, minuteOfDay: 8 * 60 })).toBe("morning");
    expect(dayPart({ day: 1, minuteOfDay: 15 * 60 })).toBe("afternoon");
    expect(dayPart({ day: 1, minuteOfDay: 20 * 60 })).toBe("evening");
  });
});
