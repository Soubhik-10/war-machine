import { serviceCall, secret } from './auth.mjs';
export default {async scheduled(event,env,ctx) {
  ctx.waitUntil((async()=>{
    // Metrics contain only operational counts/codes, never match bodies or secrets.
    let metrics;
    try {metrics=await serviceCall(env.API,env.MONITOR_AUTH,'monitor','api','/api/internal/settlement/metrics',{});}
    catch {metrics={alerts:{apiUnavailable:true}};}
    const active=Object.entries(metrics.alerts).filter(([,value])=>value).map(([key])=>key);
    env.METRICS?.writeDataPoint({blobs:[active.length?'alert':'healthy',active.join(',')],doubles:[metrics.heartbeat || 0,active.length],indexes:['settlement']});
    // Cloudflare notification rules can alert on this structured log and analytics dataset.
    console.log(JSON.stringify({event:'settlement-health',severity:active.length?'error':'info',alerts:active}));
    const fingerprint=JSON.stringify(active),prior=await env.DB.prepare('SELECT * FROM notification_state WHERE id=1').first();
    if(fingerprint!==prior?.fingerprint || active.length && Date.now()-prior.sent>900000) {
      const url=await secret(env.ALERT_WEBHOOK);
      if(!url.startsWith('https://'))throw Error('Alert webhook requires HTTPS');
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:active.length?'War Machines settlement alert: '+active.join(', '):'War Machines settlement monitoring recovered.'}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Alert delivery failed');
      await env.DB.prepare('INSERT INTO notification_state(id,fingerprint,sent) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,sent=excluded.sent').bind(fingerprint,Date.now()).run();
    }
  })());
}};
