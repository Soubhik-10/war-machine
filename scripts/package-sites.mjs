import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyRelease } from "./verify-release.mjs";

verifyRelease();
const run = promisify(execFile),
  root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = resolve(
  process.argv[2] || resolve(root, "..", "war-machines-site.tar.gz"),
);
const stage = resolve(root, "work", "sites-package");
const sourceHosting = resolve(root, ".openai", "hosting.json");
const builtHosting = resolve(root, "dist", ".openai", "hosting.json");
const worker = resolve(root, "dist", "server", "index.js");

await Promise.all([
  access(sourceHosting),
  access(builtHosting),
  access(worker),
  access(resolve(root, "drizzle")),
]);
const [source, built] = await Promise.all([
  readFile(sourceHosting, "utf8"),
  readFile(builtHosting, "utf8"),
]);
if (source !== built)
  throw Error(
    "The built and source hosting manifests differ. Run build:sites before packaging.",
  );
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(resolve(root, "dist"), resolve(stage, "dist"), { recursive: true });
await mkdir(resolve(stage, "dist", ".openai", "drizzle"), { recursive: true });
await cp(
  resolve(root, "drizzle"),
  resolve(stage, "dist", ".openai", "drizzle"),
  { recursive: true },
);
await writeFile(resolve(stage, "dist", ".openai", "hosting.json"), source);
await mkdir(dirname(archive), { recursive: true });
await run("tar", ["-C", stage, "-czf", archive, "dist"], { windowsHide: true });
const { stdout } = await run("tar", ["-tzf", archive], { windowsHide: true });
for (const required of [
  "dist/server/index.js",
  "dist/.openai/hosting.json",
  "dist/.openai/drizzle/0000_war_machines.sql",
  "dist/.openai/drizzle/0001_tempo_mainnet.sql",
  "dist/.openai/drizzle/0002_direct_escrow.sql",
  "dist/.openai/drizzle/0003_paid_reveal.sql",
  "dist/.openai/drizzle/0007_attempt_identity.sql",
  "dist/.openai/drizzle/0008_escrow_policy_identity.sql",
  "dist/.openai/drizzle/0009_board_pagination.sql",
  "dist/.openai/drizzle/0010_free_email_challenges.sql",
])
  if (!stdout.split(/\r?\n/).includes(required))
    throw Error(`Archive is missing ${required}.`);
console.log(archive);
