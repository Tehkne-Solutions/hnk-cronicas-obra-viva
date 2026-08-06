import { advanceWorldTimestamp, type EventId, type LocationId, type PersonaId } from "@hnk/domain";
import { resolveDueConsequences, materializeConsequence } from "@hnk/consequentia-engine";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export interface AureaRoute {
  readonly from: LocationId;
  readonly to: LocationId;
  readonly travelMinutes: number;
}

export interface TravelResult {
  readonly chronicle: ChronicleSaveV2;
  readonly elapsedMinutes: number;
  readonly arrivedAt: LocationId;
  readonly materializedEventTypes: readonly string[];
}

export function travelChronicle(
  chronicle: ChronicleSaveV2,
  personaId: PersonaId,
  route: AureaRoute,
): TravelResult {
  if (!Number.isInteger(route.travelMinutes) || route.travelMinutes <= 0) {
    throw new RangeError("travelMinutes must be a positive integer.");
  }
  const persona = chronicle.personas[personaId as string];
  if (!persona) throw new Error(`Unknown persona: ${String(personaId)}`);
  if (persona.currentLocation !== route.from) throw new Error("Persona is not at the route origin.");

  const now = advanceWorldTimestamp(chronicle.world.timestamp, route.travelMinutes);
  const resolution = resolveDueConsequences(chronicle.scheduledConsequences, now);
  const events = resolution.due.map((item, index) => {
    const eventId = `event.consequence.travel.${chronicle.eventLedger.length + index + 1}` as EventId;
    return materializeConsequence(item, eventId);
  });

  const updatedPersona = Object.freeze({ ...persona, currentLocation: route.to });
  const updatedChronicle: ChronicleSaveV2 = Object.freeze({
    ...chronicle,
    world: Object.freeze({ ...chronicle.world, timestamp: now }),
    personas: Object.freeze({ ...chronicle.personas, [personaId as string]: updatedPersona }),
    eventLedger: Object.freeze([...chronicle.eventLedger, ...events]),
    scheduledConsequences: resolution.pending,
  });

  return Object.freeze({
    chronicle: updatedChronicle,
    elapsedMinutes: route.travelMinutes,
    arrivedAt: route.to,
    materializedEventTypes: Object.freeze(events.map((event) => event.type)),
  });
}
