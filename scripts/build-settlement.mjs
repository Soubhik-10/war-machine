import { build } from 'esbuild';
import { verifyRelease } from './verify-release.mjs';
verifyRelease();
await build({entryPoints:['settlement/signer.mjs','settlement/relay.mjs','settlement/operator.mjs','settlement/monitor.mjs'],outdir:'work/settlement-build',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],minify:true});
console.log('Signer, relay, operator and monitor Worker bundles validated.');
