'use strict';
// Personalized weekly club results: safe, authenticated preview only.
// Does not send mail, list subscribers, or request API-Football.
const {cacheGet}=require('./cache');
const TZ='Europe/Lisbon';
const FINAL=new Set(['FT','AET','PEN']);
function day(d){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function ago(n){const d=new Date();d.setUTCDate(d.getUTCDate()-n);return day(d);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function select(fixtures,clubs){
 const ids=new Set(clubs.filter(x=>x.type==='club').map(x=>String(x.id)));
 return fixtures.filter(f=>f&&FINAL.has(f.statusShort)&&f.home&&f.away&&f.goals&&
   Number.isInteger(f.goals.home)&&Number.isInteger(f.goals.away)&&
   (ids.has(String(f.home.id))||ids.has(String(f.away.id))))
 .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
 .filter((f,i,a)=>a.findIndex(x=>String(x.id)===String(f.id))===i)
 .slice(0,30);
}
async function getResults(clubs,days=7){
 const fixtures=[],missing=[];
 for(let n=0;n<days;n++){
  const date=ago(n);
  const found=await cacheGet('club-results:fixtures:'+date);
  if(Array.isArray(found))fixtures.push(...found);
  else missing.push(date);
 }
 return {matches:select(fixtures,clubs),missing,days};
}
function html(matches,clubs,missing){
 const names=clubs.filter(x=>x.type==='club').map(x=>x.name).slice(0,20);
 const rows=matches.map(f=>'<tr><td style="padding:15px;border-bottom:1px solid #463653;color:#fff;font:15px Arial">'+esc(f.home.name)+' <b>'+f.goals.home+'–'+f.goals.away+'</b> '+esc(f.away.name)+'<div style="color:#b7a3cc;font-size:12px;margin-top:7px">'+esc(f.league&&f.league.name)+' · '+esc(String(f.date||'').slice(0,10))+'</div></td></tr>').join('');
 const note=missing.length?'<p style="color:#ffc58e;font:12px Arial">Some dates were not cached. Results may be incomplete.</p>':'';
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0b0910;margin:0;padding:24px"><table role="presentation" style="max-width:600px;width:100%;margin:auto;background:#1e132c;border-collapse:collapse"><tr><td style="padding:30px;text-align:center;color:white"><div style="font:700 12px Arial;letter-spacing:2px;color:#ff9745">FOOTBALL STORIES 96</div><h1 style="font:bold 35px Arial">YOUR CLUBS THIS WEEK</h1><p style="font:14px Arial;color:#d4c6df">'+esc(names.join(' · ')||'No followed clubs')+'</p>'+note+'</td></tr>'+ (rows||'<tr><td style="padding:18px;color:white;font:15px Arial">No completed matches found in the saved data for your followed clubs this week.</td></tr>')+'<tr><td style="padding:20px;text-align:center;color:#b7a3cc;font:12px Arial">This is a preview, not a sent newsletter.</td></tr></table></body></html>';
}
module.exports={getResults,html};
