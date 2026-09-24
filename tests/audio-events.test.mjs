import test from "node:test";
import assert from "node:assert/strict";
import { AudioDirector, MusicDirector } from "../dist/audio.mjs";

class Node { constructor() { this.gain = { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} }; this.frequency = { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){} }; } connect(){} disconnect(){} start(){} stop(){ this.onended?.(); } }
class Context { constructor(){ this.state="running"; this.currentTime=0; this.sampleRate=8000; this.destination={}; } createGain(){return new Node()} createDynamicsCompressor(){return new Node()} createOscillator(){return new Node()} createBufferSource(){return new Node()} createBiquadFilter(){return new Node()} createBuffer(){return {getChannelData:()=>new Float32Array(8)}} async resume(){this.state="running"} }
const event = (seq, weapon="cannon", t=seq/60) => ({ seq, t, kind:"fire", side:seq%2, moduleUid:seq, weapon, x:0, y:0, h:0 });
test("sequenced events are consumed once, including identical simultaneous weapons", async () => { const a=new AudioDirector({AudioContext:Context}); a.setPreference({enabled:true}); await a.resumeFromGesture(); a.ingest([event(1),event(2)]); a.drain(); assert.equal(a.stats.consumed,2); a.ingest([event(2),event(3)]); a.drain(); assert.equal(a.stats.consumed,3); assert.equal(a.stats.duplicate,1); });
test("accelerated gatling bursts are deliberately coalesced and queue/voice caps are accounted", async () => { const a=new AudioDirector({AudioContext:Context,maxQueue:3,maxVoices:0}); a.setPreference({enabled:true}); await a.resumeFromGesture(); const burst=[event(1,"gatling",1),event(2,"gatling",1.01),event(3,"gatling",1.02),event(4,"gatling",1.03)].map(e=>({...e,side:0})); a.ingest(burst); a.drain({speed:4}); assert.equal(a.stats.received,4); assert.equal(a.stats.dropped,3); assert.equal(a.stats.coalesced,2); assert.equal(a.stats.consumed,1); });
test("mute, suspension, and battle restart discard backlog instead of replaying stale combat", async () => { const a=new AudioDirector({AudioContext:Context}); a.setPreference({enabled:true}); await a.resumeFromGesture(); a.ingest([event(1)]); a.setPreference({enabled:false}); assert.equal(a.queue.length,0); a.setPreference({enabled:true}); a.context.state="suspended"; a.ingest([event(2)]); assert.equal(a.stats.stale,2); a.reset(); assert.equal(a.lastSeq,0); assert.equal(a.queue.length,0); });
test("weapon-specific impacts and thermal transitions stay in the bounded SFX queue", async () => { const a=new AudioDirector({AudioContext:Context}); a.setPreference({enabled:true}); await a.resumeFromGesture(); a.ingest([event(1,"laser"),{seq:2,t:.04,kind:"impact",weapon:"laser"},{seq:3,t:.08,kind:"fire",weapon:"rocket"},{seq:4,t:.12,kind:"impact",weapon:"rocket"},{seq:5,t:.16,kind:"thermal",phase:"purge"},{seq:6,t:.2,kind:"thermal",phase:"lockout"}]); a.drain(); assert.equal(a.stats.consumed,6); assert.equal(a.queue.length,0); });

class Media {
  static created = [];
  constructor(src) { this.src=src; this.paused=true; this.ended=false; this.volume=0; this.currentTime=0; Media.created.push(this); }
  async play() { this.paused=false; return true; }
  pause() { this.paused=true; }
}
const tracks = {
  general: { src:"general.ogg", loop:true, gain:.5 },
  battle: { src:"battle.ogg", loop:true, gain:.4 },
  victory: { src:"victory.ogg", loop:false, gain:.7 },
  defeat: { src:"defeat.ogg", loop:false, gain:.65 },
};
test("music state changes use a separate reusable streaming path from combat effects", async () => {
  Media.created.length=0;
  const music=new MusicDirector({Audio:Media,tracks,fadeMs:0});
  music.setPreference({enabled:true,volume:1});
  assert.equal(await music.play("general"),true);
  const general=music.current.element;
  assert.equal(general.loop,true);
  assert.equal(general.volume,.5);
  assert.equal(await music.play("battle"),true);
  assert.equal(general.paused,true);
  assert.equal(music.current.kind,"battle");
  assert.equal(music.current.element.volume,.4);
  await music.play("victory",{restart:true});
  assert.equal(music.current.element.loop,false);
  await music.play("defeat",{restart:true});
  assert.equal(music.current.kind,"defeat");
  assert.equal(music.current.element.loop,false);
  assert.equal(Media.created.length,4);
});
test("music pauses without losing its cue and mute stops every cached track", async () => {
  const music=new MusicDirector({Audio:Media,tracks,fadeMs:0});
  music.setPreference({enabled:true,volume:.8});
  await music.play("battle");
  music.hold("battle-paused",true);
  assert.equal(music.current.element.paused,true);
  music.hold("battle-paused",false);
  await Promise.resolve();
  assert.equal(music.current.element.paused,false);
  music.setPreference({enabled:false});
  assert.equal(music.status,"muted");
  assert.ok([...music.media.values()].every((element)=>element.paused&&element.volume===0));
});
