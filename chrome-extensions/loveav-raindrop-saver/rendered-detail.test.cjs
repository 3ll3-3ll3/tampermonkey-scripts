'use strict';
// Actual content scripts and normal page navigation, with mocked Chrome tabs/Raindrop APIs.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('./loveav-core.js');
const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'))).content_scripts[0].js;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    const pages = new Map(), windows = new Map(), saved = [], removed = [], requests = [];
    let nextId = 0, reader, variant = 'dynamic';
    const activate = [], removeListeners = [];
    const fakeChrome = { tabs: {
      onActivated: { addListener: fn => activate.push(fn) }, onRemoved: { addListener: fn => removeListeners.push(fn) },
      async create(options) {
        const page = await context.newPage(); const id = ++nextId;
        pages.set(id, page); windows.set(id, { id, active: false, windowId: 1, url: options.url });
        await page.goto(options.url); return { id };
      },
      async update(id, options) {
        Object.assign(windows.get(id), options);
        if (options.url) {
          const page = pages.get(id); await page.goto(options.url); await install(page, id);
        }
      },
      async get(id) { if (!windows.has(id)) throw Error('No tab'); return windows.get(id); },
      async remove(id) { removed.push(id); await pages.get(id).close(); pages.delete(id); windows.delete(id); removeListeners.forEach(fn => fn(id)); },
      async sendMessage(id, message) { return pages.get(id).evaluate(m => new Promise(resolve => listeners.forEach(fn => fn(m, {}, resolve))), message); },
    } };
    const sandbox = vm.createContext({ URL, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'rendered-detail-reader.js'), 'utf8'), sandbox);
    reader = sandbox.createLoveAVRenderedReader(fakeChrome, core, { pollMs: 100, settleMs: 300, timeoutMs: 2500 });
    await context.route('**/*', async route => {
      const req = route.request(); requests.push({ url: req.url(), navigation: req.isNavigationRequest() });
      if (!req.isNavigationRequest()) return route.fulfill({ status: 403, body: 'Denied for fetch fixture' });
      const url = new URL(req.url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>首页</h1><article style="margin:100px;width:250px;height:160px"><a href="/cn/abc-123">ABC-123 示例作品</a></article>' });
      if (variant === 'blocked') return route.fulfill({ contentType: 'text/html', body: '<title>Just a moment...</title><h1>Verify you are human</h1>' });
      if (variant === 'wrong') return route.fulfill({ contentType: 'text/html', body: '<h1>ABC-999 Wrong</h1><a href="/actresses/wrong">Wrong</a>' });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<title>ABC-123</title><h1>ABC-123 示例作品</h1>
        <div id="metadata"></div><script>setTimeout(() => document.querySelector('#metadata').innerHTML = '<div><span>女优：</span><a href="/actresses/example">测试女优</a></div><div><span>类型：</span><a href="/genres/drama">剧情</a></div>', 650);</script>` });
    });
    async function install(page, id) {
      if (!page.bridgeInstalled) {
        await page.exposeFunction('extensionBridge', async message => {
          if (message.type === 'loveav-read-rendered-detail') return reader.read(message.work, { tab: { id }, frameId: 0, url: page.url() });
          if (message.type === 'loveav-cancel-rendered-detail') { reader.cancel(id); return { ok: true }; }
          if (message.type === 'loveav-save-work' || message.type === 'loveav-save-works') {
            const works = message.works || [message.work]; saved.push(works);
            return { ok: true, status: 'created', folder: 'MissAV', total: works.length, created: works.length, existing: 0, excluded: 0, failed: 0, details: [] };
          }
          return { ok: true };
        }); page.bridgeInstalled = true;
      }
      await page.evaluate(() => {
        window.listeners = [];
        window.chrome = { runtime: { sendMessage: message => extensionBridge(message), onMessage: { addListener: fn => listeners.push(fn) } },
          storage: { local: { get: (_, cb) => cb({}), set: async () => {} }, onChanged: { addListener() {} } } };
      });
      for (const file of files) await page.addScriptTag({ path: path.join(__dirname, file) });
    }
    const source = await context.newPage(); const sourceId = ++nextId;
    pages.set(sourceId, source); windows.set(sourceId, { id: sourceId, active: true, windowId: 1, url: 'https://missav.ai/' });
    await source.goto('https://missav.ai/'); await install(source, sourceId);
    await source.locator('#loveav-page-selection').getByRole('button', { name: '收藏 ABC-123', exact: true }).click();
    await source.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('[data-stat="created"]').textContent === '1');
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0][0].actresses, ['测试女优']);
    assert.deepEqual(saved[0][0].typeTags, ['剧情']);
    assert.equal(requests.some(r => !r.navigation), false, 'homepage must not fetch an unrendered detail response');
    assert.equal(removed.length, 1, 'own inactive reader tab cleaned up after success');
    const direct = await context.newPage(); const directId = ++nextId;
    pages.set(directId, direct); windows.set(directId, { id: directId, active: true, windowId: 1, url: 'https://missav.ai/cn/abc-123' });
    await direct.goto('https://missav.ai/cn/abc-123'); await install(direct, directId);
    await direct.waitForSelector('#metadata a');
    await direct.locator('#loveav-raindrop-saver-host .quick-save').click();
    await direct.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('[data-stat="created"]').textContent === '1');
    assert.deepEqual(saved[0][0], saved[1][0], 'home and direct save have identical metadata/title/url');
    variant = 'blocked';
    await source.locator('#loveav-page-selection').getByRole('button', { name: '收藏 ABC-123', exact: true }).click();
    await source.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.logs').textContent.includes('访问验证'));
    assert.equal(saved.length, 2, 'challenge never produces a bookmark');
    assert.equal(removed.length, 1, 'challenge tab preserved for manual checking');
    variant = 'wrong';
    const result = await reader.read({ site: 'MissAV', code: 'ABC-123', url: 'https://missav.ai/cn/abc-123' }, { tab: { id: sourceId }, url: source.url() });
    assert.equal(result.ok, false, 'mismatched document never accepted');
    assert.equal(saved.length, 2);
    const invalid = await reader.read({ code: 'ABC-123', url: 'https://other.test/abc-123' }, { tab: { id: sourceId }, url: source.url() });
    assert.equal(invalid.ok, false, 'only supported matching work URLs accepted');
    console.log('PASS homepage vs detail parity, delayed tags, fetch-403/navigation-success, blocked/no-write and safe tab cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
