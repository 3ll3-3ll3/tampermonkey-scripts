'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [], data = {}, windows = new Map();
let handler;
const context = vm.createContext({ console, URL, setTimeout, clearTimeout, importScripts() {},
  LoveAVCore: require('./loveav-core.js'),
  chrome: {
    runtime: { getURL: p => `chrome-extension://test/${p}`, onMessage: { addListener(fn) { handler = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    storage: { session: { get: async () => data, set: async value => Object.assign(data, value) } },
    sidePanel: { open: async opts => calls.push(['open', opts]), setOptions: async opts => calls.push(['options', opts]), close: async opts => calls.push(['close', opts]) },
    windows: { get: async id => { if (!windows.has(id)) throw Error('Closed'); return windows.get(id); }, update: async id => calls.push(['focus', id]), create: async opts => { calls.push(['window', opts]); const win = { id: 100, type: 'popup' }; windows.set(win.id, win); return win; } },
    tabs: { sendMessage: async (id, command) => ({ ok: true, id, command }) },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
const send = (message, sender) => new Promise(resolve => handler(message, sender, resolve));
(async () => {
  const source = { tab: { id: 7 }, url: 'https://missav.ai/' };
  const panel = { url: 'chrome-extension://test/layout-panel.html?tab=7&view=window' };
  assert.equal((await send({ type: 'loveav-layout-register' }, source)).ok, true);
  assert.equal(calls[0][1].path, 'layout-panel.html?tab=7&view=sidebar');
  const opening = send({ type: 'loveav-layout-open', mode: 'sidebar' }, source);
  assert.equal(calls.at(-1)[0], 'open', 'sidePanel.open runs immediately before any async storage call');
  assert.equal((await opening).ok, true);
  await Promise.all([send({ type: 'loveav-layout-open', mode: 'window' }, source), send({ type: 'loveav-layout-open', mode: 'window' }, source)]);
  assert.equal(calls.filter(x => x[0] === 'window').length, 1, 'concurrent launches create only one window');
  await send({ type: 'loveav-layout-open', mode: 'window' }, source);
  assert.equal(calls.at(-1)[0], 'focus', 'reuse existing tool window');
  const forwarded = await send({ type: 'loveav-layout-forward', tabId: 7, command: { type: 'loveav-layout-snapshot' } }, panel);
  assert.equal(forwarded.id, 7);
  assert.equal((await send({ type: 'loveav-layout-forward', tabId: 7, command: { type: 'loveav-save-work' } }, panel)).ok, false);
  assert.equal((await send({ type: 'loveav-layout-forward', tabId: 7, command: { type: 'loveav-layout-snapshot' } }, source)).ok, false);
  console.log('PASS native view routing, user-gesture ordering, window reuse and message allowlist');
})().catch(error => { console.error(error); process.exitCode = 1; });
