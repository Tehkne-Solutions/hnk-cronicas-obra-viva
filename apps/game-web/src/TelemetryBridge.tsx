import React, { useEffect, useRef } from "react";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { projectIgnis } from "./ignis.js";
import { projectIgnisInvestigation } from "./investigation.js";
import { projectMiriamIgnisConversation } from "./consequence.js";
import { projectPlayableLoop } from "./playable-loop.js";
import { installGlobalObservability, observeChronicle, reportTelemetry } from "./telemetry.js";

export function TelemetryBridge({
  chronicle,
  sessionState,
  storageState,
}: {
  chronicle: ChronicleSaveV2 | null;
  sessionState: "loading" | "menu" | "prologue" | "playing";
  storageState: "ready" | "saving" | "error";
}) {
  const previous = useRef<ChronicleSaveV2 | null>(null);
  const lastStorageState = useRef(storageState);

  useEffect(() => installGlobalObservability(), []);

  useEffect(() => {
    if (!chronicle) {
      previous.current = null;
      return;
    }
    observeChronicle(previous.current, chronicle);
    previous.current = chronicle;

    const persona = chronicle.personas[chronicle.activePersonaId as string];
    const knowledge = chronicle.knowledgeByPersona[chronicle.activePersonaId as string];
    const location = persona?.currentLocation as string | undefined;
    if (!persona) reportTelemetry("active_persona_missing", { activePersonaId: chronicle.activePersonaId }, "error");
    if (location && !chronicle.world.locations[location]) reportTelemetry("current_location_missing", { locationId: location }, "error");
    if (!knowledge) reportTelemetry("knowledge_state_missing", { activePersonaId: chronicle.activePersonaId }, "error");

    const eventIds = chronicle.eventLedger.map((event) => String(event.id));
    const duplicateEventIds = eventIds.filter((id, index) => eventIds.indexOf(id) !== index);
    if (duplicateEventIds.length > 0) reportTelemetry("duplicate_event_ids", { ids: [...new Set(duplicateEventIds)] }, "error");

    if (sessionState === "playing" && persona && knowledge) {
      const ignis = projectIgnis(chronicle);
      const investigation = projectIgnisInvestigation(chronicle);
      const miriam = projectMiriamIgnisConversation(chronicle);
      const loop = projectPlayableLoop(chronicle);
      const localActionCount = ignis.availableActions.length + investigation.availableActions.length + loop.actions.length + (miriam.available ? 1 : 0) + (miriam.deeperAvailable ? 1 : 0);
      const unresolvedQuestionCount = Object.values(knowledge.questions).filter((question) => question.status !== "answered").length;
      reportTelemetry("gameplay_health_snapshot", {
        localActionCount,
        unresolvedQuestionCount,
        eventCount: chronicle.eventLedger.length,
        scheduledConsequenceCount: chronicle.scheduledConsequences.length,
      }, localActionCount === 0 && unresolvedQuestionCount > 0 ? "debug" : "info");
    }
  }, [chronicle, sessionState]);

  useEffect(() => {
    if (lastStorageState.current !== storageState) {
      reportTelemetry("storage_state_changed", { from: lastStorageState.current, to: storageState }, storageState === "error" ? "error" : "info");
      lastStorageState.current = storageState;
    }
  }, [storageState]);

  return null;
}
