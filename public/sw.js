importScripts('/scram/scramjet.all.js', '/scramjet-db.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();

// ScramjetServiceWorker opens IndexedDB in its constructor, so it must only be
// created after the database and its object stores are guaranteed to exist.
const scramjetReady = self.ensureScramjetDB().then(() => new ScramjetServiceWorker());

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function handleRequest(event) {
  const scramjet = await scramjetReady;
  if (!scramjet.route(event)) return fetch(event.request);
  await scramjet.loadConfig();
  return scramjet.fetch(event);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});
