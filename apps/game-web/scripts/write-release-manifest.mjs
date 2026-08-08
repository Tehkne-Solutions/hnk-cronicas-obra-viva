import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const buildSha =
  process.env.HNK_BUILD_SHA ??
  process.env.GITHUB_SHA ??
  process.env.RENDER_GIT_COMMIT ??
  "development";
const release =
  process.env.HNK_RELEASE ??
  (process.env.RENDER === "true" ? "production" : "development");
const manifest = {
  schemaVersion: 1,
  buildSha,
  release,
  builtAt: new Date().toISOString(),
  signature: "Tehkné Solutions",
};

await mkdir(resolve(root, "public"), { recursive: true });
await writeFile(resolve(root, "public", "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`release manifest: ${buildSha} (${release})`);
