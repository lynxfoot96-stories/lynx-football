'use strict';
// Monday Football Debrief — Brevo draft for editorial review.
// Reuses published Football Stories articles from Supabase. No football API or AI calls.
const db = require('../../lib/news/db');
const TZ = 'Europe/Lisbon';
function localDate(d){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function addDays(s,n){const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);}
function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function verifiedUrl(url){return /^https:\/\//i.test(String(url||''))?url:'';}
async function redis(parts){
 const url=process.env.UPSTASH_REDIS_REST_URL, token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)throw Error('Shared Redis required for safe debrief drafts');
 const r=await fetch(url.replace(/\/$/,'')+'/'+parts.map(encodeURIComponent).join('/'),{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(9000)
 });
 if(!r.ok)throw Error('Redis unavailable ('+r.status+')');
 const j=await r.json();if(j.error)throw Error('Redis command rejected');
 return j.result;
}
async function brevo(path,body){
 const r=await fetch('https://api.brevo.com/v3'+path,{method:'POST',headers:{
  'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'
 },body:JSON.stringify(body),signal:AbortSignal.timeout(14000)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||!data.id)throw Error('Brevo draft creation not confirmed ('+r.status+'); inspect dashboard before retry');
 return data;
}
function quality(a){
 const t=(a.title+' '+(a.summary||'')).toLowerCase();
 let v=0;
 for(const term of ['champions league','premier league','la liga','real madrid','barcelona','liverpool','arsenal','bayern','psg','manchester','juventus','inter','title race','derby','clasico','final','record','hat-trick'])if(t.includes(term))v+=2;
 return v;
}
function buildHtml(articles,weekend,base){
 const lead=articles[0],other=articles.slice(1,5);
 const url=a=>a.demo?base+'/news.html':base+'/news-article.html?slug='+encodeURIComponent(a.slug);
 const text=a=>esc(String(a.summary||'').slice(0,230));
 const link=(a,label)=>'<a href="'+esc(url(a))+'" style="color:#CAAAFF;text-decoration:underline">'+esc(label)+'</a>';
 const main='<tr><td style="padding:24px;background:#211332"><div style="color:#FFA65C;letter-spacing:2px;font:700 11px Arial,sans-serif">THE WEEKEND HEADLINE</div><div style="color:#FFFFFF;font:700 25px/1.25 Arial,sans-serif;margin:12px 0">'+esc(lead.title)+'</div><p style="color:#D7CFE1;font:14px/1.7 Arial,sans-serif">'+text(lead)+'</p>'+link(lead,'Read the full story')+'</td></tr>';
 const rows=other.map((a,i)=>'<tr><td style="padding:17px 22px;border-top:1px solid #40344C"><div style="color:#B98CFF;font:700 10px Arial,sans-serif;letter-spacing:1px">STORY '+(i+2)+'</div><div style="color:#FFFFFF;font:700 17px/1.4 Arial,sans-serif;margin:7px 0">'+esc(a.title)+'</div><p style="color:#C1B5CD;font:13px/1.6 Arial,sans-serif;margin:8px 0">'+text(a)+'</p>'+link(a,'Read story')+'</td></tr>').join('');
 return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0B090F;margin:0;padding:24px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="600" style="max-width:600px;width:100%;border-collapse:collapse;background:#130F1A;border:1px solid #392E45"><tr><td style="padding:38px 20px;text-align:center;background:#20132F"><div style="font:800 13px Arial,sans-serif;letter-spacing:2px;color:#FFFFFF">FOOTBALL STORIES 96</div><div style="font:700 12px Arial,sans-serif;color:#FFAB66;margin-top:24px;letter-spacing:2px">THE MONDAY EDITION</div><div style="font:bold 42px/1.1 Impact,Arial,sans-serif;color:#FFFFFF;margin:12px 0">FOOTBALL <span style="color:#B98CFF">DEBRIEF</span></div><div style="font:13px Arial,sans-serif;color:#BFB2CD">Your weekend stories, all in one place · '+esc(weekend)+'</div></td></tr>'+main+rows+'<tr><td align="center" style="padding:28px"><a href="'+esc(base)+'/news.html" style="display:inline-block;background:#873CF7;color:#FFFFFF;padding:14px 25px;text-decoration:none;font:700 14px Arial,sans-serif;border-radius:8px">MORE FOOTBALL NEWS</a></td></tr><tr><td style="text-align:center;padding:18px 26px 28px;font:12px/1.7 Arial,sans-serif;color:#A79AB7;background:#0F0B16">Football Stories 96<br>You received this because you subscribed to the newsletter.<br><a href="{{ unsubscribe }}" style="color:#CAAAFF">Unsubscribe</a></td></tr></table></td></tr></table></body></html>';
}
async function handleMondayDebrief(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||String(req.headers.authorization||'')!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({ok:false,error:'unauthorized'});
 const q=req.query||{},dry=String(q.dry||'')==='1',test=String(q.test||'')==='1';
 try{
  const now=new Date();
  const weekday=new Intl.DateTimeFormat('en-US',{timeZone:TZ,weekday:'short'}).format(now);
  if(weekday!=='Mon'&&!dry&&!test)return res.status(200).json({ok:true,skipped:'not_monday_lisbon'});
  const monday=localDate(now);
  const fri=addDays(monday,-3),sun=addDays(monday,-1);
  // Load already-published articles; never create stories or consume football API quotas.
  const sample=test&&String(q.sample||'')==='1';
  const all=sample?[]:await db.listPublished({limit:120,compact:true});
  const relevant=all.filter(a=>{
   const d=String(a.published_date||a.created_at||'').slice(0,10);
   return d>=fri&&d<=sun&&a.title&&a.slug;
  });
  relevant.sort((a,b)=>quality(b)-quality(a)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const selected=sample ? [{title:'SAMPLE: Weekend headline',summary:'Demonstration text, not real football news.',slug:'sample',demo:true},{title:'SAMPLE: Football weekend roundup',summary:'Sample text for checking the design.',slug:'sample2',demo:true}] : relevant.slice(0,5);
  if(!selected.length)return res.status(200).json({ok:true,skipped:'no_published_weekend_articles',dates:[fri,sun]});
  const base=verifiedUrl(process.env.SITE_URL)||(req.headers.host?'https://'+req.headers.host:'');
  const html=buildHtml(selected,fri+' — '+sun,base);
  if(dry){res.setHeader('Content-Type','text/html; charset=utf-8');return res.status(200).send(html);}
  const list=Number(process.env.BREVO_LIST_ID),sender=process.env.BREVO_SENDER_EMAIL;
  if(!process.env.BREVO_API_KEY||!Number.isSafeInteger(list)||list<=0||!sender)throw Error('Brevo configuration incomplete');
  // Idempotent reservation; never retry an ambiguous Brevo creation automatically.
  const key='monday-debrief:draft:'+monday;
  const reserved=await redis(['SET',key,'reserved','NX','EX',String(14*86400)]);
  if(reserved===null)return res.status(200).json({ok:true,skipped:'draft_already_attempted_check_brevo'});
  if(reserved!=='OK')throw Error('Cannot confirm Redis reservation');
  const campaign=await brevo('/emailCampaigns',{name:'Monday Football Debrief '+monday,subject:'Monday Football Debrief: '+selected[0].title,
    sender:{name:process.env.BREVO_SENDER_NAME||'Football Stories 96',email:sender},
    recipients:{listIds:[list]},htmlContent:html});
  await redis(['SET',key,'draft:'+campaign.id,'EX',String(14*86400)]);
  return res.status(200).json({ok:true,createdDraft:true,automatic:false,campaignId:campaign.id,headlines:selected.map(a=>a.title)});
 }catch(e){console.error('[monday-debrief]',e.message);return res.status(502).json({ok:false,error:'debrief_failed_review_logs'});}
}
module.exports={handleMondayDebrief};
