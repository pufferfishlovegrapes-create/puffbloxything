'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, createWispPolicy } = require('../src/wisp-policy');
const { escapeRegex } = require('../src/scramjet-config');

test('Wisp policy permits only the exact upstream hostname and standard web ports', () => {
  const config = loadConfig({ UPSTREAM_ORIGIN: 'https://www.easyfun.gg' });
  const { options, isAllowed } = createWispPolicy(config.upstreamHost);
  assert.equal(isAllowed('www.easyfun.gg', 443), true);
  assert.equal(isAllowed('www.easyfun.gg', 80), true);
  assert.equal(isAllowed('sub.www.easyfun.gg', 443), false);
  assert.equal(isAllowed('evil.easyfun.gg', 443), false);
  assert.equal(isAllowed('www.easyfun.gg', 444), false);
  assert.equal(options.allow_udp_streams, false);
  assert.equal(options.allow_direct_ip, false);
  assert.equal(options.allow_private_ips, false);
  assert.equal(options.allow_loopback_ips, false);
});

test('hostname regular expression is escaped before exact matching', () => {
  assert.equal(escapeRegex('a.b[0]'), 'a\\.b\\[0\\]');
});

test('Wisp policy supports wildcard subdomains and allow-any mode', () => {
  const { configureWisp } = require('../src/scramjet-config');
  const { approvedWispDestination } = require('../src/wisp-policy');
  const options = configureWisp({}, ['www.easyfun.gg', '*.easyfun.gg']);
  assert.equal(approvedWispDestination('cdn.easyfun.gg', 443, options), true);
  assert.equal(approvedWispDestination('easyfun.gg.evil.test', 443, options), false);
  assert.equal(approvedWispDestination('evil-easyfun.gg', 443, options), false);
  const open = configureWisp({}, ['www.easyfun.gg'], { allowAnyHost: true });
  assert.equal(open.hostname_whitelist, null);
  assert.equal(open.allow_private_ips, false);
});
