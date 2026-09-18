import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};
await writeFile(
  resolve(dist, "TEMPO-SETUP.md"),
  await readFile(resolve(root, "docs", "TEMPO-SETUP.md"), "utf8"),
);
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(resolve(directory, entry.name))
          : entry.isFile()
            ? [resolve(directory, entry.name)]
            : [],
      ),
    )
  ).flat();
}
const assets = {};
for (const file of await files(dist)) {
  const path = "/" + relative(dist, file).replaceAll("\\", "/");
  if (path.startsWith("/server/") || path.startsWith("/.openai/")) continue;
  const content = await readFile(file, "utf8");
  assets[path] = [
    content,
    mime[extname(file)] || "application/octet-stream",
    createHash("sha256").update(content).digest("hex").slice(0, 16),
  ];
}
await writeFile(
  resolve(root, "sites", "worker", "static-assets.mjs"),
  `const assets=${JSON.stringify(assets)};\nexport function serveStaticAsset(request){const path=new URL(request.url).pathname==='/'?'/index.html':new URL(request.url).pathname,asset=assets[path];if(!asset)return new Response('Not found.',{status:404,headers:{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'}});const etag=\`"\${asset[2]}"\`,headers={'content-type':asset[1],'cache-control':path==='/index.html'?'no-cache':'public, max-age=60, stale-while-revalidate=86400','etag':etag,'x-content-type-options':'nosniff'};return request.headers.get('if-none-match')===etag?new Response(null,{status:304,headers}):new Response(asset[0],{headers});}\n`,
);
await mkdir(resolve(dist, "server"), { recursive: true });
await build({
  entryPoints: [resolve(root, "sites", "worker", "index.mjs")],
  outfile: resolve(dist, "server", "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  alias: {
    "node:util": resolve(root, "sites", "worker", "node-util-shim.mjs"),
  },
});
const workerBundlePath = resolve(dist, "server", "index.js");
const workerBundle = await readFile(workerBundlePath, "utf8");
if (!workerBundle.includes("war_machines_get_rules")) {
  throw new Error("MCP tools are missing from the Worker bundle.");
}
await mkdir(resolve(dist, ".openai"), { recursive: true });
await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(dist, ".openai", "hosting.json"),
);
