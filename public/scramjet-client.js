'use strict';

(() => {
  const loader = document.getElementById('loader');
  const status = document.getElementById('status');
  const retry = document.getElementById('retry');
  const fullscreenButton = document.getElementById('fullscreen');
  const TARGET_URL = JSON.parse(document.getElementById('proxy-target').textContent).url;
  const RELOAD_FLAG = 'puffproxy:sw-reload';

  const setStatus = (text) => { status.textContent = text; };

  function showError(error) {
    loader.hidden = false;
    loader.classList.remove('fade');
    loader.classList.add('error');
    setStatus(`PuffProxy could not start: ${(error && error.message) || error}`);
    console.error('PuffProxy startup error', error);
  }

  // Scramjet only works once the service worker controls this page. On the very
  // first visit the page is uncontrolled until clients.claim() runs; if that never
  // happens (some browsers), reload once so the worker takes control.
  async function waitForController() {
    if (navigator.serviceWorker.controller) return;
    const controlled = await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true });
      setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), 4000);
    });
    if (controlled) return;
    if (!sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      location.reload();
      await new Promise(() => {});
    }
    throw new Error('The service worker did not take control of the page. Reload to try again.');
  }

  async function start() {
    if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
    if (!window.isSecureContext) throw new Error('PuffProxy must be opened over HTTPS (or localhost).');

    setStatus('Preparing storage…');
    await window.ensureScramjetDB({
      beforeRepair: async () => {
        setStatus('Repairing PuffProxy storage…');
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      },
      onBlocked: () => setStatus('Repairing storage… close other PuffProxy tabs if this persists.'),
    });

    setStatus('Starting proxy engine…');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    registration.update().catch(() => {});
    await navigator.serviceWorker.ready;
    await waitForController();
    sessionStorage.removeItem(RELOAD_FLAG);

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

    setStatus('Connecting…');
    const connection = new BareMux.BareMuxConnection('/baremux/worker.js');
    const wispUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/wisp/`;
    await connection.setTransport('/libcurl/index.mjs', [{ websocket: wispUrl }]);

    setStatus('Loading game…');
    const frame = scramjet.createFrame();
    frame.frame.id = 'game';
    frame.frame.title = 'EasyFun cloud games';
    frame.frame.allow = 'fullscreen; autoplay; gamepad; pointer-lock; keyboard-map; clipboard-read; clipboard-write';
    frame.frame.allowFullscreen = true;
    const onLoad = () => {
      if (!frame.frame.getAttribute('src')) return;
      frame.frame.removeEventListener('load', onLoad);
      loader.classList.add('fade');
      setTimeout(() => { loader.hidden = true; }, 300);
      frame.frame.focus();
    };
    frame.frame.addEventListener('load', onLoad);
    document.body.prepend(frame.frame);
    frame.go(TARGET_URL);
    setupFullscreen();
  }

  function setupFullscreen() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) return;
    const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    const sync = () => { fullscreenButton.hidden = isFullscreen(); };
    fullscreenButton.addEventListener('click', () => {
      Promise.resolve(request.call(root, { navigationUI: 'hide' })).catch(() => {});
    });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
  }

  retry.addEventListener('click', () => location.reload());
  start().catch(showError);
})();
