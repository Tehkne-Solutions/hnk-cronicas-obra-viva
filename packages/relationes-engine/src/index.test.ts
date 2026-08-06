import { describe, expect, it } from "vitest";
import type { EntityId } from "@hnk/domain";
import type { TestimonyActorState } from "@hnk/testimonia-engine";
import { applyDisclosureRules, relationDelta, type RelationState } from "./index.js";

const miriam = "npc.miriam" as EntityId;
const persona = "persona.01" as EntityId;

const actor: TestimonyActorState = {
  actorId: miriam,
  knows: [
    { key: "manuscript.date", value: 1674 },
    { key: "manuscript.owner", value: "matthias" },
  ],
  believes: [
    { key: "manuscript.date", value: 1674 },
    { key: "manuscript.owner", value: "matthias" },
  ],
  willingToSay: [
    { key: "manuscript.date", value: 1674 },
    { key: "manuscript.owner", value: "matthias" },
  ],
};

const baseRelation: RelationState = {
  subjectId: miriam,
  objectId: persona,
  trust: 0.2,
  respect: 0.5,
  affection: 0,
  fear: 0,
  suspicion: 0.1,
  obligation: 0,
};

describe("RELATIONES", () => {
  it("gates what is disclosed without mutating what the witness knows or believes", () => {
    const result = applyDisclosureRules(actor, baseRelation, [
      { propositionKey: "manuscript.date", minimumTrust: 0.1 },
      { propositionKey: "manuscript.owner", minimumTrust: 0.8 },
    ]);

    expect(result.willingToSay).toEqual([{ key: "manuscript.date", value: 1674 }]);
    expect(result.knows).toEqual(actor.knows);
    expect(result.believes).toEqual(actor.believes);
  });

  it("changes relationship dimensions independently and clamps them", () => {
    const next = relationDelta(baseRelation, { trust: 1, suspicion: -0.5, obligation: 0.4 });
    expect(next.trust).toBe(1);
    expect(next.suspicion).toBe(-0.4);
    expect(next.obligation).toBe(0.4);
    expect(next.respect).toBe(baseRelation.respect);
  });
});
