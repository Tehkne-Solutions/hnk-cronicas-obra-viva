import type {
  EntityId,
  EntityWorldState,
  LocationId,
  WorldState,
  WorldTimestamp,
} from "@hnk/domain";
import type { LocationHours, NpcRoutine } from "@hnk/aurea-routines";
import { isLocationOpen, resolveNpcLocation } from "@hnk/aurea-routines";
import type { NarrativeLayer, NarrativeScene } from "@hnk/narrative-engine";

export interface AureaLocationDefinition {
  readonly locationId: LocationId;
  readonly sceneId: string;
  readonly baseTextKey: string;
  readonly closedTextKey?: string;
  readonly hours?: LocationHours;
}

export interface AureaSceneProjection {
  readonly world: WorldState;
  readonly scene: NarrativeScene;
  readonly locationOpen: boolean;
  readonly availableActionKeys: readonly string[];
}

function projectNpcLocations(
  world: WorldState,
  routines: readonly NpcRoutine[],
  now: WorldTimestamp,
): WorldState {
  const entities: Record<string, EntityWorldState> = { ...world.entities };
  for (const routine of routines) {
    const existing = entities[routine.npcId as string];
    if (!existing) continue;
    const locationId = resolveNpcLocation(routine, now);
    entities[routine.npcId as string] = Object.freeze({
      ...existing,
      ...(locationId ? { locationId } : { locationId: undefined }),
    });
  }
  return Object.freeze({ ...world, timestamp: now, entities: Object.freeze(entities) });
}

export function projectAureaScene(input: {
  readonly world: WorldState;
  readonly now: WorldTimestamp;
  readonly location: AureaLocationDefinition;
  readonly routines: readonly NpcRoutine[];
  readonly localNpcNarrative?: Readonly<Record<string, string>>;
}): AureaSceneProjection {
  const world = projectNpcLocations(input.world, input.routines, input.now);
  const open = input.location.hours ? isLocationOpen(input.location.hours, input.now) : true;

  const layers: NarrativeLayer[] = [];
  if (!open && input.location.closedTextKey) {
    layers.push(Object.freeze({ id: `${input.location.sceneId}.closed`, textKey: input.location.closedTextKey, priority: 10 }));
  }

  if (open && input.localNpcNarrative) {
    for (const [npcId, textKey] of Object.entries(input.localNpcNarrative)) {
      const npc = world.entities[npcId];
      if (npc?.locationId === input.location.locationId) {
        layers.push(Object.freeze({ id: `${input.location.sceneId}.npc.${npcId}`, textKey, priority: 20 }));
      }
    }
  }

  const scene: NarrativeScene = Object.freeze({
    id: input.location.sceneId,
    base: Object.freeze([
      Object.freeze({ id: `${input.location.sceneId}.base`, textKey: input.location.baseTextKey, priority: 0 }),
    ]),
    layers: Object.freeze(layers),
  });

  return Object.freeze({
    world,
    scene,
    locationOpen: open,
    availableActionKeys: Object.freeze(open ? ["action.observe", "action.enter"] : ["action.observe", "action.wait"]),
  });
}

export function entityAt(world: WorldState, entityId: EntityId, locationId: LocationId): boolean {
  return world.entities[entityId as string]?.locationId === locationId;
}
