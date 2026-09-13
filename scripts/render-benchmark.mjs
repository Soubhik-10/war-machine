import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Battle } from '../dist/engine.mjs';
import { PRESETS } from '../dist/data.mjs';
import { battleScene } from '../dist/scenes.mjs';
await mkdir(new URL('../work/render-baseline/',import.meta.url),{recursive:true});
for(const name of ['renderer','scenes'])await writeFile(new URL('../work/render-baseline/'+name+'.mjs',import.meta.url),execFileSync('git',['show','HEAD:dist/'+name+'.mjs'],{windowsHide:true}));
for(const name of ['data','engine'])await copyFile(new URL('../dist/'+name+'.mjs',import.meta.url),new URL('../work/render-baseline/'+name+'.mjs',import.meta.url));
const {battleScene:baseline}=await import('../work/render-baseline/scenes.mjs');
const rows=[];
for(const [label,scene] of [['before',baseline],['after',battleScene]]) {
  const battle=new Battle(PRESETS[8],PRESETS[9],'foundry',19);for(let n=0;n<60;n++)battle.step();
  for(let n=0;n<12;n++)scene(battle);
  const samples=[];let dynamicBytes=0,staticBytes=0;
  for(let n=0;n<100;n++) {const start=performance.now(),g=scene(battle);new Float32Array(g.vertices);samples.push(performance.now()-start);dynamicBytes=g.vertices.length*4;staticBytes=(g.staticVertices?.length || 0)*4;}
  samples.sort((a,b)=>a-b);rows.push({label,sceneAndConversionMedianMs:samples[50],p95Ms:samples[95],perFrameUploadBytes:dynamicBytes,oneTimeUploadBytes:staticBytes});
}
console.log(JSON.stringify(rows,null,2));
await writeFile(new URL('../work/render-benchmark.json',import.meta.url),JSON.stringify(rows,null,2));
