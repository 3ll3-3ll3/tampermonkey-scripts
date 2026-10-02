'use strict';

// Offline background simulation only: no account access or Raindrop write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let handler;
const savedUrls = new Set();
const calls = [];
const data = {
  raindropOAuth: { accessToken: 'offline-token', expiresAt: Date.now() + 3_600_000 },
  // Simulate an upgrade from a version whose saved settings do not contain 51cg.
  loveavSettings: { autoCreateCollections: true, siteCollectionNames: { MissAV: 'MissAV' }, siteCollectionIds: {} },
};
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const fetchMock = async (url, options = {}) => {
  const endpoint = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ endpoint, method: options.method || 'GET', body });
  if (endpoint === '/rest/v1/import/url/exists') {
    return response({ result: true, ids: body.urls.filter(url => savedUrls.has(url)).map(() => 99) });
  }
  if (endpoint === '/rest/v1/collections' || endpoint === '/rest/v1/collections/childrens') return response({ result: true, items: [] });
  if (endpoint === '/rest/v1/collection') return response({ result: true, item: { _id: 51, title: body.title } });
  if (endpoint === '/rest/v1/raindrop') {
    savedUrls.add(body.link);
    return response({ result: true, item: { _id: 275863 } });
  }
  throw Error(`Unexpected fetch: ${url}`);
};
const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  fetch: fetchMock,
  importScripts() {},
  LoveAVCore: require('./loveav-core.js'),
  LoveAVCGArticle: require('./cg-article.js'),
  chrome: {
    runtime: {
      getURL: file => `chrome-extension://test/${file}`,
      onMessage: { addListener(fn) { handler = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      openOptionsPage: async () => {},
    },
    identity: { getRedirectURL: suffix => `https://extension.test/${suffix}`, launchWebAuthFlow() {} },
    action: { onClicked: { addListener() {} } },
    storage: {
      local: {
        get(keys, callback) {
          const list = Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(list.map(key => [key, data[key]])));
        },
        set(value, callback) { Object.assign(data, value); callback?.(); },
      },
      session: { get: async () => ({}), set: async () => {} },
    },
    sidePanel: { open: async () => {}, setOptions: async () => {}, close: async () => {} },
    windows: { create: async () => ({ id: 1 }), get: async () => ({ id: 1, type: 'popup' }), update: async () => {} },
    tabs: { create: async () => ({ id: 2 }), sendMessage: async () => ({ ok: true }) },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
const send = (message, sender) => new Promise(resolve => handler(message, sender, resolve));

(async () => {
  const url = 'https://51cg1.com/archives/275863/';
  const article = { url, title: '完整文章标题', tags: ['后入', '潮吹'] };
  const sender = { tab: { id: 7 }, frameId: 0, url };
  const [first, second] = await Promise.all([
    send({ type: 'loveav-save-cg-article', article }, sender),
    send({ type: 'loveav-save-cg-article', article }, sender),
  ]);
  assert.deepEqual([first.status, second.status], ['created', 'exists'], 'concurrent clicks are serialized and deduplicated');
  assert.equal(first.folder, '51cg');
  const createFolder = calls.find(call => call.endpoint === '/rest/v1/collection');
  assert.equal(createFolder.body.title, '51cg');
  const writes = calls.filter(call => call.endpoint === '/rest/v1/raindrop');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, {
    link: url,
    title: '完整文章标题',
    tags: ['后入', '潮吹'],
    collection: { $id: 51 },
  });
  const before = calls.length;
  const bad = await send({ type: 'loveav-save-cg-article', article }, { ...sender, url: 'https://51cg1.com/archives/1/' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /来源网址不匹配/);
  assert.equal(calls.length, before, 'forged cross-page payload never reaches Raindrop API');
  console.log('PASS 51cg default folder creation, exact payload, duplicate protection, and sender validation');
})().catch(error => { console.error(error); process.exitCode = 1; });
