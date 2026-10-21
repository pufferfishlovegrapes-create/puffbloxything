'use strict';

const dns = require('node:dns/promises');
const ipaddr = require('ipaddr.js');
const { loadConfig } = require('./config');
const { configureWisp } = require('./scramjet-config');

function createWispPolicy(upstreamHost) {
  const options = configureWisp({}, upstreamHost);
  return { options, isAllowed: (hostname, port) => approvedWispDestination(hostname, port, options) };
}

function approvedWispDestination(hostname, port, options) {
  return options.hostname_whitelist.some((pattern) => pattern.test(String(hostname).toLowerCase()))
    && options.port_whitelist.includes(Number(port));
}

module.exports = { approvedWispDestination, createWispPolicy, configureWisp, loadConfig };
