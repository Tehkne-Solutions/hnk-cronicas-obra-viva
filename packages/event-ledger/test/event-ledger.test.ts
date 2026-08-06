import { describe, expect, it } from "vitest";

import type { DomainEvent, EntityId, EventId } from "@hnk/domain";
import { createWorldTimestamp } from "@hnk/domain";

import { EventLedger } from "../src/index.js";

const event = (
  id: string,
  type: string,
  causationId?: string,
): DomainEvent => ({
  id: id as EventId,
  type,
  occurredAt: createWorldTimestamp(1, 0),
  payload: {},
  ...(causationId === undefined
    ? {}
    : { causationId: causationId as EventId }),
});

describe("EventLedger", () => {
  it("stores immutable events and resolves causal ancestry", () => {
    const ledger = new EventLedger();
    ledger.append(event("evt-1", "IntentReceived"));
    ledger.append(event("evt-2", "ObjectObserved", "evt-1"));
    ledger.append(event("evt-3", "KnowledgeDiscovered", "evt-2"));

    expect(ledger.getCauses("evt-3" as EventId).map(({ id }) => id)).toEqual([
      "evt-1",
      "evt-2",
    ]);
  });

  it("rejects duplicate event identifiers", () => {
    const ledger = new EventLedger();
    ledger.append(event("evt-1", "IntentReceived"));

    expect(() => ledger.append(event("evt-1", "IntentReceived"))).toThrow(
      "Duplicate event id",
    );
  });

  it("finds events associated with an entity", () => {
    const ledger = new EventLedger();
    const entityId = "lamp-1" as EntityId;

    ledger.append({
      ...event("evt-1", "ObjectObserved"),
      payload: { targetId: entityId },
    });

    expect(ledger.getByEntity(entityId)).toHaveLength(1);
  });
});
