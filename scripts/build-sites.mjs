import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./verify-release.mjs";

verifyRelease();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ogg": "audio/ogg",
};
const binaryExtensions = new Set([".ogg"]);
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
  const extension = extname(file);
  const binary = binaryExtensions.has(extension);
  const bytes = await readFile(file);
  const content = binary ? bytes.toString("base64") : bytes.toString("utf8");
  assets[path] = [
    content,
    mime[extension] || "application/octet-stream",
    createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    binary,
  ];
}
await writeFile(
  resolve(root, "sites", "worker", "static-assets.mjs"),
  `const assets=${JSON.stringify(assets)},decoded=new Map();
function bytes(path,asset){if(!asset[3])return asset[0];if(decoded.has(path))return decoded.get(path);const raw=atob(asset[0]),value=Uint8Array.from(raw,c=>c.charCodeAt(0));decoded.set(path,value);return value;}
export function serveStaticAsset(request){const urlPath=new URL(request.url).pathname,path=urlPath==='/'?'/index.html':urlPath,asset=assets[path];if(!asset)return new Response('Not found.',{status:404,headers:{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'}});const etag=\`"\${asset[2]}"\`,headers={'content-type':asset[1],'cache-control':path==='/index.html'?'no-cache':'public, max-age=60, stale-while-revalidate=86400','etag':etag,'x-content-type-options':'nosniff'};if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});let body=bytes(path,asset),status=200;if(asset[3]){headers['accept-ranges']='bytes';const range=request.headers.get('range')?.match(/^bytes=(\\d+)-(\\d*)$/);if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;if(start>=body.length||end<start)return new Response(null,{status:416,headers:{...headers,'content-range':\`bytes */\${body.length}\`}});headers['content-range']=\`bytes \${start}-\${end}/\${body.length}\`;body=body.slice(start,end+1);status=206;}headers['content-length']=String(body.length);}return new Response(request.method==='HEAD'?null:body,{status,headers});}
`,
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
