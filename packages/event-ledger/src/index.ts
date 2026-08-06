import type { DomainEvent, EntityId, EventId } from "@hnk/domain";

export class EventLedger {
  readonly #events: DomainEvent[] = [];

  append(event: DomainEvent): void {
    if (this.#events.some((existing) => existing.id === event.id)) {
      throw new Error(`Duplicate event id: ${String(event.id)}`);
    }

    this.#events.push(Object.freeze({ ...event }));
  }

  getAll(): readonly DomainEvent[] {
    return [...this.#events];
  }

  getByType(type: string): readonly DomainEvent[] {
    return this.#events.filter((event) => event.type === type);
  }

  getByEntity(entityId: EntityId): readonly DomainEvent[] {
    return this.#events.filter((event) => {
      if (event.actor?.id === entityId) {
        return true;
      }

      const payload = event.payload;
      return (
        typeof payload === "object" &&
        payload !== null &&
        Object.values(payload).includes(entityId)
      );
    });
  }

  getByCorrelation(correlationId: string): readonly DomainEvent[] {
    return this.#events.filter(
      (event) => event.correlationId === correlationId,
    );
  }

  getCauses(eventId: EventId): readonly DomainEvent[] {
    const result: DomainEvent[] = [];
    let current = this.#events.find((event) => event.id === eventId);
    const visited = new Set<EventId>();

    while (current?.causationId !== undefined) {
      if (visited.has(current.causationId)) {
        throw new Error("Causation cycle detected in event ledger.");
      }

      visited.add(current.causationId);
      const cause = this.#events.find(
        (event) => event.id === current?.causationId,
      );

      if (cause === undefined) {
        break;
      }

      result.unshift(cause);
      current = cause;
    }

    return result;
  }
}
