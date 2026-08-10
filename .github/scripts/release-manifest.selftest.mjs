import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repo = process.cwd();
const script = resolve(repo, "apps/game-web/scripts/write-release-manifest.mjs");

async function runCase(name, env, expectedSha, expectedSource) {
  const cwd = await mkdtemp(join(tmpdir(), `hnk-release-manifest-${name}-`));
  try {
    const code = await new Promise((resolveCode, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd,
        stdio: "inherit",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          ...env,
        },
      });
      child.once("error", reject);
      child.once("exit", (value) => resolveCode(value ?? 1));
    });
    if (code !== 0) throw new Error(`${name}: manifest writer exited ${code}`);
    const manifest = JSON.parse(await readFile(join(cwd, "public", "release.json"), "utf8"));
    if (manifest.buildSha !== expectedSha) throw new Error(`${name}: expected SHA ${expectedSha}, got ${manifest.buildSha}`);
    if (manifest.buildShaSource !== expectedSource) throw new Error(`${name}: expected source ${expectedSource}, got ${manifest.buildShaSource}`);
    if (manifest.signature !== "Tehkné Solutions") throw new Error(`${name}: invalid signature`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const renderSha = "1".repeat(40);
const staleHnkSha = "2".repeat(40);
const githubSha = "3".repeat(40);

await runCase(
  "render-canonical",
  { RENDER: "true", RENDER_GIT_COMMIT: renderSha, HNK_BUILD_SHA: staleHnkSha, GITHUB_SHA: githubSha },
  renderSha,
  "RENDER_GIT_COMMIT",
);
await runCase("hnk-fallback", { HNK_BUILD_SHA: staleHnkSha, GITHUB_SHA: githubSha }, staleHnkSha, "HNK_BUILD_SHA");
await runCase("github-fallback", { GITHUB_SHA: githubSha }, githubSha, "GITHUB_SHA");
await runCase("development-fallback", {}, "development", "development");

console.log("release manifest identity self-test: PASS");
