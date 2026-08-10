import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const renderGitCommit = (process.env.RENDER_GIT_COMMIT ?? "").trim();
const hnkBuildSha = (process.env.HNK_BUILD_SHA ?? "").trim();
const githubSha = (process.env.GITHUB_SHA ?? "").trim();

const [buildSha, buildShaSource] = renderGitCommit
  ? [renderGitCommit, "RENDER_GIT_COMMIT"]
  : hnkBuildSha
    ? [hnkBuildSha, "HNK_BUILD_SHA"]
    : githubSha
      ? [githubSha, "GITHUB_SHA"]
      : ["development", "development"];

const release =
  process.env.HNK_RELEASE ??
  (process.env.RENDER === "true" ? "production" : "development");
const manifest = {
  schemaVersion: 1,
  buildSha,
  buildShaSource,
  release,
  builtAt: new Date().toISOString(),
  signature: "Tehkné Solutions",
};

await mkdir(resolve(root, "public"), { recursive: true });
await writeFile(resolve(root, "public", "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`release manifest: ${buildSha} via ${buildShaSource} (${release})`);
