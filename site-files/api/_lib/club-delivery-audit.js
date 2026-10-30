'use strict';
// Dry-run audit: no emails sent, no contacts changed, no external football requests.
const {getResults,getNews}=require('./club-results');
const MAX_CONTACTS=300, PAGE=50;
function listId(){
 const n=Number(process.env.BREVO_CLUB_RESULTS_LIST_ID),news=Number(process.env.BREVO_LIST_ID);
 if(!Number.isSafeInteger(n)||n<=0||n===news)throw Error('separate_club_list_required');
 return n;
}
async function json(url,headers){
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('remote_read_failed_'+r.status);
 return r.json();
}
async function members(){
 const list=listId(),key=process.env.BREVO_API_KEY;
 if(!key)throw Error('brevo_key_missing');
 const emails=new Set();
 for(let offset=0;offset<MAX_CONTACTS;offset+=PAGE){
  const data=await json('https://api.brevo.com/v3/contacts/lists/'+list+'/contacts?limit='+PAGE+'&offset='+offset,
   {'api-key':key,accept:'application/json'});
  const a=Array.isArray(data.contacts)?data.contacts:[];
  for(const contact of a){
   if(contact.email&&!contact.emailBlacklisted)emails.add(String(contact.email).trim().toLowerCase());
  }
  if(a.length<PAGE)return emails;
 }
 throw Error('recipient_cap_reached_pagination_required');
}
async function accounts(){
 const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('supabase_admin_not_configured');
 const result=[];
 for(let page=1;page<=10;page++){
  const data=await json(url+'/auth/v1/admin/users?page='+page+'&per_page='+PAGE,
   {apikey:key,Authorization:'Bearer '+key});
  const users=Array.isArray(data.users)?data.users:[];
  result.push(...users);
  if(users.length<PAGE)return result;
 }
 throw Error('account_cap_reached_pagination_required');
}
async function handleClubDeliveryAudit(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
  return res.status(401).json({ok:false,error:'unauthorized'});
 try{
  const allowed=await members();
  const users=await accounts();
  const eligible=users.filter(u=>u.email&&allowed.has(String(u.email).toLowerCase())&&u.email_confirmed_at);
  const previews=[];
  for(let i=0;i<eligible.length;i++){
   const u=eligible[i],f=Array.isArray(u.user_metadata&&u.user_metadata.fs_favorites)?u.user_metadata.fs_favorites:[];
   const clubs=f.filter(x=>x&&x.type==='club'),leagues=f.filter(x=>x&&x.type==='league');
   if(!clubs.length&&!leagues.length)continue;
   const [results,news]=await Promise.all([getResults(clubs),getNews(f)]);
   previews.push({recipientIndex:i+1,clubCount:clubs.length,leagueCount:leagues.length,
    matchCount:results.matches.length,newsCount:news.length,missingScoreDays:results.missing.length});
  }
  console.info('[club-delivery-audit] completed', JSON.stringify({
   dryRun:true,emailsSent:0,listSubscriberCount:allowed.size,
   matchedAccounts:eligible.length,personalizedPreviews:previews.length,
   totalMatches:previews.reduce((n,x)=>n+x.matchCount,0),
   totalNews:previews.reduce((n,x)=>n+x.newsCount,0),
   recipientsWithMissingScoreDays:previews.filter(x=>x.missingScoreDays>0).length
  }));
  return res.status(200).json({ok:true,dryRun:true,emailsSent:0,contactsModified:0,
   listSubscriberCount:allowed.size,matchedAccounts:eligible.length,personalizedPreviews:previews,
   skippedNoFollows:eligible.length-previews.length,
   note:'No delivery performed. Existing published news and cached scores only.'});
 }catch(e){
  console.error('[club-delivery-audit]',e.message);
  return res.status(502).json({ok:false,error:'delivery_audit_failed_check_logs'});
 }
}
module.exports={handleClubDeliveryAudit,members,accounts};
