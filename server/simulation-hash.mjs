import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Git uses LF; Windows editors may use CRLF. Both compile to the same simulation.
export function hashSimulationSources(engine,data){return createHash('sha256').update(engine.replace(/\r\n/g,'\n')).update(data.replace(/\r\n/g,'\n')).digest('hex');}
// The legacy hash covers exactly these two files. Refuse new imports until a
// separately versioned manifest hash covers their complete dependency graph.
export function assertSimulationSourceGraph(engine,data){
  for(const [name,source,allowed] of [['engine',engine,'./data.mjs'],['data',data,null]]){
    if(/\bimport\s*\(|\brequire\s*\(/.test(source))throw Error(`Unsupported ${name} simulation dependency`);
    for(const line of source.split(/\r?\n/)){
      const imports=[...line.matchAll(/\bimport\b/g)];
      const reexports=[...line.matchAll(/\bexport\s+(?:\*|\{)/g)];
      if(!imports.length&&!reexports.length)continue;
      if(imports.length+reexports.length!==1||!/^\s*(?:import\b|export\s+(?:\*|\{))/.test(line))
        throw Error(`Unsupported ${name} simulation dependency: ${line.trim()}`);
      const match=line.match(/\bfrom\s*['"]([^'"]+)['"]\s*;?\s*$/);
      if(!match||match[1]!==allowed)throw Error(`Unsupported ${name} simulation dependency: ${line.trim()}`);
    }
  }
}
export function simulationHash(){
  const engine=readFileSync(new URL('../dist/engine.mjs',import.meta.url),'utf8');
  const data=readFileSync(new URL('../dist/data.mjs',import.meta.url),'utf8');
  assertSimulationSourceGraph(engine,data);
  return hashSimulationSources(engine,data);
}
