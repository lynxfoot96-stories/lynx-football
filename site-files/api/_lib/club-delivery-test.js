'use strict';
// One-time, strictly gated delivery test. Never enabled by deployment alone.
const {members,accounts}=require('./club-delivery-audit');
const {getResults,getNews,html}=require('./club-results');
const crypto=require('crypto');
const MAX_TEST_SENDS=2;
function readyRedis(){
 const url=String(process.env.UPSTASH_REDIS_REST_URL||'').replace(/\/$/,'');
 const token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)throw Error('redis_required');
 return {url,token};
}
async function reserve(key){
 const {url,token}=readyRedis();
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(['SET',key,'attempted','NX','EX',60*60*24*14]),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('redis_reservation_http_'+r.status);
 const j=await r.json();if(j.error)throw Error('redis_reservation_failed');
 return j.result==='OK';
}
async function sendOne(email,body){
 const key=process.env.BREVO_API_KEY,from=process.env.BREVO_SENDER_EMAIL;
 if(!key||!from)throw Error('brevo_sender_not_configured');
 const r=await fetch('https://api.brevo.com/v3/smtp/email',{
  method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},
  body:JSON.stringify({sender:{email:from,name:process.env.BREVO_SENDER_NAME||'Football Stories 96'},
    to:[{email}],subject:'[TEST] Football Stories — Your Clubs This Week',
    htmlContent:body,headers:{'X-Mailin-custom':'category:club-results-test'}}),
  signal:AbortSignal.timeout(12000)
 });
 if(!r.ok)throw Error('brevo_send_http_'+r.status);
 return true;
}
async function handleClubDeliveryTest(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
  return res.status(401).json({ok:false,error:'unauthorized'});
 const enabled=process.env.CLUB_RESULTS_TEST_SEND==='true';
 try{
  // Ensure Redis authorization works BEFORE any external mail action.
  readyRedis();
  const opted=await members(),users=await accounts();
  const target=users.filter(u=>u.email_confirmed_at&&u.email&&opted.has(String(u.email).toLowerCase()))
    .filter(u=>Array.isArray(u.user_metadata?.fs_favorites)&&u.user_metadata.fs_favorites.some(f=>f?.type==='club'||f?.type==='league'));
  if(target.length>MAX_TEST_SENDS)
   return res.status(409).json({ok:false,error:'too_many_subscribers_for_test',eligible:target.length,max:MAX_TEST_SENDS});
  const prepared=[];
  for(const u of target){
   const follows=u.user_metadata.fs_favorites;
   const [results,news]=await Promise.all([getResults(follows.filter(f=>f.type==='club')),getNews(follows)]);
   const site=/^https:\/\//.test(process.env.SITE_URL||'')?process.env.SITE_URL.replace(/\/$/,''):'https://'+req.headers.host;
   const markup=html(results.matches,follows,results.missing,news,site,false);
   const footer='<p style="text-align:center;font:12px Arial;color:#b7a3cc"><a style="color:#cba7ff" href="'+site+'/account.html#preferences">Manage your club-results email subscription</a></p>';
   prepared.push({u,body:markup.replace('</body>',footer+'</body>'),
    matchCount:results.matches.length,newsCount:news.length,missingDays:results.missing.length});
  }
  const summary=prepared.map((p,i)=>({recipient:i+1,matches:p.matchCount,news:p.newsCount,missingDays:p.missingDays}));
  if(!enabled) {
   console.info('[club-results-test] dry-run completed',JSON.stringify({
    dryRun:true,emailsSent:0,eligible:prepared.length,
    totalMatches:summary.reduce((n,x)=>n+x.matches,0),
    totalNews:summary.reduce((n,x)=>n+x.news,0),
    recipientsWithMissingScoreDays:summary.filter(x=>x.missingDays>0).length
   }));
   return res.status(200).json({ok:true,dryRun:true,sent:0,eligible:prepared.length,summary,
   next:'Set CLUB_RESULTS_TEST_SEND=true in Production and redeploy ONLY when ready for one-time delivery.'});
  }
  if(!prepared.length)return res.status(200).json({ok:true,skipped:'no_eligible_subscribers',sent:0});
  const stamp='club-results:test:2026-10-30';
  let sent=0,attempted=0;
  for(const p of prepared){
   const id=crypto.createHash('sha256').update(p.u.email.toLowerCase()).digest('hex');
   // Reservation is permanent for 14 days even on ambiguous delivery failure.
   if(!await reserve(stamp+':'+id))continue;
   attempted++;
   await sendOne(p.u.email,p.body);
   sent++;
  }
  console.info('[club-results-test]',JSON.stringify({eligible:prepared.length,attempted,sent,details:summary}));
  return res.status(200).json({ok:true,eligible:prepared.length,attempted,sent,summary});
 }catch(e){
  console.error('[club-results-test]',e.message);
  return res.status(502).json({ok:false,error:'delivery_test_failed_check_logs'});
 }
}
module.exports={handleClubDeliveryTest};
