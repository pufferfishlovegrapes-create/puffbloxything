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
