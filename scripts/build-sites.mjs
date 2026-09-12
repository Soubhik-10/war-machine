import {build} from 'esbuild';
import {cp,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
await mkdir(resolve(dist,'server'),{recursive:true});
await build({entryPoints:[resolve(root,'sites','worker','index.mjs')],outfile:resolve(dist,'server','index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
await mkdir(resolve(dist,'.openai'),{recursive:true});
await cp(resolve(root,'.openai','hosting.json'),resolve(dist,'.openai','hosting.json'));
