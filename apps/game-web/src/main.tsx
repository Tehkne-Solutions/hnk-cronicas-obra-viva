import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LocationId } from "@hnk/domain";
import "./styles.css";

const locations = [
  ["aurea.officina", "Officina Ardel"],
  ["aurea.archivum", "Archivum"],
  ["aurea.typographia", "Typographia"],
  ["aurea.forum", "Forum"],
] as const;

const travelMinutes: Record<string, number> = {
  "aurea.officina>aurea.archivum": 15,
  "aurea.archivum>aurea.typographia": 12,
  "aurea.typographia>aurea.forum": 10,
  "aurea.forum>aurea.officina": 18,
  "aurea.officina>aurea.forum": 20,
  "aurea.archivum>aurea.forum": 14,
};

function labelFor(id: string) {
  return locations.find(([key]) => key === id)?.[1] ?? id;
}

function formatTime(total: number) {
  const minute = total % 1440;
  const day = Math.floor(total / 1440) + 1;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `Dia ${day} · ${hh}:${mm}`;
}

function App() {
  const [location, setLocation] = useState<LocationId>("aurea.officina" as LocationId);
  const [time, setTime] = useState(8 * 60 + 30);
  const [liberOpen, setLiberOpen] = useState(false);
  const [history, setHistory] = useState<string[]>(["Você desperta a Officina Ardel para mais um dia de investigação."]);

  const nearby = useMemo(() => locations.filter(([id]) => id !== location), [location]);
  const narrative = history.at(-1) ?? "A cidade aguarda.";

  function travel(to: string) {
    const key = `${location}>${to}`;
    const reverse = `${to}>${location}`;
    const minutes = travelMinutes[key] ?? travelMinutes[reverse] ?? 15;
    const next = time + minutes;
    setTime(next);
    setLocation(to as LocationId);
    setHistory((items) => [...items, `Você atravessa Aurea por ${minutes} minutos e chega a ${labelFor(to)}.`]);
  }

  function wait() {
    setTime((value) => value + 15);
    setHistory((items) => [...items, "Você espera quinze minutos, observando o ritmo da cidade mudar ao redor."]);
  }

  function observe() {
    setHistory((items) => [...items, `Você observa ${labelFor(location)} com atenção, procurando algo que antes pudesse ter passado despercebido.`]);
  }

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">HENUVOKODAN</p>
          <h1>Crônicas da Obra Viva</h1>
        </div>
        <div className="clock">{formatTime(time)}</div>
      </header>

      <section className="book">
        <article className="page narrative">
          <p className="location">{labelFor(location)}</p>
          <p>{narrative}</p>
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
          <p className="note">Viajar consome tempo. Pessoas e locais podem mudar enquanto você está a caminho.</p>
        </aside>
      </section>

      {liberOpen && (
        <section className="liber">
          <div><strong>DIARIUM</strong><span>{history.length} registros</span></div>
          <div><strong>MATERIA</strong><span>Em construção</span></div>
          <div><strong>QUAESTIONES</strong><span>Como compreender o que esta cidade está tentando revelar?</span></div>
          <div><strong>EXPERIMENTA</strong><span>Registros preservados pela Crônica</span></div>
        </section>
      )}

      <footer>Tehkné Solutions</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
