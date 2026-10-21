importScripts('/scram/scramjet.all.js', '/scramjet-db.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();

const SCRAMJET_PREFIX = '/scramjet/';

// ScramjetServiceWorker opens IndexedDB in its constructor, so it must only be
// created after the database and its object stores are guaranteed to exist.
const scramjetReady = self.ensureScramjetDB().then(() => new ScramjetServiceWorker());

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function isProxiedRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.startsWith(SCRAMJET_PREFIX);
}

async function handleProxiedRequest(event) {
  try {
    const scramjet = await scramjetReady;
    await scramjet.loadConfig();
    if (scramjet.route(event)) return await scramjet.fetch(event);
  } catch (error) {
    console.error('PuffProxy service worker failed to proxy request:', error);
    return new Response('PuffProxy could not load this page. Go back and press Retry.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return fetch(event.request);
}

// Only intercept proxied URLs. The app shell (and the v0 preview's own auth
// redirects) must go straight to the network so a worker failure can never
// make the site itself unreachable.
self.addEventListener('fetch', (event) => {
  if (!isProxiedRequest(event.request)) return;
  event.respondWith(handleProxiedRequest(event));
});
