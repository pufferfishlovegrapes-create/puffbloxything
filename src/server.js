'use strict';

require('dotenv').config();
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const { loadConfig } = require('./config');
const { configureWisp } = require('./scramjet-config');
const { approvedWispDestination } = require('./wisp-policy');
const { attachScramjetAssets } = require('./scramjet-assets');
const { PolicyError } = require('./policy');
const { handleProxy } = require('./proxy');
const { attachWebSocketProxy } = require('./websocket');

const config = loadConfig();
const app = express();
const server = http.createServer({ maxHeaderSize: config.maxHeaderBytes, requestTimeout: config.requestTimeoutMs, headersTimeout: 15_000, keepAliveTimeout: 5_000 }, app);
const logger = {
  info: (fields) => process.stdout.write(`${JSON.stringify({ level: 'info', time: new Date().toISOString(), ...fields })}\n`),
  warn: (fields) => process.stderr.write(`${JSON.stringify({ level: 'warn', time: new Date().toISOString(), ...fields })}\n`),
  error: (fields) => process.stderr.write(`${JSON.stringify({ level: 'error', time: new Date().toISOString(), ...fields })}\n`),
};

app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('x-request-id', require('node:crypto').randomUUID());
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/proxy', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Rate limit exceeded' } }));
app.use(express.raw({ type: '*/*', limit: config.maxBodyBytes }));
for (const file of ['scramjet-client.js', 'scramjet-db.js']) {
  app.get(`/${file}`, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'public', file));
  });
}

// Scramjet worker and transport assets are first-party self-hosted static files.
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
attachScramjetAssets(app);
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok', engine: 'scramjet' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.all(['/proxy', '/proxy/*'], async (req, res, next) => {
  try {
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return res.sendStatus(405);
    await handleProxy(req, res, config, logger);
  } catch (error) { next(error); }
});

app.use((error, req, res, _next) => {
  const status = error instanceof PolicyError ? error.status : (error.status === 413 ? 413 : 502);
  logger.error({ event: 'request_failed', requestId: res.getHeader('x-request-id'), method: req.method, path: req.path, status, error: error.message });
  if (res.headersSent) return res.destroy(error);
  res.status(status).type('text/plain').send(status === 502 ? 'Upstream request failed or was blocked.' : error.message);
});

// Wisp provides Scramjet's transport. Its hostname whitelist is exact and its
// built-in destination-IP checks block private, loopback, link-local and reserved IPs.
const { server: wisp, logging: wispLogging } = require('@mercuryworkshop/wisp-js/server');
wispLogging.set_level(wispLogging.NONE);
configureWisp(wisp.options, config.allowedHostnames, { allowAnyHost: config.wispAllowAnyHost });
function isSameOriginUpgrade(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (config.publicBaseUrl && origin === config.publicBaseUrl) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHosts = [req.headers['x-forwarded-host'], req.headers.host]
      .filter(Boolean)
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim().toLowerCase());
    return requestHosts.includes(originHost);
  } catch {
    return false;
  }
}

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/wisp/' && isSameOriginUpgrade(req)) {
    try { wisp.routeRequest(req, socket, head); }
    catch (error) { logger.warn({ event: 'wisp_upgrade_rejected', error: error.message }); socket.destroy(); }
    return;
  }
  socket.destroy();
});

// Wisp is the only Scramjet transport; the legacy gated socket module stays disabled.

server.listen(config.port, '0.0.0.0', () => logger.info({ event: 'server_listening', port: config.port, upstream: config.upstreamOrigin, engine: 'scramjet', wisp: true, wispHosts: config.wispAllowAnyHost ? 'any-public' : config.allowedHostnames }));

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'shutdown_started', signal });
  server.close((error) => {
    if (error) { logger.error({ event: 'shutdown_error', error: error.message }); process.exitCode = 1; }
    else logger.info({ event: 'shutdown_complete' });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, config };
