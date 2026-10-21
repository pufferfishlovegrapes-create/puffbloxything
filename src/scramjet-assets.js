'use strict';

const path = require('node:path');
const { scramjetPath } = require('@mercuryworkshop/scramjet/path');
const { baremuxPath } = require('@mercuryworkshop/bare-mux/node');
const { libcurlPath } = require('@mercuryworkshop/libcurl-transport');

function attachScramjetAssets(app) {
  app.use('/scram/', require('express').static(scramjetPath, { fallthrough: false, etag: true, maxAge: '1d' }));
  app.use('/baremux/', require('express').static(baremuxPath, { fallthrough: false, etag: true, maxAge: '1d' }));
  app.use('/libcurl/', require('express').static(libcurlPath, { fallthrough: false, etag: true, maxAge: '1d' }));
}

function scramjetFiles() {
  return { scramjetPath, baremuxPath, libcurlPath, path };
}

module.exports = { attachScramjetAssets, scramjetFiles };
