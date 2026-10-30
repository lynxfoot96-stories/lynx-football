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
async function getResults(clubs,days=7,offset=0){
 const fixtures=[],missing=[];
 for(let n=0;n<days;n++){
  const date=ago(n+offset);
  let found=await cacheGet('club-results:fixtures:'+date);
  // Older daily score responses might predate the dedicated weekly snapshot.
  // Reuse that existing cache, without requesting fixtures from API-Football.
  if(!Array.isArray(found)){
   found=await cacheGet('scores:'+JSON.stringify(['date',{date:date}]));
  }
  if(Array.isArray(found)){
   fixtures.push(...found);
   // A saved schedule is not evidence that the completed results are cached.
   // Mark dates incomplete when they still have games without a final status.
   if(found.some(f=>f&&['NS','TBD','1H','HT','2H','ET','BT','P','LIVE','SUSP','INT'].includes(f.statusShort)))
    missing.push(date);
  }else missing.push(date);
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


function imageUrl(url){
 const x=String(url||'');
 if(!/^https:\/\/[a-z0-9.-]+\/[^\s"'<>]*$/i.test(x))return '';
 return esc(x);
}
function crest(url,size=36){
 const u=imageUrl(url);
 return u?'<img alt="" src="'+u+'" width="'+size+'" height="'+size+'" style="width:'+size+'px;height:'+size+'px;object-fit:contain;vertical-align:middle;border:0;display:block" />':'<span style="display:inline-block;width:'+size+'px;height:'+size+'px;text-align:center;line-height:'+size+'px;border-radius:50%;background:#352548;color:#fff;font:bold 16px Arial">★</span>';
}
function html(matches,favorites,missing,news=[],base='',isPreview=true){
 const safeBase=/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)?base:'';
 const follows=favorites.filter(x=>(x.type==='club'||x.type==='league')&&x.name).slice(0,12);
 let cards='';
 for(let i=0;i<follows.length;i+=2)cards+='<tr>'+follows.slice(i,i+2).map(x=>'<td width="50%" valign="top" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #4b385f;background:#25192f;border-radius:11px"><tr><td width="46" style="padding:12px 0 12px 12px">'+crest(x.badge,34)+'</td><td style="padding:12px 9px;color:#fff;font:bold 13px Arial,sans-serif">'+esc(x.name)+'<div style="font:10px Arial,sans-serif;color:#ab96bb;letter-spacing:1px;margin-top:5px">'+(x.type==='league'?'LEAGUE':'CLUB')+'</div></td></tr></table></td>').join('')+(i+1>=follows.length?'<td width="50%"></td>':'')+'</tr>';
 const scoreCards=matches.map(f=>{
  const date=String(f.date||'').slice(0,10);
  const details=esc((f.league&&f.league.name)||'Football')+' · '+esc(date);
  return '<tr><td style="padding:7px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #4b385f;background:#24162e;border-radius:12px"><tr><td colspan="3" style="padding:11px 16px;color:#aa96bc;font:11px Arial,sans-serif">'+details+'</td></tr><tr><td width="40%" align="center" style="padding:10px 5px 17px;color:#fff;font:bold 13px Arial,sans-serif">'+crest(f.home.logo,34)+'<div style="margin-top:8px">'+esc(f.home.name)+'</div></td><td width="20%" align="center" style="padding:10px 4px 17px;color:#fff;font:bold 24px Arial,sans-serif;white-space:nowrap">'+f.goals.home+'–'+f.goals.away+'<div style="font:10px Arial,sans-serif;color:#b6a0cb;margin-top:8px">FULL TIME</div></td><td width="40%" align="center" style="padding:10px 5px 17px;color:#fff;font:bold 13px Arial,sans-serif">'+crest(f.away.logo,34)+'<div style="margin-top:8px">'+esc(f.away.name)+'</div></td></tr></table></td></tr>';
 }).join('');
 const articles=news.map((a,i)=>{
  const link=safeBase+'/news-article.html?slug='+encodeURIComponent(a.slug);
  const lead=i===0;
  const img=imageUrl(a.image_url);
  return '<tr><td style="padding:8px 0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#24172f;border:1px solid #48345a;border-radius:12px"><tr><td style="padding:18px 20px">'+(lead?'<div style="font:bold 10px Arial,sans-serif;color:#ff9b4a;letter-spacing:2px;margin-bottom:10px">TOP STORY FOR YOU</div>':'')+(img?'<img src="'+img+'" alt="" width="510" style="display:block;width:100%;max-width:510px;height:auto;border:0;border-radius:8px;margin-bottom:13px" />':'')+'<a href="'+esc(link)+'" style="color:#fff;text-decoration:none;font:bold '+(lead?'20':'16')+'px Arial,sans-serif;line-height:1.35">'+esc(a.title)+'</a><p style="color:#c5b5d2;font:13px/1.6 Arial,sans-serif;margin:10px 0 12px">'+esc(String(a.summary||'').slice(0,200))+'</p><a href="'+esc(link)+'" style="color:#c59bff;font:bold 12px Arial,sans-serif;text-decoration:underline">READ STORY →</a></td></tr></table></td></tr>';
 }).join('');
 const fallback= '<tr><td style="padding:17px 20px;background:#24172f;border-radius:9px;color:#cbb8d9;font:13px/1.6 Arial,sans-serif">No completed results are available for your followed clubs in the saved data this week.</td></tr>';
 const note=missing.length?'<tr><td style="padding:12px 18px;background:#392918;border:1px solid #6d512f;color:#ffd6a9;font:12px/1.5 Arial,sans-serif;border-radius:8px">Some dates were not saved, so this results section may be incomplete.</td></tr>':'';
 const heading=(title,eyebrow)=>'<tr><td style="padding:28px 0 12px"><div style="font:bold 10px Arial,sans-serif;letter-spacing:2px;color:#ff9b4a">'+eyebrow+'</div><div style="font:bold 22px Arial,sans-serif;color:#fff;margin-top:7px">'+title+'</div></td></tr>';
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b0712"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0b0712"><tr><td align="center" style="padding:26px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#1a1024;border:1px solid #372443"><tr><td align="center" style="padding:34px 24px 30px;background:#21122f"><div style="color:#ff9b4a;font:bold 12px Arial,sans-serif;letter-spacing:3px">FOOTBALL STORIES 96</div><div style="margin-top:12px;color:#a373ff;font:bold 11px Arial,sans-serif;letter-spacing:2px">THE PERSONAL EDITION</div><h1 style="margin:16px 0 12px;color:#fff;font:bold 36px/1.1 Arial,sans-serif">YOUR CLUBS<br><span style="color:#bc91ff">THIS WEEK</span></h1><p style="color:#c4b2d2;font:14px/1.5 Arial,sans-serif;margin:0">Results and stories picked for the teams and leagues you follow.</p></td></tr><tr><td style="padding:0 24px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'+heading('YOUR FOLLOWING','HANDPICKED FOR YOU')+(cards?'<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'+cards+'</table></td></tr>':'<tr><td style="color:#cdbbd9;font:13px Arial,sans-serif">Follow a club or league to personalize your next edition.</td></tr>')+heading('MATCH RESULTS','YOUR CLUBS ON THE PITCH')+note+(scoreCards||fallback)+heading('LATEST STORIES','NEWS ABOUT YOUR FOLLOWS')+(articles||'<tr><td style="padding:17px 20px;color:#cbb8d9;background:#24172f;font:13px Arial,sans-serif">No new matching stories published this week.</td></tr>')+'</table></td></tr><tr><td align="center" style="padding:24px;background:#120c1b;border-top:1px solid #3b2a47"><div style="color:#f5efff;font:bold 13px Arial,sans-serif">FOOTBALL STORIES 96</div><p style="color:#a995b9;font:12px/1.5 Arial,sans-serif">Your football. Your teams. Your stories.</p>'+(isPreview?'<p style="color:#aaa0b3;font:11px Arial,sans-serif">Preview only — no email sent.</p>':'')+(safeBase?'<a href="'+esc(safeBase+'/account.html#preferences')+'" style="color:#c79bff;font:12px Arial,sans-serif">Manage email preferences</a>':'')+'</td></tr></table></td></tr></table></body></html>';
}

module.exports={getResults,getNews,html};
