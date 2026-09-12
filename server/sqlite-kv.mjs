/** Atomic SQLite adapters for Tempo Accounts and MPP replay/session state. */
export function createAuthKv(db,now=Date.now){
 db.exec('CREATE TABLE IF NOT EXISTS auth_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL DEFAULT 0)');
 const read=key=>{const row=db.prepare('SELECT value,expires FROM auth_kv WHERE key=?').get(key);if(!row)return; if(row.expires&&row.expires<=now()){db.prepare('DELETE FROM auth_kv WHERE key=?').run(key);return;}return JSON.parse(row.value);};
 return {
  async get(key){return read(key);},
  async set(key,value,{ttl}={}){db.prepare('INSERT INTO auth_kv VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').run(key,JSON.stringify(value),ttl?now()+ttl*1000:0);},
  async delete(key){db.prepare('DELETE FROM auth_kv WHERE key=?').run(key);},
  async create(key,value,{ttl}={}){db.exec('BEGIN IMMEDIATE');try{const exists=read(key)!==undefined;if(!exists)db.prepare('INSERT INTO auth_kv VALUES (?,?,?)').run(key,JSON.stringify(value),ttl?now()+ttl*1000:0);db.exec('COMMIT');return !exists;}catch(e){db.exec('ROLLBACK');throw e;}},
  async take(key){db.exec('BEGIN IMMEDIATE');try{const value=read(key);db.prepare('DELETE FROM auth_kv WHERE key=?').run(key);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}},
 };
}

export function createMppStore(db){
 db.exec('CREATE TABLE IF NOT EXISTS payment_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const get=key=>{const row=db.prepare('SELECT value FROM payment_kv WHERE key=?').get(key);return row?JSON.parse(row.value):null;};
 return {
  async get(key){return get(key);},
  async put(key,value){db.prepare('INSERT INTO payment_kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));},
  async delete(key){db.prepare('DELETE FROM payment_kv WHERE key=?').run(key);},
  async update(key,fn){db.exec('BEGIN IMMEDIATE');try{const change=fn(get(key));if(change.op==='set')db.prepare('INSERT INTO payment_kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(change.value));else if(change.op==='delete')db.prepare('DELETE FROM payment_kv WHERE key=?').run(key);db.exec('COMMIT');return change.result;}catch(e){db.exec('ROLLBACK');throw e;}},
  async tryClaim(key,expires){db.exec('BEGIN IMMEDIATE');try{const current=get(key),active=current?.type==='mppx:replay'&&current.expires>Date.now();if(!active)db.prepare('INSERT INTO payment_kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify({type:'mppx:replay',expires}));db.exec('COMMIT');return !active;}catch(e){db.exec('ROLLBACK');throw e;}},
 };
}
