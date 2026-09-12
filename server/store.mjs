import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {CREDIT_SCALE,FEE_POLICY_VERSION,PLATFORM_FEE_BPS,PLATFORM_FEE_POLICY,creditUnits,rewardQuote} from '../dist/economy.mjs';
import {simulationHash} from './simulation-hash.mjs';
import {unpackChallenge, packChallenge, PRESETS, PARTS, ARENAS, DEFAULT_RULES, ENGINE_VERSION, BALANCE_VERSION, TERRAIN_VERSION,TERRAIN_INFO} from '../dist/data.mjs';
import {PART_GUIDANCE} from '../dist/part-guidance.mjs';

export const ENGINE_HASH=simulationHash();
export const MAX_CREDITS=1000000000;
export const versions={engine:ENGINE_VERSION,balance:BALANCE_VERSION,terrain:TERRAIN_VERSION,hash:ENGINE_HASH};
const hash=s=>createHash('sha256').update(s).digest('hex');
const json=JSON.stringify, parse=JSON.parse, id=()=>randomUUID();
export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
export function check(ok,message,status=400){if(!ok)throw new ApiError(status,message);}
export function fields(o,keys){check(o&&typeof o==='object'&&!Array.isArray(o),'Expected a JSON object.');check(Object.keys(o).every(k=>keys.includes(k)),'Unknown field in request.');}
const integer=(n,min,max,label)=>{check(Number.isSafeInteger(n)&&n>=min&&n<=max,`${label} must be a whole number from ${min} to ${max}.`);return n;};
const text=(s,max,label)=>{check(typeof s==='string'&&s.trim().length>0&&s.trim().length<=max&&!/[\u0000-\u001f]/.test(s),`Invalid ${label}.`);return s.trim();};
const keyCheck=k=>{check(typeof k==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(k),'Supply a unique Idempotency-Key (16–100 letters, numbers, _ or -).');return k;};
const bountyQuote=b=>({...rewardQuote(b.reward,b.fee,b.platform_fee_bps),feePolicyVersion:b.fee_policy_version});
export function canonicalBlueprint(input,locked){
 fields(input,['v','n','p','t','g','d','s','a','e','b','q','fr','ac','gl','pt','no','f','m']);
 if(input.q)fields(input.q,['mode','combat','credits','parts','mass','weapons']);
 try{const p=locked?{...input,a:locked.a,e:0,q:locked.q,b:locked.b}:input;const c=unpackChallenge(p);return packChallenge(c.machine,c.arena,0,c.rules);}catch(e){throw new ApiError(400,e.message);}
}

export class Store {
 constructor(path=':memory:',{now=Date.now,seed=true}={}){
  this.now=now;this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0),entry_cap INTEGER NOT NULL,daily_cap INTEGER NOT NULL,created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),role TEXT NOT NULL,name TEXT NOT NULL,created INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS bounties(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES accounts(id),title TEXT NOT NULL,blueprint TEXT NOT NULL,fee INTEGER NOT NULL,reward INTEGER NOT NULL,status TEXT NOT NULL,listed INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,version TEXT NOT NULL,active TEXT,winning TEXT,reserve INTEGER NOT NULL CHECK(reserve>=0));
  CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,bounty TEXT NOT NULL REFERENCES bounties(id),account TEXT NOT NULL REFERENCES accounts(id),blueprint TEXT NOT NULL,seed INTEGER NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,tries INTEGER NOT NULL DEFAULT 0,result TEXT,error TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON attempts(bounty) WHERE status IN ('queued','running');
  CREATE INDEX IF NOT EXISTS attempts_queue ON attempts(status,created);
  CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),amount INTEGER NOT NULL,kind TEXT NOT NULL,ref TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(account,kind,ref));
  CREATE TABLE IF NOT EXISTS operations(account TEXT NOT NULL,key TEXT NOT NULL,kind TEXT NOT NULL,digest TEXT NOT NULL,ref TEXT NOT NULL,PRIMARY KEY(account,key));
  CREATE TABLE IF NOT EXISTS bookmarks(account TEXT NOT NULL REFERENCES accounts(id),bounty TEXT NOT NULL REFERENCES bounties(id),created INTEGER NOT NULL,PRIMARY KEY(account,bounty));
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  // Existing monetary balances keep their value, and existing contracts keep zero platform fee.
  this.tx(()=>{
   const bountyColumns=new Set(this.db.prepare('PRAGMA table_info(bounties)').all().map(c=>c.name));
   if(!bountyColumns.has('platform_fee_bps'))this.db.exec('ALTER TABLE bounties ADD COLUMN platform_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK(platform_fee_bps BETWEEN 0 AND 10000)');
   if(!bountyColumns.has('fee_policy_version'))this.db.exec("ALTER TABLE bounties ADD COLUMN fee_policy_version TEXT NOT NULL DEFAULT 'legacy-no-fee'");
   const unit=this.db.prepare('SELECT value FROM meta WHERE key=?').get('credit-scale');
   if(!unit){this.db.exec(`UPDATE accounts SET balance=balance*${CREDIT_SCALE}; UPDATE ledger SET amount=amount*${CREDIT_SCALE}`);this.db.prepare('INSERT INTO meta VALUES (?,?)').run('credit-scale',String(CREDIT_SCALE));}
   else check(unit.value===String(CREDIT_SCALE),'Unsupported ledger unit.',500);
  });
  this.db.prepare("INSERT OR IGNORE INTO accounts VALUES ('platform','Platform fee treasury',0,0,0,?)").run(now());
  this.db.prepare("INSERT OR IGNORE INTO accounts VALUES ('house','Arena treasury',0,0,0,?)").run(now());
  if(seed&&!this.db.prepare('SELECT 1 FROM meta WHERE key=?').get('starter:'+ENGINE_HASH))this.tx(()=>{
   const owner=this.newAccount('Foundry trials',10000).account;
   for(const [i,arena,title] of [[0,'foundry','First contract · Break the Marauder'],[6,'reservoir','Steam test · Firefly'],[1,'quarry','Open a firing lane · Longbow'],[5,'badlands','Crack the Ironclad']])this.create(owner,{title,blueprint:packChallenge(PRESETS[i],arena,0),entry:10,reward:100,maxPlatformFeeBps:PLATFORM_FEE_BPS,hours:168,listed:true},id(),true);
   this.db.prepare('INSERT INTO meta VALUES (?,?)').run('starter:'+ENGINE_HASH,'1');
  });
 }
 close(){this.db.close();}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 newAccount(name,grant=1000){
  const account=id(),token=randomBytes(32).toString('base64url'),now=this.now();
  this.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run(account,text(name,28,'pilot name'),0,-1,-1,now);
  this.db.prepare('INSERT INTO tokens VALUES (?,?,?,?,?,0)').run(hash(token),account,'owner','Browser key',now);
  this.credit(account,grant,'grant',account);return {account,token};
 }
 session(body){fields(body,['name']);return this.tx(()=>{const a=this.newAccount(body.name||'Independent engineer');return {token:a.token,me:this.me(a.account)};});}
 auth(token){check(typeof token==='string'&&token.length>=32,'Create a demo profile or supply a bearer token.',401);const t=this.db.prepare('SELECT * FROM tokens WHERE hash=? AND revoked=0').get(hash(token));check(t,'Invalid or revoked bearer token.',401);return t;}
 owner(auth){check(auth.role==='owner','This action requires the browser owner key.',403);}
 me(account){const a=this.db.prepare('SELECT * FROM accounts WHERE id=?').get(account);const since=new Date(this.now()).setUTCHours(0,0,0,0);const spend=this.db.prepare("SELECT COALESCE(SUM(b.fee),0) AS n FROM attempts a JOIN bounties b ON b.id=a.bounty WHERE a.account=? AND a.status!='refunded' AND a.created>=?").get(account,since).n;return {id:a.id,name:a.name,balance:a.balance/CREDIT_SCALE,entryCap:a.entry_cap<0?null:a.entry_cap,dailyCap:a.daily_cap<0?null:a.daily_cap,spentToday:spend,reserved:this.db.prepare('SELECT COALESCE(SUM(reserve),0) AS n FROM bounties WHERE owner=?').get(account).n,mode:'demo',...{versions}};}
 settings(auth,body){this.owner(auth);fields(body,['name','entryCap','dailyCap']);return this.tx(()=>{const a=this.me(auth.account);this.db.prepare('UPDATE accounts SET name=?,entry_cap=?,daily_cap=? WHERE id=?').run(text(body.name??a.name,28,'pilot name'),(Object.hasOwn(body,'entryCap')?body.entryCap:a.entryCap)===null?-1:integer(body.entryCap??a.entryCap,0,MAX_CREDITS,'Entry cap'),(Object.hasOwn(body,'dailyCap')?body.dailyCap:a.dailyCap)===null?-1:integer(body.dailyCap??a.dailyCap,0,MAX_CREDITS,'Daily cap'),auth.account);return this.me(auth.account);});}
 credit(account,credits,kind,ref){const amount=creditUnits(credits);check(Number.isSafeInteger(amount),'Invalid ledger amount.',500);const exists=this.db.prepare('SELECT amount FROM ledger WHERE account=? AND kind=? AND ref=?').get(account,kind,ref);if(exists){check(exists.amount===amount,'Ledger conflict.',500);return;}const changed=this.db.prepare('UPDATE accounts SET balance=balance+? WHERE id=? AND balance+?>=0 AND balance+?<=9007199254740991').run(amount,account,amount,amount);check(changed.changes===1,'Not enough demo credits.',409);this.db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?)').run(id(),account,amount,kind,ref,this.now());}
 ledger(account){return this.db.prepare('SELECT amount,kind,ref,created FROM ledger WHERE account=? ORDER BY created DESC,rowid DESC LIMIT 100').all(account).map(row=>({...row,amount:row.amount/CREDIT_SCALE}));}
 agents(auth,body){this.owner(auth);if(!body)return this.db.prepare("SELECT substr(hash,1,16) AS id,name,created,revoked FROM tokens WHERE account=? AND role='agent' ORDER BY created DESC").all(auth.account);fields(body,['name']);check(this.agents(auth).filter(a=>!a.revoked).length<8,'Revoke an old agent key first.',409);const token=randomBytes(32).toString('base64url');this.db.prepare('INSERT INTO tokens VALUES (?,?,?,?,?,0)').run(hash(token),auth.account,'agent',text(body.name,28,'agent name'),this.now());return {token,scope:'Read, validate, practice, create/cancel/save bounties and enter trials within owner-chosen caps. Cannot change caps or mint keys.'};}
 revoke(auth,tokenId){this.owner(auth);this.db.prepare("UPDATE tokens SET revoked=1 WHERE account=? AND substr(hash,1,16)=? AND role='agent'").run(auth.account,tokenId);return {ok:true};}
 prior(account,key,kind,body){keyCheck(key);const op=this.db.prepare('SELECT * FROM operations WHERE account=? AND key=?').get(account,key);if(op)check(op.kind===kind&&op.digest===hash(json(body)),'That idempotency key was used for a different request.',409);return op;}
 operation(account,key,kind,body,ref){this.db.prepare('INSERT INTO operations VALUES (?,?,?,?,?)').run(account,key,kind,hash(json(body)),ref);}
 create(account,body,key,nested=false){const fn=()=>{
  fields(body,['title','blueprint','entry','reward','hours','listed','maxPlatformFeeBps']);const old=this.prior(account,key,'create',body);if(old)return this.bounty(old.ref);
  check(Number.isSafeInteger(body.maxPlatformFeeBps)&&body.maxPlatformFeeBps>=PLATFORM_FEE_BPS&&body.maxPlatformFeeBps<=10000,'Acknowledge the 2.5% winning-reward platform fee with maxPlatformFeeBps (250 basis points).',409);
  const blueprint=canonicalBlueprint(body.blueprint),title=text(body.title,70,'bounty title'),fee=integer(body.entry,0,MAX_CREDITS,'Entry'),reward=integer(body.reward,0,MAX_CREDITS,'Reward'),hours=integer(body.hours,0,8760,'Duration');check(typeof body.listed==='boolean','Choose board visibility.');
  check(this.db.prepare("SELECT COUNT(*) AS n FROM bounties WHERE owner=? AND status IN ('open','busy')").get(account).n<20,'Close an existing bounty first.',409);
  const bounty=id(),now=this.now();this.credit(account,-reward,'reserve',bounty);
  this.db.prepare('INSERT INTO bounties (id,owner,title,blueprint,fee,reward,status,listed,created,expires,version,active,winning,reserve,platform_fee_bps,fee_policy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(bounty,account,title,json(blueprint),fee,reward,'open',+body.listed,now,hours?now+hours*3600000:0,json(versions),null,null,reward,PLATFORM_FEE_BPS,FEE_POLICY_VERSION);
  this.operation(account,key,'create',body,bounty);return this.bounty(bounty);
 };return nested?fn():this.tx(fn);}
 rawBounty(id){const b=this.db.prepare('SELECT * FROM bounties WHERE id=?').get(id);check(b,'Bounty not found.',404);return b;}
 bounty(id){const b=this.rawBounty(id);return {id:b.id,owner:b.owner,ownerName:this.db.prepare('SELECT name FROM accounts WHERE id=?').get(b.owner).name,title:b.title,blueprint:parse(b.blueprint),entry:b.fee,reward:b.reward,...bountyQuote(b),status:b.status,listed:!!b.listed,created:b.created,expires:b.expires||null,links:{share:'/#bounty='+b.id,self:'/api/bounties/'+b.id,attempts:'/api/bounties/'+b.id+'/attempts'},versions:parse(b.version),compatible:parse(b.version).hash===ENGINE_HASH,activeAttempt:b.active,winningAttempt:b.winning,funded:['open','busy'].includes(b.status)&&b.reserve===b.reward,attempts:this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE bounty=?').get(id).n,history:this.db.prepare("SELECT id,status,created,result FROM attempts WHERE bounty=? AND status IN ('settled','refunded') ORDER BY created DESC LIMIT 12").all(id).map(r=>({...r,result:r.result?parse(r.result):null}))};}
 list(account){return this.db.prepare('SELECT id FROM bounties WHERE listed=1 OR owner=? ORDER BY CASE status WHEN \'open\' THEN 0 WHEN \'busy\' THEN 1 ELSE 2 END, created DESC LIMIT 100').all(account||'').map(b=>this.bounty(b.id));}
 closeBounty(b,status){check(!b.active,'An accepted attempt must finish before this bounty can close.',409);if(b.reserve)this.credit(b.owner,b.reserve,'release',b.id);this.db.prepare('UPDATE bounties SET status=?,reserve=0 WHERE id=?').run(status,b.id);}
 cancel(auth,bounty){return this.tx(()=>{const b=this.rawBounty(bounty);check(b.owner===auth.account,'Only the creator can close this bounty.',403);if(['open','busy'].includes(b.status))this.closeBounty(b,'cancelled');return this.bounty(bounty);});}
 expire(){return this.tx(()=>{for(const b of this.db.prepare("SELECT * FROM bounties WHERE status='open'").all())if(b.expires&&b.expires<=this.now())this.closeBounty(b,'expired');else if(parse(b.version).hash!==ENGINE_HASH)this.closeBounty(b,'archived');});}
 accept(account,bounty,body,key){return this.tx(()=>{
  fields(body,['blueprint','maxEntry','maxPlatformFeeBps']);const old=this.prior(account,key,'enter:'+bounty,body);if(old)return this.attempt(old.ref,account);
  const b=this.rawBounty(bounty);check(b.owner!==account,'You can practice against your own bounty, but cannot claim it.',403);check(b.status==='open','This bounty is busy or closed. No credits were taken.',409);check(!b.expires||b.expires>this.now(),'This bounty has expired.',409);check(parse(b.version).hash===ENGINE_HASH,'This bounty uses an older engine. Its creator can close it and reclaim the reward.',409);
  check(Number.isSafeInteger(body.maxEntry)&&body.maxEntry>=b.fee,'Entry exceeds your quoted maximum.',409);
  check((body.maxPlatformFeeBps===undefined&&b.platform_fee_bps===0)||(Number.isSafeInteger(body.maxPlatformFeeBps)&&body.maxPlatformFeeBps>=b.platform_fee_bps&&body.maxPlatformFeeBps<=10000),'Platform fee exceeds your accepted maximum. Read the contract and send maxPlatformFeeBps before entering.',409);
  const blueprint=canonicalBlueprint(body.blueprint,parse(b.blueprint)),a=this.me(account);
  check(a.entryCap===null||b.fee<=a.entryCap,'Entry exceeds your per-attempt spending cap.',409);check(a.dailyCap===null||a.spentToday+b.fee<=a.dailyCap,'Your daily entry budget is exhausted.',409);check(this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE status IN ('queued','running')").get().n<16,'Arena queue is full. Try later; no credits taken.',429);
  const attempt=id(),now=this.now(),seed=randomBytes(4).readUInt32LE();this.credit(account,-b.fee,'entry',attempt);this.credit('house',b.fee,'entry-income',attempt);
  this.db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(attempt,bounty,account,json(blueprint),seed,'queued',now,now,null,0,0);
  this.db.prepare("UPDATE bounties SET status='busy',active=? WHERE id=?").run(attempt,bounty);this.operation(account,key,'enter:'+bounty,body,attempt);return this.attempt(attempt,account);
 });}
 attempt(id,account){const a=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id);check(a,'Attempt not found.',404);const b=this.rawBounty(a.bounty),done=['settled','refunded'].includes(a.status);check(done||account===a.account||account===b.owner,'This attempt is still private while running.',403);return {id:a.id,bounty:a.bounty,account:a.account,economics:bountyQuote(b),status:a.status,created:a.created,updated:a.updated,result:a.result?parse(a.result):null,error:a.error,...(done?{replay:{challenger:parse(a.blueprint),defender:parse(b.blueprint),arena:parse(b.blueprint).a,seed:a.seed,swapSpawns:!!(a.seed&1),versions:parse(b.version)}}:{})};}
 claim(){return this.tx(()=>{
  const a=this.db.prepare("SELECT * FROM attempts WHERE status='queued' OR (status='running' AND lease_until<?) ORDER BY created LIMIT 1").get(this.now());if(!a)return null;
  const b=this.rawBounty(a.bounty);if(a.tries>=3||parse(b.version).hash!==ENGINE_HASH){this.refund(a,b,'Simulation unavailable; entry refunded.');return null;}
  const lease=id();this.db.prepare("UPDATE attempts SET status='running',lease=?,lease_until=?,tries=tries+1,updated=? WHERE id=?").run(lease,this.now()+45000,this.now(),a.id);
  return {id:a.id,lease,challenger:parse(a.blueprint),defender:parse(b.blueprint),arena:parse(b.blueprint).a,seed:a.seed,swapSpawns:!!(a.seed&1),engineHash:ENGINE_HASH};
 });}
 refund(a,b,error){this.credit('house',-b.fee,'refund-out',a.id);this.credit(a.account,b.fee,'refund',a.id);this.db.prepare("UPDATE attempts SET status='refunded',error=?,updated=?,lease=NULL WHERE id=?").run(error,this.now(),a.id);this.reopen(b);}
 reopen(b){this.db.prepare("UPDATE bounties SET status='open',active=NULL WHERE id=?").run(b.id);if(b.expires&&b.expires<=this.now())this.closeBounty({...b,active:null},'expired');}
 finish(job,result,error){return this.tx(()=>{
  const a=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(job.id);if(!a||a.status!=='running'||a.lease!==job.lease)return false;const b=this.rawBounty(a.bounty);
  if(error){this.refund(a,b,error);return true;}
  check(result&&[-1,0,1].includes(result.winner)&&Number.isFinite(result.time)&&result.time>=2&&result.time<=101&&result.seed===a.seed,'Invalid worker result.',500);
  const quote=bountyQuote(b),win=result.winner===0;
  const receipt={...result,outcome:win?'win':result.winner===1?'loss':'draw',entry:b.fee,grossReward:win?b.reward:0,reward:win?quote.payout:0,payout:win?quote.payout:0,platformFee:win?quote.platformFee:0,platformFeeBps:b.platform_fee_bps,feePolicyVersion:quote.feePolicyVersion,net:win?quote.netIfWin:-b.fee,verifiedAt:this.now()};
  this.db.prepare("UPDATE attempts SET status='settled',result=?,updated=?,lease=NULL WHERE id=?").run(json(receipt),this.now(),a.id);
  if(result.winner===0){this.credit(a.account,quote.payout,'reward',a.id);if(quote.platformFee)this.credit('platform',quote.platformFee,'platform-fee',a.id);this.db.prepare("UPDATE bounties SET status='claimed',reserve=0,active=NULL,winning=? WHERE id=?").run(a.id,b.id);}else this.reopen(b);return true;
 });}
 bookmarks(account){return this.db.prepare('SELECT bounty FROM bookmarks WHERE account=? ORDER BY created DESC LIMIT 200').all(account).map(r=>this.bounty(r.bounty));}
 bookmark(account,bounty,save=true){this.rawBounty(bounty);if(save)this.db.prepare('INSERT OR IGNORE INTO bookmarks VALUES (?,?,?)').run(account,bounty,this.now());else this.db.prepare('DELETE FROM bookmarks WHERE account=? AND bounty=?').run(account,bounty);return {saved:save,bounty};}
 catalog(){return {mode:'demo',apiVersion:'2.1',discovery:'/.well-known/war-machines.json',openapi:'/api/openapi.json',terrainInfo:TERRAIN_INFO,economics:{platformFee:PLATFORM_FEE_POLICY,creditScale:CREDIT_SCALE,amountUnit:'demo credits',maxInteger:MAX_CREDITS,entryMin:0,rewardMin:0,rewardMustExceedEntry:false,personalCapsDefault:null,hours:{min:0,max:8760,zero:'No expiry'}},guest:['build','save local blueprints','share machines','browse','validate','practice'],loginRequired:['create bounty','enter official trial','save bounty','account history'],walletAuth:'TODO',mpp:'TODO',versions,startingCredits:1000,parts:PARTS.map(part=>({...part,...PART_GUIDANCE[part.id]})),arenas:ARENAS,defaultRules:DEFAULT_RULES,examples:PRESETS.map(m=>packChallenge(m,'foundry',0)),rules:{oneActiveAttempt:true,combat:'auto',timeLimitSeconds:100,drawIntegrityThreshold:.025,entryRefund:'Technical failure only',spending:'Entry cap and daily UTC entry budget; funding reserves are separate',payments:'TODO — no wallets, MPP, Tempo or cash value'}};}
}
