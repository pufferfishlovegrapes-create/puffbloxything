importScripts('/scram/scramjet.all.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

async function handleRequest(event) {
  if (!scramjet.route(event)) return fetch(event.request);
  await scramjet.loadConfig();
  return scramjet.fetch(event);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});
