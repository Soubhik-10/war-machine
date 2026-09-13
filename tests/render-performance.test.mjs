import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, battleScene, VERTEX_STRIDE } from '../dist/renderer.mjs';
import { Battle } from '../dist/engine.mjs';
import { PRESETS } from '../dist/data.mjs';
test('arena environment stays shared, finite and separate from mutable battle geometry',()=>{
  const battle=new Battle(PRESETS[0],PRESETS[1],'foundry',7),first=battleScene(battle);battle.step();const second=battleScene(battle);
  assert.equal(first.staticVertices,second.staticVertices);
  assert.notEqual(first.vertices,second.vertices);
  assert.ok(first.staticVertices.every(Number.isFinite));assert.equal(first.staticVertices.length%(VERTEX_STRIDE*3),0);
});
test('steady-state renderer uploads only dynamic geometry and frees both buffers',t=>{
  let next=0;const uploads=[],deleted=[];
  const gl=new Proxy({ARRAY_BUFFER:1,STATIC_DRAW:2,DYNAMIC_DRAW:3,VERTEX_SHADER:4,FRAGMENT_SHADER:5,COMPILE_STATUS:6,LINK_STATUS:7,
    createBuffer:()=>++next,createShader:()=>1,createProgram:()=>1,getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:()=>0,
    bufferData:(target,data,usage)=>uploads.push({data,usage}),deleteBuffer:id=>deleted.push(id),
  },{get:(target,key)=>target[key] || (()=>{})});
  const canvas={width:640,height:480,getContext:()=>gl,getBoundingClientRect:()=>({left:0,top:0,width:640,height:480})};
  const prior=globalThis.window;globalThis.window={devicePixelRatio:2};t.after(()=>{globalThis.window=prior;});
  const renderer=new Renderer(canvas),battle=new Battle(PRESETS[0],PRESETS[1],'foundry',7);
  const geometry=battleScene(battle);renderer.render(geometry);const initial=uploads.length;renderer.render(geometry);
  assert.equal(uploads.length,initial);assert.equal(uploads.filter(x=>x.usage===gl.STATIC_DRAW).length,1);
  assert.equal(canvas.width,960);renderer.dispose();assert.equal(deleted.length,2);
});
