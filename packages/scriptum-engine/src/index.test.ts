import { describe, expect, it } from "vitest";
import type { EntityId } from "@hnk/domain";
import { observeScriptum, visibleProvenanceClaims, type ScriptumDocument } from "./index.js";

const manuscript = {
  entityId: "manuscript-01" as EntityId,
  materialKey: "paper.rag",
  layers: [
    { id: "surface", kind: "surface" as const },
    { id: "main-text", kind: "text" as const, textKey: "scriptum.ignis.manuscript.main", requires: { illumination: "lit" as const, litterae: 1 } },
    { id: "margin-a", kind: "marginalia" as const, textKey: "scriptum.ignis.manuscript.margin.a", requires: { illumination: "lit" as const, discernimentum: 2 } },
    { id: "tear", kind: "damage" as const, requires: { illumination: "dim" as const } },
  ],
  provenance: [
    { id: "prov-visible", claimKey: "provenance.paper_old" },
    { id: "prov-archivum", claimKey: "provenance.archivum_mark", sourceRef: "source.archivum.catalog" },
  ],
} satisfies ScriptumDocument;

describe("SCRIPTUM", () => {
  it("reveals document layers according to light and capability", () => {
    const dark = observeScriptum(manuscript, { illumination: "dark", litterae: 0, discernimentum: 0 });
    expect(dark.map((x) => x.layerId)).toEqual(["surface"]);

    const literate = observeScriptum(manuscript, { illumination: "lit", litterae: 1, discernimentum: 0 });
    expect(literate.map((x) => x.layerId)).toEqual(["surface", "main-text", "tear"]);

    const discerning = observeScriptum(manuscript, { illumination: "lit", litterae: 1, discernimentum: 2 });
    expect(discerning.map((x) => x.layerId)).toContain("margin-a");
  });

  it("does not reveal provenance that depends on an unknown source", () => {
    expect(visibleProvenanceClaims(manuscript, []).map((x) => x.id)).toEqual(["prov-visible"]);
    expect(visibleProvenanceClaims(manuscript, ["source.archivum.catalog"]).map((x) => x.id)).toEqual(["prov-visible", "prov-archivum"]);
  });
});
