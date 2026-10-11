// Pinned Web Push library implements RFC 8291 encryption + RFC 8292 VAPID.
import webpush from 'npm:web-push@3.6.7';

const serverUrl = Deno.env.get('SUPABASE_URL')!;
const serverKey = (() => {
  try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (keys.default) return keys.default; } catch { /* legacy project */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
})();
async function rpc(name: string, body: unknown = {}) {
  const headers: Record<string,string> = {'apikey':serverKey,'Content-Type':'application/json'};
  if(!serverKey.startsWith('sb_secret_')) headers.Authorization='Bearer '+serverKey;
  const response = await fetch(serverUrl+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Database RPC failed: '+name+' ('+response.status+')');
  return response.status===204?null:response.json();
}
async function tokenMatches(actual: string, expected: string) {
  if(!actual || !expected)return false;
  const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const a=await digest(actual),b=await digest(expected);let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
}
function permittedPushEndpoint(value:string){
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && (!url.port || url.port==='443') &&
      (url.hostname==='fcm.googleapis.com'||url.hostname==='updates.push.services.mozilla.com'||url.hostname==='push.services.mozilla.com'||/^(?:[a-z0-9-]+\.)*push\.apple\.com$/.test(url.hostname)||/^(?:[a-z0-9-]+\.)+notify\.windows\.com$/.test(url.hostname));
  }catch{return false;}
}
// verify_jwt is disabled because pg_cron authenticates with a random Vault token.
// This endpoint does not accept user requests, subscription URLs, or payloads.
Deno.serve(async request => {
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  try {
    const runtime=await rpc('lumo_push_runtime');
    if(!await tokenMatches(request.headers.get('x-lumo-cron')||'',runtime?.cronToken||''))return new Response('Unauthorized',{status:401});
    if(!runtime.publicKey || !runtime.privateKey){
      const keys=webpush.generateVAPIDKeys();
      await rpc('lumo_push_set_vapid',{p_public:keys.publicKey,p_private:keys.privateKey});
      Object.assign(runtime,await rpc('lumo_push_runtime'));
    }
    await rpc('lumo_generate_reminders');
    const jobs=await rpc('claim_lumo_push_jobs',{p_limit:30});
    let sent=0,failed=0;
    await Promise.all((jobs||[]).map(async (job:any)=>{
      let status=0;
      try{
        if(!permittedPushEndpoint(job.subscription.endpoint)){status=400;throw Error('Unsupported push provider');}
        // Lock screen deliberately contains no child's name or event address.
        const payload=JSON.stringify({title:'Lumo',body:'Une nouvelle information du club vous attend dans Lumo.',eventId:job.event_id||'',notificationId:job.notification_id,tag:'lumo-'+job.notification_id});
        const details=webpush.generateRequestDetails(job.subscription,payload,{TTL:3600,urgency:'normal',contentEncoding:'aes128gcm',vapidDetails:{subject:'https://handclub-beta-01a12ad4.wholedove.chatgpt.site',publicKey:runtime.publicKey,privateKey:runtime.privateKey}});
        const response=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(12000)});
        status=response.status;
        if(!response.ok)throw Error('Push provider HTTP '+status);
        await rpc('complete_lumo_push_job',{p_job_id:job.id,p_status:status,p_error:null});sent++;
      }catch{
        // Never log subscription endpoint, encryption keys, private VAPID, or payload.
        await rpc('complete_lumo_push_job',{p_job_id:job.id,p_status:status,p_error:status?'Push provider HTTP '+status:'Push transport unavailable'});failed++;
      }
    }));
    return Response.json({ok:true,sent,failed});
  }catch{
    return Response.json({ok:false,error:'Notification worker unavailable'},{status:503});
  }
});
