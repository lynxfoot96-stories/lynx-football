/* Football Stories PWA: network-first navigation; no caching of API responses. */
const VERSION='fs-shell-v1';
const OFFLINE='./offline.html';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.add(OFFLINE)));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fs-shell-')&&k!==VERSION).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  // Never intercept scores, player data, match data, or other backend endpoints.
  if(url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.match(OFFLINE)));
  }
});
