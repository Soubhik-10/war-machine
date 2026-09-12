import {build} from 'esbuild';
await build({entryPoints:['scripts/tempo-client-entry.mjs'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:'dist/tempo-client.mjs',minify:true,sourcemap:false,legalComments:'none'});
