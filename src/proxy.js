'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const cheerio = require('cheerio');
const { PolicyError, assertSafeUrl, hostnameAllowed, resolveAndValidate, rewriteRedirect } = require('./policy');

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = promisify(zlib.brotliDecompress);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host']);
const FORWARD_REQUEST = new Set(['accept', 'accept-language', 'content-type', 'content-length', 'cookie', 'range', 'if-none-match', 'if-modified-since', 'user-agent', 'referer', 'origin']);
const FORWARD_RESPONSE = new Set(['accept-ranges', 'cache-control', 'content-disposition', 'content-language', 'content-type', 'etag', 'expires', 'last-modified', 'vary', 'www-authenticate', 'content-range']);

function upstreamFromRoute(req, config) {
  const raw = req.params[0] || '';
  if (!raw) {
    const initial = new URL(config.upstreamPath, config.upstreamOrigin);
    const query = req.originalUrl.slice(req.path.length);
    if (query.startsWith('?')) initial.search = query;
    return initial;
  }
  const segments = raw.split('/');
  let host = config.upstreamHost;
  if (segments[0] && hostnameAllowed(segments[0], config.allowedHostnames)) host = segments.shift().toLowerCase();
  else if (segments[0] && segments[0].includes('.')) throw new PolicyError('Proxy hostname is not allowlisted');
  const tail = segments.join('/');
  const pathname = '/' + tail;
  let url;
  try { url = new URL(pathname + req.url.slice(req.path.length), `${config.upstreamProtocol}//${host}`); }
  catch { throw new PolicyError('Invalid proxy path'); }
  if (url.origin !== `${config.upstreamProtocol}//${host}`) throw new PolicyError('Invalid proxy path');
  assertSafeUrl(url, config);
  return url;
}

function requestHeaders(req, upstreamUrl, sameHost) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (FORWARD_REQUEST.has(lower) && !HOP_BY_HOP.has(lower) && value !== undefined) headers[lower] = value;
  }
  headers.host = upstreamUrl.host;
  headers['accept-encoding'] = 'identity';
  if (!sameHost) delete headers.cookie;
  delete headers.origin;
  delete headers.referer;
  return headers;
}

function rawRequest(url, headers, method, body, config, addresses) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const expectedHost = url.hostname.toLowerCase();
    const lookup = (hostname, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      if (hostname.toLowerCase() !== expectedHost || !addresses.length) return cb(new Error('DNS pinning mismatch'));
      const chosen = addresses[0];
      if (typeof options === 'object' && options.all) return cb(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
      return cb(null, chosen, chosen.includes(':') ? 6 : 4);
    };
    const req = transport.request(url, {
      method,
      headers,
      lookup,
      servername: netHost(url.hostname),
      timeout: config.requestTimeoutMs,
      maxHeaderSize: config.maxHeaderBytes,
      agent: false,
    }, resolve);
    req.on('timeout', () => req.destroy(new Error('Upstream request timed out')));
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

function netHost(host) { return require('node:net').isIP(host) ? undefined : host; }

async function fetchUpstream(initialUrl, method, headers, body, config, logger) {
  let url = assertSafeUrl(initialUrl, config);
  let lastHost = url.hostname.toLowerCase();
  for (let redirects = 0; redirects <= config.maxRedirects; redirects += 1) {
    const { addresses } = await resolveAndValidate(url, config);
    const response = await rawRequest(url, headers, method, body, config, addresses);
    if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location) return { response, url };
    if (redirects === config.maxRedirects) {
      response.resume();
      throw new PolicyError('Upstream redirect limit exceeded', 502);
    }
    const next = new URL(response.headers.location, url);
    assertSafeUrl(next, config);
    logger.info({ event: 'proxy_redirect', from: url.hostname, to: next.hostname, status: response.statusCode });
    const sameHost = next.hostname.toLowerCase() === lastHost;
    if (!sameHost) {
      delete headers.cookie;
      delete headers.authorization;
    }
    if (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST')) {
      method = 'GET'; body = null;
      delete headers['content-length']; delete headers['content-type'];
    }
    response.resume();
    url = next;
    lastHost = url.hostname.toLowerCase();
  }
  throw new PolicyError('Upstream redirect limit exceeded', 502);
}

function proxyPath(url, config) {
  const host = url.hostname.toLowerCase();
  assertSafeUrl(url, config);
  const path = `${url.pathname}${url.search}${url.hash}`;
  const base = config.publicBaseUrl || '';
  return `${base}/proxy/${host}/${encodeURI(path.slice(1))}`;
}

function rewriteCss(css, pageUrl, config) {
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (all, quote, value) => {
    const trimmed = value.trim();
    if (!trimmed || /^(data:|blob:|#|javascript:)/i.test(trimmed)) return all;
    try { return `url(${quote}${proxyPath(new URL(trimmed, pageUrl), config)}${quote})`; } catch { return all; }
  }).replace(/@import\s+(?:url\()?\s*(['"])(.*?)\1\s*\)?/gi, (all, quote, value) => {
    try { return all.replace(value, proxyPath(new URL(value, pageUrl), config)); } catch { return all; }
  });
}

function rewriteHtml(html, pageUrl, config) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const attrs = ['href', 'src', 'action', 'poster', 'data', 'formaction', 'cite', 'xlink:href'];
  for (const attr of attrs) {
    $('*').filter((_, el) => $(el).attr(attr) !== undefined).each((_, el) => {
      const value = $(el).attr(attr);
      if (!value || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value.trim())) return;
      try { $(el).attr(attr, proxyPath(new URL(value, pageUrl), config)); } catch { /* preserve invalid/non-web values */ }
    });
  }
  $('[srcset]').each((_, el) => {
    const rewritten = String($(el).attr('srcset')).split(',').map((item) => {
      const parts = item.trim().split(/\s+/);
      try { parts[0] = proxyPath(new URL(parts[0], pageUrl), config); } catch { return item; }
      return parts.join(' ');
    }).join(', ');
    $(el).attr('srcset', rewritten);
  });
  $('[style]').each((_, el) => $(el).attr('style', rewriteCss($(el).attr('style'), pageUrl, config)));
  $('style').each((_, el) => $(el).text(rewriteCss($(el).text(), pageUrl, config)));
  $('meta[http-equiv]').filter((_, el) => String($(el).attr('http-equiv')).toLowerCase() === 'refresh').each((_, el) => {
    const content = $(el).attr('content') || '';
    const match = content.match(/^(\s*\d+\s*;\s*url\s*=\s*)(.*)$/i);
    if (match) {
      try { $(el).attr('content', match[1] + proxyPath(new URL(match[2].replace(/^['"]|['"]$/g, ''), pageUrl), config)); } catch { /* leave as supplied */ }
    }
  });
  return $.html();
}

async function readLimited(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new PolicyError('Upstream response exceeds configured body limit', 502);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function decodeBody(buffer, encoding) {
  switch (String(encoding || '').toLowerCase()) {
    case 'gzip': return gunzip(buffer);
    case 'deflate': return inflate(buffer);
    case 'br': return brotliDecompress(buffer);
    default: return buffer;
  }
}

function mapSetCookie(cookies, upstreamUrl, config) {
  const prefix = `/proxy/${upstreamUrl.hostname.toLowerCase()}`;
  return cookies.map((cookie) => cookie
    .replace(/;\s*Domain=[^;]*/i, '')
    .replace(/;\s*Path=([^;]*)/i, (match, path) => `; Path=${prefix}${path === '/' ? '' : path}`)
    .replace(/;\s*SameSite=None/ig, '; SameSite=None'));
}

function filteredResponseHeaders(upstreamHeaders, upstreamUrl, config, rewritten = false) {
  const headers = {};
  const connectionTokens = String(upstreamHeaders.connection || '').split(',').map((token) => token.trim().toLowerCase());
  for (const [name, value] of Object.entries(upstreamHeaders)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || connectionTokens.includes(lower) || lower === 'content-length' || lower === 'content-encoding' || lower === 'set-cookie') continue;
    if (FORWARD_RESPONSE.has(lower) || lower === 'location' || lower === 'content-security-policy' || lower === 'content-security-policy-report-only' || lower === 'x-frame-options' || lower === 'refresh' || (!rewritten && lower === 'content-encoding')) headers[lower] = value;
  }
  if (upstreamHeaders['set-cookie']) headers['set-cookie'] = mapSetCookie(upstreamHeaders['set-cookie'], upstreamUrl, config);
  if (headers.location) {
    try { headers.location = rewriteRedirect(headers.location, upstreamUrl, config, config.publicBaseUrl); }
    catch { throw new PolicyError('Blocked unsafe upstream redirect'); }
  }
  if (rewritten) delete headers.etag;
  return headers;
}

async function handleProxy(req, res, config, logger) {
  const upstreamUrl = upstreamFromRoute(req, config);
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > config.maxBodyBytes) throw new PolicyError('Request body too large', 413);
  const body = ['GET', 'HEAD'].includes(req.method) ? null : (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  const headers = requestHeaders(req, upstreamUrl, upstreamUrl.hostname.toLowerCase() === config.upstreamHost);
  if (req.method === 'GET' || req.method === 'HEAD') {
    const query = req.originalUrl.slice(req.path.length);
    if (query.startsWith('?')) upstreamUrl.search = query;
  }
  const { response, url } = await fetchUpstream(upstreamUrl, req.method, headers, body, config, logger);
  const type = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
  const isHtml = type === 'text/html' || type === 'application/xhtml+xml';
  const isCss = type === 'text/css';
  const status = response.statusCode || 502;
  const respHeaders = filteredResponseHeaders(response.headers, url, config, isHtml || isCss);
  res.status(status);
  for (const [name, value] of Object.entries(respHeaders)) res.setHeader(name, value);
  res.setHeader('x-content-type-options', 'nosniff');

  if (req.method === 'HEAD' || status === 204 || status === 304) {
    response.resume(); return res.end();
  }
  if (!isHtml && !isCss) return response.pipe(res);

  const compressed = await readLimited(response, config.maxBodyBytes);
  let decoded;
  try { decoded = await decodeBody(compressed, response.headers['content-encoding']); }
  catch { throw new PolicyError('Could not decode upstream response compression', 502); }
  const text = decoded.toString('utf8');
  const output = Buffer.from(isHtml ? rewriteHtml(text, url, config) : rewriteCss(text, url, config));
  res.setHeader('content-length', String(output.length));
  res.end(output);
}

module.exports = { upstreamFromRoute, proxyPath, rewriteCss, rewriteHtml, mapSetCookie, fetchUpstream, handleProxy };
