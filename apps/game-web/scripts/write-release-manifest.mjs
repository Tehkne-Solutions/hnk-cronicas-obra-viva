import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const out = resolve(process.cwd(), "public", "release.json");
const buildSha = process.env.HNK_BUILD_SHA ?? process.env.GITHUB_SHA ?? "development";
const release = process.env.HNK_RELEASE ?? "development";
const builtAt = new Date().toISOString();

await mkdir(resolve(process.cwd(), "public"), { recursive: true });
await writeFile(out, `${JSON.stringify({
  schemaVersion: 1,
  buildSha,
  release,
  builtAt,
  signature: "Tehkné Solutions",
}, null, 2)}\n`);

console.log(`release manifest: ${buildSha} (${release})`);
