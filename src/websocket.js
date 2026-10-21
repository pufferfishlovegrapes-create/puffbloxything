'use strict';

const https = require('node:https');
const WebSocket = require('ws');
const { assertSafeUrl, resolveAndValidate } = require('./policy');

function attachWebSocketProxy(server, config, logger) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', async (request, socket, head) => {
    if (!config.enableWebSockets) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!request.url.startsWith('/ws/')) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    try {
      const requestPath = request.url.slice(4).split('?')[0];
      let path;
      try { path = decodeURIComponent(requestPath); } catch { throw new Error('Malformed WebSocket path'); }
      if (!config.websocketPaths.includes(path)) throw new Error('WebSocket path is not explicitly approved in WEBSOCKET_PATHS');
      const upstream = assertSafeUrl(new URL(path, config.upstreamOrigin), config);
      if (upstream.hostname.toLowerCase() !== config.upstreamHost) throw new Error('WebSocket upstream is not the configured primary host');
      if (upstream.protocol !== 'https:') throw new Error('Only secure WSS upstream connections are permitted');
      const { addresses } = await resolveAndValidate(upstream, config);
      wss.handleUpgrade(request, socket, head, (client) => {
        const target = `wss://${upstream.host}${upstream.pathname}${upstream.search}`;
        const upstreamSocket = new WebSocket(target, {
          headers: { 'User-Agent': 'PuffProxy/1.0', ...(request.headers.cookie ? { Cookie: request.headers.cookie } : {}) },
          maxPayload: 1024 * 1024,
          perMessageDeflate: false,
          handshakeTimeout: 15000,
          agent: new https.Agent({ keepAlive: false, lookup: (hostname, options, callback) => {
            const cb = typeof options === 'function' ? options : callback;
            if (hostname.toLowerCase() !== upstream.hostname.toLowerCase()) return cb(new Error('DNS pinning mismatch'));
            const address = addresses[0];
            if (typeof options === 'object' && options.all) return cb(null, addresses.map((ip) => ({ address: ip, family: ip.includes(':') ? 6 : 4 })));
            cb(null, address, address.includes(':') ? 6 : 4);
          } }),
        });
        const closeBoth = () => { if (client.readyState < WebSocket.CLOSING) client.close(); if (upstreamSocket.readyState < WebSocket.CLOSING) upstreamSocket.close(); };
        client.on('message', (data, isBinary) => { if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary: isBinary }); });
        upstreamSocket.on('message', (data, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary }); });
        client.on('close', closeBoth); upstreamSocket.on('close', closeBoth);
        client.on('error', (error) => logger.warn({ event: 'websocket_client_error', error: error.message }));
        upstreamSocket.on('error', (error) => { logger.warn({ event: 'websocket_upstream_error', error: error.message }); closeBoth(); });
      });
    } catch (error) {
      logger.warn({ event: 'websocket_rejected', error: error.message });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy();
    }
  });
  return wss;
}

module.exports = { attachWebSocketProxy };
