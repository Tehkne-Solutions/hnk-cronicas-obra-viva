export const PACK00_ART_FOUNDATION = Object.freeze({
  packId: "PACK-00",
  version: "1.0.0-candidate",
  status: "candidate-applied",
  signature: "Tehkné Solutions",
  assets: Object.freeze({
    mentorPortrait: "/pack00/characters/mentor-neutral.webp",
    sparkPortrait: "/pack00/characters/spark-curious.webp",
    fireIcon: "/pack00/elements/fire-icon.svg",
    fireSigil: "/pack00/elements/fire-sigil.svg",
    waterIcon: "/pack00/elements/water-icon.svg",
    waterSigil: "/pack00/elements/water-sigil.svg",
    alchemySlot: "/pack00/ui/alchemy-slot.svg",
    dialogueFrame: "/pack00/ui/dialogue-frame.svg",
    ornamentCorner: "/pack00/ornaments/corner.svg",
    ornamentSeparator: "/pack00/ornaments/separator.svg",
    ornamentSeal: "/pack00/ornaments/seal.svg",
    ornamentFrame: "/pack00/ornaments/frame-motif.svg",
  }),
  pending: Object.freeze({ laboratory: "FND-08 laboratory artwork pending binary materialization; visual language is applied without substitute art." }),
  policy: Object.freeze({ gradients: false, glow: false, appLikeUi: false, runtimeStatus: "candidate" }),
});
export type Pack00RuntimeAsset = keyof typeof PACK00_ART_FOUNDATION.assets;
export function pack00Asset(name: Pack00RuntimeAsset): string { return PACK00_ART_FOUNDATION.assets[name]; }
