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
import { createLiberState, syncLiberKnowledge } from "@hnk/liber-engine";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { loadChronicleFromBrowser, saveChronicleToBrowser } from "./storage.js";
import "./styles.css";

const personaId = "persona.player" as PersonaId;
const chronicleId = "chronicle.playable-shell" as ChronicleId;
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

function createChronicle(): ChronicleSaveV2 {
  const knowledge = createEmptyKnowledgeState();
  return {
    schemaVersion: 2,
    chronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 8 * 60 + 30 },
      locations: Object.fromEntries(locations.map(([id]) => [id, { id, illumination: "lit", entityIds: [] }])),
      entities: {
        [miriamId]: { id: miriamId, kind: "character", state: {} },
      },
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: officina,
        inventory: [],
        capabilities: { observatio: 1, litterae: 1, discernimentum: 1 },
      },
    },
    knowledgeByPersona: { [personaId]: knowledge },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "playable-shell-browser-persistence-1",
  };
}

function labelFor(id: string) {
  return locations.find(([key]) => key === id)?.[1] ?? id;
}

function formatTime(day: number, minute: number) {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `Dia ${day} · ${hh}:${mm}`;
}

function appendEvent(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const id = `event.ui.${chronicle.eventLedger.length + 1}` as EventId;
  return {
    ...chronicle,
    eventLedger: [
      ...chronicle.eventLedger,
      { id, type, occurredAt: chronicle.world.timestamp, payload },
    ],
  };
}

function App() {
  const [chronicle, setChronicle] = useState<ChronicleSaveV2 | null>(null);
  const [liberOpen, setLiberOpen] = useState(false);
  const [storageState, setStorageState] = useState<"loading" | "ready" | "saving" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    void loadChronicleFromBrowser(chronicleId as string)
      .then((saved) => {
        if (cancelled) return;
        setChronicle(saved ?? createChronicle());
        setStorageState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setChronicle(createChronicle());
        setStorageState("error");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!chronicle || storageState === "loading") return;
    const handle = window.setTimeout(() => {
      setStorageState("saving");
      void saveChronicleToBrowser(chronicle)
        .then(() => setStorageState("ready"))
        .catch(() => setStorageState("error"));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [chronicle]);

  if (!chronicle) {
    return <main className="shell"><p className="eyebrow">HENUVOKODAN</p><h1>Reabrindo a Crônica…</h1><footer>Tehkné Solutions</footer></main>;
  }

  const persona = chronicle.personas[personaId as string]!;
  const location = persona.currentLocation;
  const now = chronicle.world.timestamp;
  const definition = locationDefinitions[location as string]!;
  const projection = projectAureaScene({
    world: chronicle.world,
    now,
    location: definition,
    routines: [miriamRoutine],
    localNpcNarrative: { [miriamId]: location === archivum ? "scene.archivum.miriam" : "scene.forum.miriam" },
  });

  const knowledge = chronicle.knowledgeByPersona[personaId as string] ?? createEmptyKnowledgeState();
  const narrative = composeNarrative({ scene: projection.scene, perceived: [], knowledge });
  const narrativeText = narrative.textKeys.map((key) => copy[key] ?? key).join("\n\n");
  const liber = syncLiberKnowledge(createLiberState(), knowledge);
  const nearby = locations.filter(([id]) => id !== location);

  function travel(to: LocationId) {
    const key = `${location}>${to}`;
    const reverse = `${to}>${location}`;
    const minutes = travelMinutes[key] ?? travelMinutes[reverse] ?? 15;
    const result = travelChronicle(chronicle, personaId, { from: location, to, travelMinutes: minutes });
    setChronicle(appendEvent(result.chronicle, "Travelled", { from: location, to, minutes }));
  }

  function wait() {
    const timestamp = advanceWorldTimestamp(now, 15);
    const next = {
      ...chronicle,
      world: { ...chronicle.world, timestamp },
    } satisfies ChronicleSaveV2;
    setChronicle(appendEvent(next, "Waited", { minutes: 15, locationId: location }));
  }

  function observe() {
    setChronicle((value) => value ? appendEvent(value, "ObservedLocation", { locationId: location }) : value);
  }

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">HENUVOKODAN</p>
          <h1>Crônicas da Obra Viva</h1>
        </div>
        <div>
          <div className="clock">{formatTime(now.day, now.minuteOfDay)}</div>
          <p className="note" aria-live="polite">{storageState === "saving" ? "Salvando Crônica…" : storageState === "error" ? "Persistência local indisponível" : "Crônica preservada"}</p>
        </div>
      </header>

      <section className="book">
        <article className="page narrative">
          <p className="location">{labelFor(location)}</p>
          <p style={{ whiteSpace: "pre-line" }}>{narrativeText}</p>
          <div className="actions">
            <button onClick={observe}>Observar</button>
            <button onClick={wait}>Esperar 15 min</button>
            <button onClick={() => setLiberOpen((value) => !value)}>LIBER</button>
          </div>
        </article>

        <aside className="page routes">
          <h2>Para onde ir?</h2>
          {nearby.map(([id, label]) => (
            <button key={id} onClick={() => travel(id)}>{label}</button>
          ))}
          <p className="note">Viajar consome tempo. Pessoas, locais e consequências podem mudar enquanto você está a caminho.</p>
        </aside>
      </section>

      {liberOpen && (
        <section className="liber">
          <div><strong>DIARIUM</strong><span>{chronicle.eventLedger.length} eventos preservados na Crônica</span></div>
          <div><strong>MATERIA</strong><span>{liber.materiaNodeIds.length} materiais reconhecidos</span></div>
          <div><strong>QUAESTIONES</strong><span>{liber.questionIds.length} questões registradas</span></div>
          <div><strong>EXPERIMENTA</strong><span>{liber.experiments.length} experimentos reconstruídos</span></div>
        </section>
      )}

      <footer>Tehkné Solutions</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
