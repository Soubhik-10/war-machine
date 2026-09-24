import { readdirSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const suites = ["test:simulation", "test:agents", "test:payments", "test:app"];
const declared = suites.flatMap((suite) => {
  const command = packageJson.scripts[suite];
  if (typeof command !== "string") throw new Error(`Missing npm script: ${suite}`);
  return [...command.matchAll(/(?:^|\s)(tests\/[^\s]+\.test\.mjs)(?=\s|$)/g)].map((match) => match[1].slice("tests/".length));
});
const files = readdirSync(new URL("../tests/", import.meta.url)).filter((file) => file.endsWith(".test.mjs"));
const counts = new Map();
for (const file of declared) counts.set(file, (counts.get(file) ?? 0) + 1);
const missing = files.filter((file) => counts.get(file) !== 1);
const unknown = declared.filter((file) => !files.includes(file));

if (missing.length || unknown.length) {
  throw new Error(
    [
      missing.length ? `Missing or multiply assigned: ${missing.join(", ")}` : "",
      unknown.length ? `Unknown test files: ${unknown.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
  );
}

console.log(`${files.length} Node test files are covered once across ${suites.length} suites.`);
