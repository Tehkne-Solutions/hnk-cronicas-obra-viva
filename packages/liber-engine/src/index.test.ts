import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type QuestionId } from "@hnk/domain";
import { createLiberState, recordDiariumEntry, recordExperiment, syncLiberKnowledge } from "./index.js";

describe("LIBER", () => {
  it("starts with the four canonical IGNIS sections", () => {
    expect(createLiberState().sections).toEqual(["diarium", "materia", "quaestiones", "experimenta"]);
  });

  it("records meaningful chronicle entries and experiments without click logs", () => {
    let liber = createLiberState();
    liber = recordDiariumEntry(liber, {
      id: "day1-first-flame",
      at: { day: 1, minuteOfDay: 90 },
      titleKey: "diarium.day1.first_flame",
      eventRefs: ["event.combustion.started", "event.location.illuminated"],
    });
    liber = recordExperiment(liber, {
      id: "experiment.lamp.01",
      at: { day: 1, minuteOfDay: 90 },
      inputRefs: ["oleum", "linum", "silex", "ferrum"],
      actionRefs: ["add", "wait", "strike"],
      outcomeRefs: ["combustion.started", "light.emitted"],
      evidenceRefs: ["evidence.lamp.light.01"],
    });
    expect(liber.diarium).toHaveLength(1);
    expect(liber.experiments).toHaveLength(1);
  });

  it("projects QUAESTIONES from knowledge without inventing hidden facts", () => {
    const base = createEmptyKnowledgeState();
    const knowledge = {
      ...base,
      questions: {
        "question.lamp.light": {
          id: "question.lamp.light" as QuestionId,
          textKey: "question.lamp.light",
          status: "answered" as const,
          relatedClaims: [], relatedEvidence: [], derivedQuestions: [],
          openedAt: { day: 1, minuteOfDay: 60 },
        },
      },
    };
    expect(syncLiberKnowledge(createLiberState(), knowledge).questionIds).toEqual(["question.lamp.light"]);
  });
});
