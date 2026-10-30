'use strict';
// Monday personalized newsletter; installed in safe dry-run mode by default.
// Only explicitly opted-in Brevo club-results list members can receive mail.
const crypto=require('crypto');
const {members,accounts}=require('./club-delivery-audit');
const {getResults,getNews,html}=require('./club-results');
const MAX_SEND=10;
const COMPLETE=new Set(['FT','AET','PEN']);
function redisCfg(){
 const url=String(process.env.UPSTASH_REDIS_REST_URL||'').replace(/\/$/,'');
 const token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)throw Error('redis_missing');
 return {url,token};
}
async function redis(parts){
 const {url,token}=redisCfg();
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(parts),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('redis_http_'+r.status);
 const j=await r.json();if(j.error)throw Error('redis_failed');
 return j.result;
}
function weekendDates(now){
 const base=new Date(now);
 const weekday=base.getUTCDay();
 if(weekday!==1)return null;
 return [3,2,1].map(offset=>new Date(base.getTime()-offset*86400000).toISOString().slice(0,10));
}
async function readWeekend(){
 const days=weekendDates(Date.now());
 if(!days)return null;
 const all=[];
 for(const date of days){
  const f=await redis(['GET','club-results:fixtures:'+date]);
  if(f===null)return {dates:days,missing:date};
  let fixtures;
  try{fixtures=JSON.parse(f)}catch{throw Error('bad_score_snapshot')}
  if(!Array.isArray(fixtures))throw Error('bad_score_snapshot');
  if(fixtures.some(x=>x && !COMPLETE.has(x.statusShort) && !['PST','CANC','ABD','AWD','WO'].includes(x.statusShort)))
   return {dates:days,incomplete:date};
  all.push(fixtures.length);
 }
 return {dates:days,counts:all};
}
async function send(email,markup){
 if(!process.env.BREVO_API_KEY||!process.env.BREVO_SENDER_EMAIL)throw Error('sender_missing');
 const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({
  sender:{email:process.env.BREVO_SENDER_EMAIL,name:process.env.BREVO_SENDER_NAME||'Football Stories 96'},
  to:[{email}],subject:'Football Stories — Your Clubs This Week',htmlContent:markup,
  headers:{'X-Mailin-custom':'category:club-results-weekly'}
 }),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('brevo_http_'+r.status);
}
async function handleWeeklyClubResults(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
  return res.status(401).json({ok:false,error:'unauthorized'});
 const enabled=process.env.WEEKLY_CLUB_RESULTS_SEND==='true';
 if(new Date().getUTCDay()!==1)
  return res.status(200).json({ok:true,skipped:'not_monday',sent:0});
 try{
  const weekend=await readWeekend();
  if(weekend.missing||weekend.incomplete){
   console.info('[weekly-club-results] skipped',JSON.stringify({reason:weekend.missing?'missing_archive':'incomplete_archive',dates:weekend.dates,missing:weekend.missing,incomplete:weekend.incomplete,sent:0}));
   return res.status(200).json({ok:true,skipped:weekend.missing?'missing_archive':'incomplete_archive',sent:0,weekend});
  }
  const [opted,users]=await Promise.all([members(),accounts()]);
  const eligible=users.filter(u=>u.email_confirmed_at&&u.email&&opted.has(String(u.email).toLowerCase()))
   .filter(u=>Array.isArray(u.user_metadata?.fs_favorites)&&u.user_metadata.fs_favorites.some(f=>f?.type==='club'||f?.type==='league'));
  if(eligible.length>MAX_SEND)throw Error('recipient_cap_exceeded');
  const prepared=[];
  const base=/^https:\/\//.test(process.env.SITE_URL||'')?process.env.SITE_URL.replace(/\/$/,''):'https://'+req.headers.host;
  for(const u of eligible){
   const fav=u.user_metadata.fs_favorites;
   const [results,news]=await Promise.all([getResults(fav.filter(f=>f.type==='club'),3,1),getNews(fav)]);
   if(results.missing.length)throw Error('recipient_missing_archives');
   prepared.push({email:u.email,body:html(results.matches,fav,[],news,base,false),matches:results.matches.length,news:news.length});
  }
  const stats={eligible:prepared.length,matches:prepared.reduce((n,x)=>n+x.matches,0),news:prepared.reduce((n,x)=>n+x.news,0),weekend:weekend.dates};
  if(!enabled){
   console.info('[weekly-club-results] dry-run',JSON.stringify({...stats,sent:0}));
   return res.status(200).json({ok:true,dryRun:true,sent:0,...stats});
  }
  let sent=0,attempted=0,duplicate=0;
  const week=weekend.dates[2]; // Sunday date uniquely identifies each newsletter
  for(const p of prepared){
   const id=crypto.createHash('sha256').update(p.email.trim().toLowerCase()).digest('hex');
   const key='weekly-club-results:'+week+':'+id;
   // Attempt is reserved before Brevo call. Uncertain outcomes are never blindly retried.
   const claim=await redis(['SET',key,'send_attempted','NX','EX',String(28*86400)]);
   if(claim===null){duplicate++;continue}
   if(claim!=='OK')throw Error('idempotency_not_confirmed');
   attempted++;
   await send(p.email,p.body);
   sent++;
  }
  console.info('[weekly-club-results] finished',JSON.stringify({...stats,sent,attempted,duplicate}));
  return res.status(200).json({ok:true,sent,attempted,duplicate,...stats});
 }catch(e){
  console.error('[weekly-club-results] failed',e.message);
  return res.status(502).json({ok:false,error:'weekly_club_results_failed_check_logs'});
 }
}

async function handleWeeklyClubPreflight(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
  return res.status(401).json({ok:false,error:'unauthorized'});
 try{
  // Inspect current Friday-Sunday window, even before Monday. Never sends.
  const now=new Date(),day=now.getUTCDay();
  const fridayOffset=(day+2)%7;
  const friday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-fridayOffset));
  const days=[0,1,2].map(n=>new Date(friday.getTime()+n*86400000).toISOString().slice(0,10));
  const coverage=[],weekendFixtures=[];
  for(const date of days){
   const raw=await redis(['GET','club-results:fixtures:'+date]);
   if(raw===null){coverage.push({date,status:'not_archived'});continue}
   const list=JSON.parse(raw);
   if(!Array.isArray(list))throw Error('invalid_archived_matches');
   weekendFixtures.push(...list);
   const completed=list.filter(f=>COMPLETE.has(f.statusShort)&&Number.isInteger(f.goals?.home)&&Number.isInteger(f.goals?.away)).length;
   coverage.push({date,status:completed===list.length?'complete':'incomplete',matches:list.length,completed});
  }
  const [opted,users]=await Promise.all([members(),accounts()]);
  const eligible=users.filter(u=>u.email_confirmed_at&&u.email&&opted.has(String(u.email).toLowerCase()))
   .filter(u=>Array.isArray(u.user_metadata?.fs_favorites)&&u.user_metadata.fs_favorites.some(f=>f?.type==='club'||f?.type==='league'));
  if(eligible.length>MAX_SEND)throw Error('recipient_cap_exceeded');
  const totals={recipients:eligible.length,news:0,matchedFinalResults:0};
  for(const u of eligible){
   const follows=u.user_metadata.fs_favorites;
   const news=await getNews(follows);
   const clubIds=new Set(follows.filter(f=>f.type==='club').map(f=>String(f.id)));
   totals.news+=news.length;
   totals.matchedFinalResults+=weekendFixtures.filter(f=>COMPLETE.has(f.statusShort)&&(clubIds.has(String(f.home?.id))||clubIds.has(String(f.away?.id)))).length;
  }
  const output={ok:true,dryRun:true,emailsSent:0,sendingEnabled:false,weekend:days,coverage,...totals,
   readyForMonday:coverage.every(c=>c.status==='complete')};
  console.info('[weekly-club-preflight]',JSON.stringify(output));
  return res.status(200).json(output);
 }catch(e){
  console.error('[weekly-club-preflight] failed',e.message);
  return res.status(502).json({ok:false,error:'preflight_failed_check_logs'});
 }
}

module.exports={handleWeeklyClubResults,handleWeeklyClubPreflight};
