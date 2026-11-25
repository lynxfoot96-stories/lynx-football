/* Football Stories PWA: cache static shell only; never cache football API scores. */
const CACHE='fs-static-v5';
const SHELL=['./site-header.js','./offline.html'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.add('./offline.html');await Promise.allSettled(SHELL.filter(url=>url!=='./offline.html').map(url=>cache.add(url)));await self.skipWaiting();})());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('fs-static-')&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/'))return; // live data always belongs to backend
  if(req.mode==='navigate'){
    event.respondWith(fetch(req,{cache:'no-cache'}).catch(async()=>await caches.match('./offline.html')||new Response('Football Stories is offline. Reconnect and reload.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
    return;
  }
  if(!/\.(?:js|css|png|svg|webp|ico)$/i.test(url.pathname))return;
  event.respondWith(fetch(req).then(res=>{
    if(res.ok && !res.redirected && !/\b(?:no-store|private)\b/i.test(res.headers.get('Cache-Control')||'')){const copy=res.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{}));}
    return res;
  }).catch(async()=>await caches.match(req)||Response.error()));
});