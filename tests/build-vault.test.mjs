import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {packChallenge,PRESETS} from '../dist/data.mjs';

const body=(name,preset=0)=>({name,blueprint:packChallenge(PRESETS[preset],'foundry',0)});

test('an owner can retain multiple account-scoped builds without duplicate retry records',t=>{
 const store=new Store(':memory:',{seed:false});t.after(()=>store.close());
 const owner=store.session({name:'Owner'}),auth=store.auth(owner.token),first=body('Scout'),key=randomUUID();
 const saved=store.saveBuild(auth,first,key),retry=store.saveBuild(auth,first,key),second=store.saveBuild(auth,body('Raider',1),randomUUID());
 assert.equal(retry.id,saved.id);
 assert.deepEqual(store.builds(auth).map(build=>build.name).sort(),['Raider','Scout']);
 const replaced=store.updateBuild(auth,saved.id,body('Scout Mk II',2),randomUUID());
 assert.equal(replaced.name,'Scout Mk II');
 assert.equal(replaced.blueprint.n,PRESETS[2].name);
 assert.deepEqual(store.deleteBuild(auth,second.id),{deleted:true,id:second.id});
 assert.equal(store.builds(auth).length,1);
});

test('saved builds are private to their owner and agent keys cannot replace them',t=>{
 const store=new Store(':memory:',{seed:false});t.after(()=>store.close());
 const owner=store.session({name:'Owner'}),other=store.session({name:'Other'}),ownerAuth=store.auth(owner.token),otherAuth=store.auth(other.token);
 const saved=store.saveBuild(ownerAuth,body('Private'),randomUUID());
 const agent=store.auth(store.agents(ownerAuth,{name:'Scout',scopes:['read'],contracts:null,entryCap:null,spendCap:null,rewardCap:null,expires:0}).token);
 assert.throws(()=>store.build(saved.id,otherAuth.account),/not found/);
 assert.throws(()=>store.updateBuild(otherAuth,saved.id,body('Taken'),randomUUID()),/not found/);
 assert.throws(()=>store.deleteBuild(otherAuth,saved.id),/not found/);
 assert.throws(()=>store.saveBuild(agent,body('Agent copy'),randomUUID()),/browser owner key/);
});
