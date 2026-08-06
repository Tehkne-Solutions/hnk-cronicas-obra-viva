import type { EntityId, LocationId, WorldState } from "@hnk/domain";
import type { CombustionResolution } from "@hnk/alchemy-engine";

export type WorldLightEvent =
  | Readonly<{ type: "LightSourceChanged"; sourceId: EntityId; output: "none" | "low" | "bright" }>
  | Readonly<{ type: "LocationIlluminationChanged"; locationId: LocationId; illumination: "dark" | "dim" | "lit" }>;

export function deriveLightEvents(input: {
  readonly combustion: CombustionResolution;
  readonly sourceId: EntityId;
  readonly locationId: LocationId;
}): readonly WorldLightEvent[] {
  const started = input.combustion.events.some((event) => event.type === "CombustionStarted");
  if (!started) return [];

  return [
    Object.freeze({ type: "LightSourceChanged" as const, sourceId: input.sourceId, output: "bright" as const }),
    Object.freeze({ type: "LocationIlluminationChanged" as const, locationId: input.locationId, illumination: "lit" as const }),
  ];
}

export function reduceWorldLight(state: WorldState, event: WorldLightEvent): WorldState {
  if (event.type === "LightSourceChanged") {
    const entity = state.entities[event.sourceId as string];
    if (!entity) return state;
    return Object.freeze({
      ...state,
      entities: Object.freeze({
        ...state.entities,
        [event.sourceId as string]: Object.freeze({
          ...entity,
          state: Object.freeze({ ...entity.state, lightOutput: event.output }),
        }),
      }),
    });
  }

  const location = state.locations[event.locationId as string];
  if (!location) return state;
  return Object.freeze({
    ...state,
    locations: Object.freeze({
      ...state.locations,
      [event.locationId as string]: Object.freeze({ ...location, illumination: event.illumination }),
    }),
  });
}

export function applyWorldLightEvents(state: WorldState, events: readonly WorldLightEvent[]): WorldState {
  return events.reduce(reduceWorldLight, state);
}
