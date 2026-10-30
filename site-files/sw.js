/* Football Stories PWA: cache static shell only; never cache football API scores. */
const CACHE='fs-static-v1';
const SHELL=['./index.html','./site-header.js','./offline.html'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(url=>cache.add(url)))));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('fs-static-')&&key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/'))return; // live data always belongs to backend
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(()=>caches.match('./offline.html')));
    return;
  }
  if(!/\.(?:js|css|png|svg|webp|ico)$/i.test(url.pathname))return;
  event.respondWith(fetch(req).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
    return res;
  }).catch(()=>caches.match(req)));
});