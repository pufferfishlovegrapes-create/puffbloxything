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

// Scramjet v1's "loadConfig" message only sets scramjet.config, not the module-level
// config its URL codec reads, so loadConfig() would then return early and leave the
// codec without a prefix. Treat that message as "config changed" and force a full
// reload from IndexedDB (which the controller writes before posting it).
let configStale = true;
self.addEventListener('message', (event) => {
  if (event.data && event.data.scramjet$type === 'loadConfig') configStale = true;
});

async function handleProxiedRequest(event) {
  try {
    const scramjet = await scramjetReady;
    if (configStale) {
      scramjet.config = undefined;
      configStale = false;
    }
    await scramjet.loadConfig();
    if (!scramjet.config) {
      configStale = true;
      throw new Error('Proxy settings are not ready yet.');
    }
    if (scramjet.route(event)) return await scramjet.fetch(event);
  } catch (error) {
    console.error('PuffProxy service worker failed to proxy request:', error);
    const detail = (error && (error.stack || error.message)) || String(error);
    return new Response(`PuffProxy could not load this page. Go back and press Retry.\n\n${detail}`, {
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
