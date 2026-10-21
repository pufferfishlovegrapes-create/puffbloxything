'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const ipaddr = require('ipaddr.js');

class PolicyError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'PolicyError';
    this.status = status;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.$/, '');
}

function hostnameAllowed(hostname, allowlist) {
  const host = normalizeHostname(hostname);
  return allowlist.some((entry) => {
    const allowed = normalizeHostname(entry);
    return allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) && host !== allowed.slice(2) : host === allowed;
  });
}

function isPublicIp(address) {
  if (net.isIP(address) === 0) return false;
  let parsed;
  try { parsed = ipaddr.parse(address); } catch { return false; }
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
  return parsed.range() === 'unicast';
}

function assertSafeUrl(input, config) {
  let url;
  try { url = input instanceof URL ? new URL(input.href) : new URL(input); } catch { throw new PolicyError('Invalid upstream URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new PolicyError('Only HTTP and HTTPS upstream URLs are allowed');
  if (url.username || url.password) throw new PolicyError('Credentials in upstream URLs are blocked');
  if (url.port && !['80', '443'].includes(url.port)) throw new PolicyError('Non-standard upstream ports are blocked');
  if (!hostnameAllowed(url.hostname, config.allowedHostnames)) throw new PolicyError('Upstream hostname is not allowlisted');
  if (net.isIP(url.hostname) && !isPublicIp(url.hostname)) throw new PolicyError('Non-public IP destinations are blocked');
  return url;
}

async function resolveAndValidate(url, config, resolver = dns) {
  const checked = assertSafeUrl(url, config);
  const host = normalizeHostname(checked.hostname);
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new PolicyError('Non-public IP destinations are blocked');
    return { url: checked, addresses: [host] };
  }
  let records;
  try {
    records = await resolver.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new PolicyError('Upstream hostname could not be resolved', 502);
  }
  if (!records.length || records.some(({ address }) => !isPublicIp(address))) {
    throw new PolicyError('Upstream resolved to a non-public or unsafe address');
  }
  return { url: checked, addresses: records.map(({ address }) => address) };
}

function rewriteRedirect(location, currentUrl, config, publicBaseUrl = '') {
  let destination;
  try { destination = new URL(location, currentUrl); } catch { throw new PolicyError('Invalid upstream redirect'); }
  assertSafeUrl(destination, config);
  const base = publicBaseUrl || '';
  return `${base}/proxy${destination.pathname}${destination.search}${destination.hash}`;
}

module.exports = { PolicyError, normalizeHostname, hostnameAllowed, isPublicIp, assertSafeUrl, resolveAndValidate, rewriteRedirect };
