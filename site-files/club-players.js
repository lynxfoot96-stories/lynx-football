/* club-players.js — Key Players tab. Needs club-players-data.js.
   FSKeyPlayers.mount(el, {club:'real-madrid', league:140, leagueName:'La Liga'})
   Players who appear in /api/stats top scorers (their league, and the Champions League) get a goals badge. */
(function(){
'use strict';
var css='.kp-head{margin-bottom:26px}.kp-head h2{font-size:30px;text-transform:uppercase}.kp-head p{color:var(--muted);margin-top:6px;font-size:14.5px}'+
'.kp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}@media(max-width:960px){.kp-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.kp-grid{grid-template-columns:1fr}}'+
'.kp-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;transition:transform .25s,border-color .25s}.kp-card:hover{transform:translateY(-3px);border-color:var(--purple-bright)}'+
'.kp-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}.kp-pos{flex:none;min-width:44px;height:44px;padding:0 8px;border-radius:11px;display:grid;place-items:center;font:800 14px Inter;color:#fff;background:linear-gradient(135deg,#7c3aed,#6d28d9)}'+
'.kp-pos.gk{background:linear-gradient(135deg,#f59e0b,#d97706)}.kp-pos.df{background:linear-gradient(135deg,#0ea5e9,#2563eb)}.kp-pos.mf{background:linear-gradient(135deg,#10b981,#059669)}.kp-pos.fw{background:linear-gradient(135deg,#ff7a1a,#e11d48)}'+
'.kp-name{font:800 22px "Big Shoulders Display",sans-serif;text-transform:uppercase;line-height:1}'+
'.kp-goal{display:inline-flex;gap:6px;align-items:center;margin-top:5px;font:700 11px Inter;color:var(--orange-bright);background:rgba(255,122,26,.12);border:1px solid rgba(255,122,26,.3);border-radius:20px;padding:3px 9px}'+
'.kp-lbl{font:800 10.5px Inter;letter-spacing:.06em;text-transform:uppercase;color:var(--purple-bright);margin-bottom:6px}'+
'.kp-id{color:var(--muted);font-size:14.5px;line-height:1.65;flex:1}'+
'.kp-alt{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.kp-chips{display:flex;gap:6px;flex-wrap:wrap}.kp-chip{font:700 12px Inter;padding:4px 10px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line);color:var(--white)}.kp-none{color:var(--muted);font-size:13px}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
var esc=function(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var norm=function(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim()};
var grp=function(p){return p==='GK'?'gk':/B$|^CB$/.test(p)?'df':/M$|^DM$|^AM$/.test(p)?'mf':'fw'};
function same(a,b){a=norm(a);b=norm(b);if(a===b)return true;var x=a.split(' '),y=b.split(' ');
  var lx=x[x.length-1],ly=y[y.length-1];return lx===ly&&lx.length>3&&(x[0][0]===y[0][0]||x.length===1||y.length===1)}
function scorers(id){return fetch('/api/stats?league='+id+'&type=scorers').then(function(r){return r.json()}).then(function(d){return d&&d.ok?d.data:[]}).catch(function(){return[]})}
function card(p,hit){
  var alt=p[2]?p[2].split(',').map(function(a){return'<span class="kp-chip">'+esc(a.trim())+'</span>'}).join(''):'<span class="kp-none">Plays one position only</span>';
  return'<article class="kp-card"><div class="kp-top"><span class="kp-pos '+grp(p[1])+'">'+esc(p[1])+'</span><div><div class="kp-name">'+esc(p[0])+'</div>'+
  (hit?'<span class="kp-goal">&#9917; '+hit.goals+(hit.goals===1?' goal':' goals')+' &middot; #'+hit.rank+' '+esc(hit.comp)+'</span>':'')+'</div></div>'+
  '<div class="kp-lbl">Footballer identity</div><p class="kp-id">'+esc(p[3])+'</p>'+
  '<div class="kp-alt"><div class="kp-lbl">Alternative positions</div><div class="kp-chips">'+alt+'</div></div></article>'}
function mount(el,o){
  var list=(window.FS_PLAYERS||{})[o.club]||[];
  function draw(hits){el.innerHTML='<div class="kp-head"><h2 class="display">Key Players</h2><p>The '+list.length+' players who matter most this season.</p></div><div class="kp-grid">'+
    list.map(function(p){return card(p,hits.filter(function(h){return same(h.name,p[0])})[0])}).join('')+'</div>'}
  if(!list.length){el.innerHTML='<div class="club-placeholder"><div class="display">Coming soon</div></div>';return}
  draw([]);
  var jobs=[[o.league,o.leagueName||'league']].concat(o.ucl===false?[]:[[2,'Champions League']]);
  Promise.all(jobs.map(function(j){return scorers(j[0]).then(function(rows){return rows.map(function(r){return{name:r.name,goals:r.goals,rank:r.rank,comp:j[1]}})})}))
   .then(function(all){var hits=[].concat.apply([],all).sort(function(a,b){return a.rank-b.rank});if(hits.length)draw(hits)});
}
window.FSKeyPlayers={mount:mount};
})();
