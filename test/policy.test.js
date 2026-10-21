'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { hostnameAllowed, isPublicIp, assertSafeUrl, resolveAndValidate, rewriteRedirect, PolicyError } = require('../src/policy');
const { proxyPath, rewriteHtml, rewriteCss } = require('../src/proxy');

const config = loadConfig({ UPSTREAM_ORIGIN: 'https://www.easyfun.gg', UPSTREAM_PATH: '/cloud-games/roblox.html', PUBLIC_BASE_URL: 'https://proxy.example.test', ALLOWED_HOSTNAMES: 'static.easyfun.gg' });

test('hostname validation requires exact allowlist entries and supports explicit wildcard subdomains', () => {
  assert.equal(hostnameAllowed('www.easyfun.gg', config.allowedHostnames), true);
  assert.equal(hostnameAllowed('evil-easyfun.gg', config.allowedHostnames), false);
  assert.equal(hostnameAllowed('static.easyfun.gg.attacker.test', config.allowedHostnames), false);
  assert.equal(hostnameAllowed('x.example.test', ['*.example.test']), true);
  assert.equal(hostnameAllowed('example.test', ['*.example.test']), false);
});

test('URL validation rejects userinfo, unapproved hosts, non-http schemes, and non-standard ports', () => {
  assert.equal(assertSafeUrl('https://www.easyfun.gg/a', config).hostname, 'www.easyfun.gg');
  for (const url of ['https://user:pass@www.easyfun.gg/', 'https://attacker.test/', 'file:///etc/passwd', 'https://www.easyfun.gg:8443/']) {
    assert.throws(() => assertSafeUrl(url, config), PolicyError);
  }
});

test('private, loopback, link-local, and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.1.2', '192.168.1.1', '169.254.169.254', '::1', 'fe80::1', 'fd00::1']) assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.throws(() => assertSafeUrl('http://127.0.0.1/', { ...config, allowedHostnames: ['127.0.0.1'] }), /Non-public IP/);
});

test('DNS validation rejects mixed public/private answers to prevent rebinding', async () => {
  const resolver = { lookup: async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }] };
  await assert.rejects(resolveAndValidate(new URL('https://www.easyfun.gg/'), config, resolver), /non-public or unsafe/);
});

test('redirect rewrite remains on the proxy route and blocks unsafe redirect hosts', () => {
  const rewritten = rewriteRedirect('/next?x=1', new URL('https://www.easyfun.gg/start'), config, config.publicBaseUrl);
  assert.equal(rewritten, 'https://proxy.example.test/proxy/next?x=1');
  assert.throws(() => rewriteRedirect('https://attacker.test/', new URL('https://www.easyfun.gg/'), config), /not allowlisted/);
});

test('asset links, relative paths, CSS URLs and links are rewritten through the proxy', () => {
  const html = rewriteHtml('<a href="/play">go</a><img src="../img/a.png"><script src="https://static.easyfun.gg/app.js"></script>', new URL('https://www.easyfun.gg/cloud-games/roblox.html'), config);
  assert.match(html, /https:\/\/proxy\.example\.test\/proxy\/www\.easyfun\.gg\/play/);
  assert.match(html, /https:\/\/proxy\.example\.test\/proxy\/www\.easyfun\.gg\/img\/a\.png/);
  assert.match(html, /https:\/\/proxy\.example\.test\/proxy\/static\.easyfun\.gg\/app\.js/);
  assert.match(rewriteCss('a{background:url("../img/a.png")} @import "/main.css"', new URL('https://www.easyfun.gg/css/app.css'), config), /proxy\/www\.easyfun\.gg\/img\/a\.png/);
  assert.equal(proxyPath(new URL('https://www.easyfun.gg/cloud-games/roblox.html'), config), 'https://proxy.example.test/proxy/www.easyfun.gg/cloud-games/roblox.html');
});
