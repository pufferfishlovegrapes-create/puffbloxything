'use strict';

(async () => {
  const status = document.getElementById('status');
  try {
    if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) return resolve();
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 2500);
    });

    const { ScramjetController } = $scramjetLoadController();
    const scramjet = new ScramjetController({
      prefix: '/scramjet/',
      files: {
        wasm: '/scram/scramjet.wasm.wasm',
        all: '/scram/scramjet.all.js',
        sync: '/scram/scramjet.sync.js',
      },
    });
    await scramjet.init();

    const connection = new BareMux.BareMuxConnection('/baremux/worker.js');
    const wispUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/wisp/`;
    await connection.setTransport('/libcurl/index.mjs', [{ websocket: wispUrl }]);

    const frame = scramjet.createFrame();
    frame.frame.id = 'game';
    frame.frame.title = 'EasyFun cloud games';
    frame.frame.allow = 'fullscreen; autoplay; gamepad; clipboard-read; clipboard-write';
    frame.frame.allowFullscreen = true;
    document.body.appendChild(frame.frame);
    status.hidden = true;
    frame.go('https://www.easyfun.gg/cloud-games/roblox.html');
  } catch (error) {
    status.textContent = `PuffProxy could not start: ${error.message || error}`;
    console.error('PuffProxy startup error', error);
  }
})();
