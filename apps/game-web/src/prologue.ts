import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type ProloguePath = "observatio" | "litterae" | "discernimentum";

export interface PrologueChoice {
  readonly id: ProloguePath;
  readonly title: string;
  readonly body: string;
}

export const PROLOGUE_COPY = Object.freeze({
  title: "Antes da Primeira Chama",
  opening: "A cidade ainda dorme quando você encontra a porta da Officina Ardel entreaberta. Sobre a mesa, uma lamparina apagada, um manuscrito incompleto e três modos possíveis de começar a procurar sentido.",
  prompt: "Qual impulso conduz seu primeiro passo?",
});

export const PROLOGUE_CHOICES: readonly PrologueChoice[] = Object.freeze([
  Object.freeze({
    id: "observatio",
    title: "Observar antes de tocar",
    body: "Você confia primeiro nos sinais do mundo: forma, posição, temperatura, ruído e ausência.",
  }),
  Object.freeze({
    id: "litterae",
    title: "Ler antes de agir",
    body: "Você procura palavras, marcas e relações entre textos antes de transformar matéria.",
  }),
  Object.freeze({
    id: "discernimentum",
    title: "Comparar antes de concluir",
    body: "Você parte da dúvida e procura contradições antes de aceitar qualquer explicação.",
  }),
]);

export function applyProloguePath(chronicle: ChronicleSaveV2, path: ProloguePath): ChronicleSaveV2 {
  const personaId = chronicle.activePersonaId as string;
  const persona = chronicle.personas[personaId];
  if (!persona) throw new Error(`Active persona not found: ${personaId}`);

  const capabilities = {
    ...persona.capabilities,
    [path]: Math.max(1, persona.capabilities[path] ?? 0),
  };

  return Object.freeze({
    ...chronicle,
    personas: Object.freeze({
      ...chronicle.personas,
      [personaId]: Object.freeze({ ...persona, capabilities: Object.freeze(capabilities) }),
    }),
    eventLedger: Object.freeze([
      ...chronicle.eventLedger,
      Object.freeze({
        id: `event.prologue.${chronicle.eventLedger.length + 1}` as never,
        type: "ProloguePathChosen",
        occurredAt: chronicle.world.timestamp,
        payload: Object.freeze({ path }),
      }),
    ]),
  });
}
