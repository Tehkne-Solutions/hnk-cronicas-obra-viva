import type { EventId, WorldTimestamp } from "@hnk/domain";
import { materializeConsequence, resolveDueConsequences } from "@hnk/consequentia-engine";
import type { ChronicleSaveV2 } from "./v2.js";

export interface AdvanceChronicleResult {
  readonly chronicle: ChronicleSaveV2;
  readonly materializedEventIds: readonly EventId[];
}

export function advanceChronicleConsequences(
  chronicle: ChronicleSaveV2,
  now: WorldTimestamp,
  nextEventId: (consequenceId: string) => EventId,
): AdvanceChronicleResult {
  const resolution = resolveDueConsequences(chronicle.scheduledConsequences, now);
  const events = resolution.due.map((consequence) =>
    materializeConsequence(consequence, nextEventId(consequence.id)),
  );

  const next: ChronicleSaveV2 = Object.freeze({
    ...chronicle,
    world: Object.freeze({ ...chronicle.world, timestamp: now }),
    eventLedger: Object.freeze([...chronicle.eventLedger, ...events]),
    scheduledConsequences: Object.freeze([...resolution.pending]),
  });

  return Object.freeze({
    chronicle: next,
    materializedEventIds: Object.freeze(events.map((event) => event.id)),
  });
}
