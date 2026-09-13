import { DurableObject } from 'cloudflare:workers';
import { relayFetch } from './relay-service.mjs';
// Serialize journal changes; persist public signed bytes before every broadcast.
export class SettlementRelay extends DurableObject {
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(()=>relayFetch(request,this.env,this.ctx.storage));
  }
}
export default {fetch(request,env) { return env.RELAY_ACTOR.get(env.RELAY_ACTOR.idFromName('relay-account')).fetch(request); }};
