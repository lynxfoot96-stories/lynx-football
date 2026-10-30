'use strict';
// Once-daily finalized score capture. Reuses the same date fixture cache as the site.
// Costs at most one additional API-Football date request per run (often zero).
const { fixturesForDate } = require('./fixtures');
const {cacheGet,cacheSet,upstashConfigured}=require('./cache');
const FINAL=new Set(['FT','AET','PEN']);
async function handleClubScoreArchive(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
  return res.status(401).json({ok:false,error:'unauthorized'});
 if(!upstashConfigured())return res.status(503).json({ok:false,error:'redis_required'});
 try{
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const key='club-results:fixtures:'+yesterday;
  const existing=await cacheGet(key);
  const {fixtures,source}=await fixturesForDate(yesterday);
  if(!Array.isArray(fixtures))throw new Error('no_fixture_snapshot');
  const byId=new Map();
  for(const f of Array.isArray(existing)?existing:[])if(f&&f.id!=null)byId.set(String(f.id),f);
  for(const f of fixtures){
   if(!f||f.id==null)continue;
   const old=byId.get(String(f.id));
   if(old&&FINAL.has(old.statusShort)&&!FINAL.has(f.statusShort))continue;
   byId.set(String(f.id),f);
  }
  const merged=Array.from(byId.values());
  await cacheSet(key,merged,9*86400);
  const finals=merged.filter(f=>FINAL.has(f.statusShort)&&Number.isInteger(f.goals?.home)&&Number.isInteger(f.goals?.away)).length;
  console.info('[club-score-archive]',JSON.stringify({date:yesterday,source,fixtures:merged.length,finals,remaining:merged.length-finals}));
  return res.status(200).json({ok:true,date:yesterday,source,fixtures:merged.length,finals,remaining:merged.length-finals});
 }catch(e){
  console.error('[club-score-archive] failed',e.message);
  return res.status(502).json({ok:false,error:'archive_failed_check_logs'});
 }
}
module.exports={handleClubScoreArchive};
