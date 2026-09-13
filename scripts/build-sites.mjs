import { build } from "esbuild";
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
  assets[path] = [
    await readFile(file, "utf8"),
    mime[extname(file)] || "application/octet-stream",
  ];
}
await writeFile(
  resolve(root, "sites", "worker", "static-assets.mjs"),
  `const assets=${JSON.stringify(assets)};\nexport function serveStaticAsset(request){const path=new URL(request.url).pathname==='/'?'/index.html':new URL(request.url).pathname,asset=assets[path];return asset?new Response(asset[0],{headers:{'content-type':asset[1],'cache-control':'no-cache','x-content-type-options':'nosniff'}}):new Response('Not found.',{status:404,headers:{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'}});}\n`,
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
await mkdir(resolve(dist, ".openai"), { recursive: true });
await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(dist, ".openai", "hosting.json"),
);
