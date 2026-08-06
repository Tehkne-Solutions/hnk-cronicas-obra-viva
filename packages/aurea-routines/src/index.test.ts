import { describe, expect, it } from "vitest";
import type { EntityId, LocationId } from "@hnk/domain";
import { isLocationOpen, resolveNpcLocation, resolvePresence } from "./index.js";

const archivum = "aurea.archivum" as LocationId;
const forum = "aurea.forum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const miriam = "npc.miriam" as EntityId;

const miriamRoutine = {
  npcId: miriam,
  windows: [
    { fromMinute: 8 * 60, toMinute: 12 * 60, locationId: archivum },
    { fromMinute: 13 * 60, toMinute: 17 * 60, locationId: forum },
  ],
} as const;

describe("Aurea routines", () => {
  it("places Miriam in Archivum in the morning and Forum in the afternoon", () => {
    expect(resolveNpcLocation(miriamRoutine, { day: 1, minuteOfDay: 9 * 60 })).toBe(archivum);
    expect(resolveNpcLocation(miriamRoutine, { day: 1, minuteOfDay: 14 * 60 })).toBe(forum);
  });

  it("can make an NPC genuinely absent instead of teleporting them to the player", () => {
    expect(resolvePresence(miriamRoutine, archivum, { day: 1, minuteOfDay: 14 * 60 }).present).toBe(false);
  });

  it("opens and closes places by city time", () => {
    const hours = { locationId: typographia, opensAt: 9 * 60, closesAt: 18 * 60 };
    expect(isLocationOpen(hours, { day: 1, minuteOfDay: 10 * 60 })).toBe(true);
    expect(isLocationOpen(hours, { day: 1, minuteOfDay: 19 * 60 })).toBe(false);
  });
});
