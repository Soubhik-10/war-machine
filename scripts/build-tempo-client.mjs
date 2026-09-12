import {build} from 'esbuild';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await build({absWorkingDir:root,entryPoints:[resolve(root,'scripts/tempo-client-entry.mjs')],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:resolve(root,'dist/tempo-client.mjs'),minify:true,sourcemap:false,legalComments:'none'});
