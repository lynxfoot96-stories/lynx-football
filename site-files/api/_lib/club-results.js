'use strict';
// Personalized weekly club results: safe, authenticated preview only.
// Does not send mail, list subscribers, or request API-Football.
const {cacheGet}=require('./cache');
const newsDb=require('../../lib/news/db');
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

const LEAGUE_TERMS={'39':['premier league'],'140':['la liga','laliga'],'135':['serie a'],'78':['bundesliga'],'61':['ligue 1'],'2':['champions league'],'3':['europa league'],'94':['primeira liga']};
function clean(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function phraseIn(text,phrase){const t=clean(text),p=clean(phrase);return p.length>=4&&(' '+t+' ').includes(' '+p+' ');}
async function getNews(favorites){
 const topics=[];
 for(const f of favorites){
  if(f.type==='club'&&f.name)topics.push(f.name);
  if(f.type==='league'){
   topics.push(...(LEAGUE_TERMS[String(f.id)]||[]));
   if(f.name)topics.push(f.name);
  }
 }
 if(!topics.length)return [];
 const all=await newsDb.listPublished({limit:120,compact:true});
 const since=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
 return all.filter(a=>{
  const published=String(a.published_date||a.created_at||'').slice(0,10);
  return published>=since&&a.title&&a.slug&&topics.some(t=>phraseIn(a.title+' '+(a.summary||''),t));
 }).slice(0,6);
}

function html(matches,clubs,missing,news=[]){
 const names=clubs.filter(x=>x.type==='club'||x.type==='league').map(x=>x.name).slice(0,20);
 const rows=matches.map(f=>'<tr><td style="padding:15px;border-bottom:1px solid #463653;color:#fff;font:15px Arial">'+esc(f.home.name)+' <b>'+f.goals.home+'–'+f.goals.away+'</b> '+esc(f.away.name)+'<div style="color:#b7a3cc;font-size:12px;margin-top:7px">'+esc(f.league&&f.league.name)+' · '+esc(String(f.date||'').slice(0,10))+'</div></td></tr>').join('');
 const newsRows=news.map(a=>'<tr><td style="padding:14px;border-bottom:1px solid #463653;font:15px Arial"><a style="color:#cba7ff" href="'+esc('https://footballstories96.com/news-article.html?slug='+encodeURIComponent(a.slug))+'">'+esc(a.title)+'</a><p style="color:#ddd;font:12px Arial">'+esc(String(a.summary||'').slice(0,150))+'</p></td></tr>').join('');
 const newsSection='<tr><td style="padding:22px 15px 6px;color:#fff;font:bold 19px Arial">NEWS ABOUT YOUR FOLLOWS</td></tr>'+(newsRows||'<tr><td style="padding:15px;color:#ddd;font:13px Arial">No matching published news in the last seven days.</td></tr>');
 const note=missing.length?'<p style="color:#ffc58e;font:12px Arial">Some dates were not cached. Results may be incomplete.</p>':'';
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0b0910;margin:0;padding:24px"><table role="presentation" style="max-width:600px;width:100%;margin:auto;background:#1e132c;border-collapse:collapse"><tr><td style="padding:30px;text-align:center;color:white"><div style="font:700 12px Arial;letter-spacing:2px;color:#ff9745">FOOTBALL STORIES 96</div><h1 style="font:bold 35px Arial">YOUR CLUBS THIS WEEK</h1><p style="font:14px Arial;color:#d4c6df">'+esc(names.join(' · ')||'No followed clubs')+'</p>'+note+'</td></tr>'+ (rows||'<tr><td style="padding:18px;color:white;font:15px Arial">No completed matches found in the saved data for your followed clubs this week.</td></tr>')+newsSection+'<tr><td style="padding:20px;text-align:center;color:#b7a3cc;font:12px Arial">This is a preview, not a sent newsletter.</td></tr></table></body></html>';
}
module.exports={getResults,getNews,html};
