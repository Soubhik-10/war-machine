import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Git uses LF; Windows editors may use CRLF. Both compile to the same simulation.
export function hashSimulationSources(engine,data){return createHash('sha256').update(engine.replace(/\r\n/g,'\n')).update(data.replace(/\r\n/g,'\n')).digest('hex');}
export function simulationHash(){return hashSimulationSources(readFileSync(new URL('../dist/engine.mjs',import.meta.url),'utf8'),readFileSync(new URL('../dist/data.mjs',import.meta.url),'utf8'));}
