'use strict';

const { loadConfig } = require('./config');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hostnamePattern(entry) {
  const host = entry.toLowerCase();
  if (host.startsWith('*.')) return new RegExp(`^(?:[a-z0-9-]+\\.)+${escapeRegex(host.slice(2))}$`, 'i');
  return new RegExp(`^${escapeRegex(host)}$`, 'i');
}

// `hosts` may be a single hostname or a list (exact names or "*.example.com" wildcards).
// With allowAnyHost every public hostname is reachable; Wisp's IP checks still block
// private, loopback, link-local and reserved destinations either way.
function configureWisp(options, hosts, { allowAnyHost = false } = {}) {
  const list = (Array.isArray(hosts) ? hosts : [hosts]).filter(Boolean);
  Object.assign(options, {
    hostname_whitelist: allowAnyHost ? null : list.map(hostnamePattern),
    hostname_blacklist: null,
    port_whitelist: [80, 443],
    port_blacklist: null,
    allow_direct_ip: false,
    allow_private_ips: false,
    allow_loopback_ips: false,
    allow_udp_streams: false,
    allow_tcp_streams: true,
    stream_limit_per_host: 64,
    stream_limit_total: 256,
    parse_real_ip: false,
    dns_ttl: 30,
    dns_result_order: 'ipv4first',
  });
  return options;
}

module.exports = { configureWisp, escapeRegex, hostnamePattern, loadProxyConfig: loadConfig };
