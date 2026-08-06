import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  advanceWorldTimestamp,
  createEmptyKnowledgeState,
  type ChronicleId,
  type EntityId,
  type EventId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import { travelChronicle } from "@hnk/aurea-navigation";
import { projectAureaScene, type AureaLocationDefinition } from "@hnk/aurea-scene";
import type { NpcRoutine } from "@hnk/aurea-routines";
import { composeNarrative } from "@hnk/narrative-engine";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyProloguePath, PROLOGUE_CHOICES, PROLOGUE_COPY, type ProloguePath } from "./prologue.js";
import { applyIgnisAction, IGNIS_ACTION_LABEL, projectIgnis, type IgnisAction } from "./ignis.js";
import {
  applyIgnisInvestigationAction,
  IGNIS_INVESTIGATION_LABEL,
  projectIgnisInvestigation,
  type IgnisInvestigationAction,
} from "./investigation.js";
import { projectChronicleLiber } from "./liber.js";
import {
  deleteChronicleFromBrowser,
  listChroniclesFromBrowser,
  loadChronicleFromBrowser,
  saveChronicleToBrowser,
  type ChronicleBrowserSummary,
} from "./storage.js";
import "./styles.css";

const personaId = "persona.player" as PersonaId;
const miriamId = "npc.miriam" as EntityId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;

const locations = [
  [officina, "Officina Ardel"],
  [archivum, "Archivum"],
  [typographia, "Typographia"],
  [forum, "Forum"],
] as const;

const locationDefinitions: Record<string, AureaLocationDefinition> = {
  [officina]: { locationId: officina, sceneId: "scene.officina", baseTextKey: "scene.officina.base" },
  [archivum]: { locationId: archivum, sceneId: "scene.archivum", baseTextKey: "scene.archivum.base" },
  [typographia]: {
    locationId: typographia,
    sceneId: "scene.typographia",
    baseTextKey: "scene.typographia.base",
    closedTextKey: "scene.typographia.closed",
    hours: { locationId: typographia, opensAt: 9 * 60, closesAt: 15 * 60 },
  },
  [forum]: { locationId: forum, sceneId: "scene.forum", baseTextKey: "scene.forum.base" },
};

const miriamRoutine: NpcRoutine = {
  npcId: miriamId,
  windows: [
    { fromMinute: 8 * 60, toMinute: 12 * 60, locationId: archivum },
    { fromMinute: 13 * 60, toMinute: 17 * 60, locationId: forum },
  ],
};

const travelMinutes: Record<string, number> = {
  [`${officina}>${archivum}`]: 15,
  [`${archivum}>${typographia}`]: 12,
  [`${typographia}>${forum}`]: 10,
  [`${forum}>${officina}`]: 18,
  [`${officina}>${forum}`]: 20,
  [`${archivum}>${forum}`]: 14,
};

const copy: Record<string, string> = {
  "scene.officina.base": "A Officina Ardel guarda o silêncio familiar de vidro, metal e papel. Cada instrumento parece esperar uma pergunta melhor.",
  "scene.archivum.base": "O Archivum respira poeira, couro e tinta antiga. Catálogos e caixas formam corredores de memória imperfeita.",
  "scene.archivum.miriam": "Miriam trabalha em silêncio junto a uma mesa estreita. Ela levanta os olhos apenas quando percebe sua aproximação.",
  "scene.typographia.base": "A Typographia vibra com tipos móveis, papel e o cheiro mineral da tinta.",
  "scene.typographia.closed": "As portas da Typographia estão fechadas. O interior permanece escuro e imóvel atrás das vidraças.",
  "scene.forum.base": "O Forum reúne vozes, passos e notícias. Aqui, uma informação pode mudar de forma antes de atravessar a praça.",
  "scene.forum.miriam": "Miriam está entre mercadores e escribas, ouvindo mais do que fala enquanto observa o movimento da praça.",
};

function createChronicle(id: string): ChronicleSaveV2 {
  const chronicleId = id as ChronicleId;
  return {
    schemaVersion: 2,
    chronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 7 * 60 + 45 },
      locations: Object.fromEntries(
        locations.map(([locationId]) => [
          locationId,
          { id: locationId, illumination: locationId === officina ? "dim" : "lit", entityIds: [] },
        ]),
      ),
      entities: { [miriamId]: { id: miriamId, kind: "character", state: {} } },
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: officina,
        inventory: [],
        capabilities: { observatio: 0, litterae: 0, discernimentum: 0 },
      },
    },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "ignis-quaestio-investigation-1",
  };
}

function labelFor(id: string) {
  return locations.find(([key]) => key === id)?.[1] ?? id;
}

function formatTime(day: number, minute: number) {
  return `Dia ${day} · ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function appendEvent(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const id = `event.ui.${chronicle.eventLedger.length + 1}` as EventId;
  return {
    ...chronicle,
    eventLedger: [...chronicle.eventLedger, { id, type, occurredAt: chronicle.world.timestamp, payload }],
  };
}

function App() {
  const [chronicle, setChronicle] = useState<ChronicleSaveV2 | null>(null);
  const [summaries, setSummaries] = useState<readonly ChronicleBrowserSummary[]>([]);
  const [sessionState, setSessionState] = useState<"loading" | "menu" | "prologue" | "playing">("loading");
  const [liberOpen, setLiberOpen] = useState(false);
  const [storageState, setStorageState] = useState<"ready" | "saving" | "error">("ready");

  async function refreshSessions() {
    try {
      setSummaries(await listChroniclesFromBrowser());
      setStorageState("ready");
    } catch {
      setSummaries([]);
      setStorageState("error");
    }
  }

  useEffect(() => {
    void refreshSessions().finally(() => setSessionState("menu"));
  }, []);

  useEffect(() => {
    if (!chronicle || sessionState !== "playing") return;
    const handle = window.setTimeout(() => {
      setStorageState("saving");
      void saveChronicleToBrowser(chronicle)
        .then(() => setStorageState("ready"))
        .catch(() => setStorageState("error"));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [chronicle, sessionState]);

  async function continueChronicle(id: string) {
    const saved = await loadChronicleFromBrowser(id);
    if (!saved) return;
    setChronicle(saved);
    setSessionState("playing");
  }

  function newChronicle() {
    setChronicle(createChronicle(`chronicle.${Date.now().toString(36)}`));
    setSessionState("prologue");
  }

  function choosePrologue(path: ProloguePath) {
    if (!chronicle) return;
    setChronicle(applyProloguePath(chronicle, path));
    setSessionState("playing");
  }

  async function resetChronicle(id: string) {
    if (!window.confirm("Apagar esta Crônica? Esta ação remove apenas o save local selecionado.")) return;
    await deleteChronicleFromBrowser(id);
    await refreshSessions();
  }

  async function returnToMenu() {
    if (chronicle && sessionState === "playing") await saveChronicleToBrowser(chronicle);
    setChronicle(null);
    setLiberOpen(false);
    await refreshSessions();
    setSessionState("menu");
  }

  if (sessionState === "loading") {
    return <main className="shell session"><p className="eyebrow">HENUVOKODAN</p><h1>Abrindo o LIBER…</h1><footer>Tehkné Solutions</footer></main>;
  }

  if (sessionState === "menu" || !chronicle) {
    return (
      <main className="shell session">
        <p className="eyebrow">HENUVOKODAN</p>
        <h1>Crônicas da Obra Viva</h1>
        <section className="session-card">
          <h2>Escolha sua Crônica</h2>
          <button className="primary" onClick={newChronicle}>Nova Crônica</button>
          {summaries.length === 0 ? (
            <p className="note">Nenhuma Crônica preservada neste navegador.</p>
          ) : summaries.map((item) => (
            <div className="save-row" key={item.chronicleId}>
              <div><strong>{labelFor(item.currentLocation)}</strong><span>{formatTime(item.day, item.minuteOfDay)} · {item.eventCount} eventos</span></div>
              <div className="save-actions"><button onClick={() => void continueChronicle(item.chronicleId)}>Continuar</button><button onClick={() => void resetChronicle(item.chronicleId)}>Apagar</button></div>
            </div>
          ))}
        </section>
        <footer>Tehkné Solutions</footer>
      </main>
    );
  }

  if (sessionState === "prologue") {
    return (
      <main className="shell session prologue-screen">
        <p className="eyebrow">PRÓLOGO</p>
        <h1>{PROLOGUE_COPY.title}</h1>
        <section className="session-card prologue-card">
          <p className="prologue-opening">{PROLOGUE_COPY.opening}</p>
          <h2>{PROLOGUE_COPY.prompt}</h2>
          <div className="prologue-choices">
            {PROLOGUE_CHOICES.map((choice) => (
              <button key={choice.id} className="prologue-choice" onClick={() => choosePrologue(choice.id)}>
                <strong>{choice.title}</strong><span>{choice.body}</span>
              </button>
            ))}
          </div>
        </section>
        <footer>Tehkné Solutions</footer>
      </main>
    );
  }

  const persona = chronicle.personas[personaId as string]!;
  const location = persona.currentLocation;
  const now = chronicle.world.timestamp;
  const projection = projectAureaScene({
    world: chronicle.world,
    now,
    location: locationDefinitions[location as string]!,
    routines: [miriamRoutine],
    localNpcNarrative: { [miriamId]: location === archivum ? "scene.archivum.miriam" : "scene.forum.miriam" },
  });
  const knowledge = chronicle.knowledgeByPersona[personaId as string] ?? createEmptyKnowledgeState();
  const narrative = composeNarrative({ scene: projection.scene, perceived: [], knowledge });
  const ignis = projectIgnis(chronicle);
  const investigation = projectIgnisInvestigation(chronicle);
  const baseNarrative = narrative.textKeys.map((key) => copy[key] ?? key).join("\n\n");
  const narrativeText = ignis.active
    ? `${copy["scene.officina.base"]}\n\n${ignis.text}`
    : investigation.active
      ? `${baseNarrative}\n\n${investigation.text}`
      : baseNarrative;
  const liber = projectChronicleLiber(chronicle);
  const question = knowledge.questions["question.ignis.first-flame"];
  const nearby = locations.filter(([id]) => id !== location);

  function travel(to: LocationId) {
    const key = `${location}>${to}`;
    const reverse = `${to}>${location}`;
    const minutes = travelMinutes[key] ?? travelMinutes[reverse] ?? 15;
    setChronicle(appendEvent(
      travelChronicle(chronicle, personaId, { from: location, to, travelMinutes: minutes }).chronicle,
      "Travelled",
      { from: location, to, minutes },
    ));
  }

  function wait() {
    const timestamp = advanceWorldTimestamp(now, 15);
    setChronicle(appendEvent(
      { ...chronicle, world: { ...chronicle.world, timestamp } },
      "Waited",
      { minutes: 15, locationId: location },
    ));
  }

  function observe() {
    setChronicle((value) => value ? appendEvent(value, "ObservedLocation", { locationId: location }) : value);
  }

  function actIgnis(action: IgnisAction) {
    setChronicle((value) => value ? applyIgnisAction(value, action) : value);
  }

  function actInvestigation(action: IgnisInvestigationAction) {
    setChronicle((value) => value ? applyIgnisInvestigationAction(value, action) : value);
  }

  return (
    <main className="shell">
      <header>
        <div><p className="eyebrow">HENUVOKODAN</p><h1>Crônicas da Obra Viva</h1></div>
        <div><div className="clock">{formatTime(now.day, now.minuteOfDay)}</div><p className="note">{storageState === "saving" ? "Salvando Crônica…" : storageState === "error" ? "Persistência local indisponível" : "Crônica preservada"}</p></div>
      </header>

      <section className="book">
        <article className="page narrative">
          <p className="location">{labelFor(location)}</p>
          <p style={{ whiteSpace: "pre-line" }}>{narrativeText}</p>
          <div className="actions">
            {ignis.active && ignis.availableActions.map((action) => (
              <button className="ignis-action" key={action} onClick={() => actIgnis(action)}>{IGNIS_ACTION_LABEL[action]}</button>
            ))}
            {investigation.availableActions.map((action) => (
              <button className="ignis-action" key={action} onClick={() => actInvestigation(action)}>{IGNIS_INVESTIGATION_LABEL[action]}</button>
            ))}
            <button onClick={observe}>Observar</button>
            <button onClick={wait}>Esperar 15 min</button>
            <button onClick={() => setLiberOpen((value) => !value)}>LIBER</button>
            <button onClick={() => void returnToMenu()}>Voltar ao início</button>
          </div>
        </article>

        <aside className="page routes">
          <h2>{ignis.active && !ignis.completed ? "A mesa de trabalho" : ignis.active && !ignis.manuscriptRead ? "Sob a primeira chama" : investigation.active && !investigation.complete ? "Investigar a QUAESTIO" : "Para onde ir?"}</h2>
          {ignis.active && !ignis.completed ? (
            <>
              <p className="note">A primeira chama ainda não foi produzida. Você pode abandonar a experiência e voltar depois; o progresso permanece na Crônica.</p>
              <div className="ignis-state"><span>Óleo: {ignis.lamp.reservoirMaterialId ? "sim" : "não"}</span><span>Pavio: {ignis.lamp.wickMaterialId ? "sim" : "não"}</span><span>Saturação: {ignis.lamp.wickSaturation}</span></div>
            </>
          ) : ignis.active && !ignis.manuscriptRead ? (
            <p className="note">A luz agora permite transformar o manuscrito em conhecimento verificável. Examiná-lo registra evidência e abre a primeira QUAESTIO.</p>
          ) : (
            nearby.map(([id, label]) => <button key={id} onClick={() => travel(id)}>{label}</button>)
          )}
        </aside>
      </section>

      {liberOpen && (
        <section className="liber">
          <div><strong>DIARIUM</strong><span>{liber.diarium.length} entradas canônicas</span></div>
          <div><strong>MATERIA</strong><span>{liber.materiaNodeIds.length} materiais reconhecidos</span></div>
          <div><strong>QUAESTIONES</strong><span>{liber.questionIds.length} questões · {question?.status ?? "nenhuma ativa"}</span></div>
          <div><strong>EXPERIMENTA</strong><span>{liber.experiments.length} experimentos registrados</span></div>
        </section>
      )}

      <footer>Tehkné Solutions</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
