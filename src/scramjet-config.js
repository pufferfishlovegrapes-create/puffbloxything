'use strict';

const { loadConfig } = require('./config');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function configureWisp(options, upstreamHost) {
  const host = upstreamHost.toLowerCase();
  Object.assign(options, {
    hostname_whitelist: [new RegExp(`^${escapeRegex(host)}$`, 'i')],
    hostname_blacklist: null,
    port_whitelist: [80, 443],
    port_blacklist: null,
    allow_direct_ip: false,
    allow_private_ips: false,
    allow_loopback_ips: false,
    allow_udp_streams: false,
    allow_tcp_streams: true,
    stream_limit_per_host: 64,
    stream_limit_total: 128,
    parse_real_ip: false,
    dns_ttl: 30,
    dns_result_order: 'ipv4first',
  });
  return options;
}

module.exports = { configureWisp, escapeRegex, loadProxyConfig: loadConfig };
