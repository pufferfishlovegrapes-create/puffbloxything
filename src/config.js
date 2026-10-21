'use strict';

const { URL } = require('node:url');

function requiredOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid absolute URL origin`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must contain only an http(s) origin, with no credentials, path, query, or fragment`);
  }
  return url.origin;
}

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const origin = requiredOrigin(env.UPSTREAM_ORIGIN || 'https://www.easyfun.gg', 'UPSTREAM_ORIGIN');
  const upstream = new URL(origin);
  const upstreamPath = env.UPSTREAM_PATH || '/cloud-games/roblox.html';
  if (!upstreamPath.startsWith('/') || upstreamPath.startsWith('//') || /[\r\n\\]/.test(upstreamPath)) {
    throw new Error('UPSTREAM_PATH must be an origin-relative path beginning with one slash');
  }
  const upstreamUrl = new URL(upstreamPath, origin);
  if (upstreamUrl.origin !== origin) throw new Error('UPSTREAM_PATH cannot change the upstream origin');
  const extraHosts = (env.ALLOWED_HOSTNAMES || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  const allowedHostnames = [...new Set([upstream.hostname.toLowerCase(), ...extraHosts])];
  const hostnamePattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  for (const hostname of allowedHostnames) {
    const candidate = hostname.startsWith('*.') ? hostname.slice(2) : hostname;
    if (!hostnamePattern.test(candidate)) throw new Error(`Invalid hostname in ALLOWED_HOSTNAMES: ${hostname}`);
    if (hostname.startsWith('*.') && candidate.split('.').length < 2) throw new Error('Wildcard allowlist entries must be subdomains, e.g. *.assets.example.com');
  }
  const websocketPaths = (env.WEBSOCKET_PATHS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (websocketPaths.some((entry) => !entry.startsWith('/') || entry.startsWith('//') || /[?#\\]/.test(entry))) {
    throw new Error('WEBSOCKET_PATHS entries must be exact origin-relative paths without query strings or fragments');
  }
  const publicBaseUrl = env.PUBLIC_BASE_URL ? requiredOrigin(env.PUBLIC_BASE_URL, 'PUBLIC_BASE_URL') : '';
  if (publicBaseUrl && new URL(publicBaseUrl).protocol !== upstream.protocol) throw new Error('PUBLIC_BASE_URL and UPSTREAM_ORIGIN must both use the same HTTP or HTTPS scheme for the self-hosted transport');
  return Object.freeze({
    port, upstreamOrigin: origin, upstreamHost: upstream.hostname.toLowerCase(),
    upstreamPath: upstreamUrl.pathname + upstreamUrl.search, upstreamProtocol: upstream.protocol,
    allowedHostnames, publicBaseUrl,
    wispAllowAnyHost: String(env.WISP_ALLOW_ANY_HOST || '').toLowerCase() === 'true',
    enableWebSockets: String(env.ENABLE_WEBSOCKETS || '').toLowerCase() === 'true', websocketPaths,
    requestTimeoutMs: 30_000, responseTimeoutMs: 90_000, maxBodyBytes: 10 * 1024 * 1024,
    maxRedirects: 5, maxHeaderBytes: 16 * 1024,
  });
}

module.exports = { loadConfig };
