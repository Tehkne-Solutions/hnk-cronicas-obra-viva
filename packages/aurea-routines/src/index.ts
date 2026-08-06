import type { EntityId, LocationId, WorldTimestamp } from "@hnk/domain";

export interface RoutineWindow {
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly locationId: LocationId;
}

export interface NpcRoutine {
  readonly npcId: EntityId;
  readonly windows: readonly RoutineWindow[];
}

export interface LocationHours {
  readonly locationId: LocationId;
  readonly opensAt: number;
  readonly closesAt: number;
}

export function resolveNpcLocation(
  routine: NpcRoutine,
  now: WorldTimestamp,
): LocationId | null {
  const minute = now.minuteOfDay;
  const window = routine.windows.find((entry) => {
    if (entry.fromMinute <= entry.toMinute) {
      return minute >= entry.fromMinute && minute < entry.toMinute;
    }
    return minute >= entry.fromMinute || minute < entry.toMinute;
  });
  return window?.locationId ?? null;
}

export function isLocationOpen(hours: LocationHours, now: WorldTimestamp): boolean {
  const minute = now.minuteOfDay;
  if (hours.opensAt <= hours.closesAt) {
    return minute >= hours.opensAt && minute < hours.closesAt;
  }
  return minute >= hours.opensAt || minute < hours.closesAt;
}

export interface RoutinePresence {
  readonly npcId: EntityId;
  readonly locationId: LocationId | null;
  readonly present: boolean;
}

export function resolvePresence(
  routine: NpcRoutine,
  locationId: LocationId,
  now: WorldTimestamp,
): RoutinePresence {
  const current = resolveNpcLocation(routine, now);
  return Object.freeze({
    npcId: routine.npcId,
    locationId: current,
    present: current === locationId,
  });
}
