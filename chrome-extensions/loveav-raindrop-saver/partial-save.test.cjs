'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'))).content_scripts[0].js;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const codes = ['ABC-101','ABC-102','ABC-103','ABC-104','ABC-105','ABC-106'];
    let failing = new Set(['ABC-105','ABC-106']), requests = [];
    await page.route('**/*', async route => {
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: `<style>body{padding:80px}.grid{display:grid;grid-template-columns:repeat(3,220px);gap:20px}article{height:150px;background:#ddd}</style><div class="grid">${codes.map(code => `<article><a href="/cn/${code.toLowerCase()}">${code} Title</a></article>`).join('')}</div>` });
      const code = new URL(route.request().url()).pathname.split('/').pop().toUpperCase(); requests.push(code);
      if (failing.has(code)) {
        await new Promise(r => setTimeout(r, 100));
        return route.fulfill({ status: 403, body: 'Access denied' });
      }
      return route.fulfill({ contentType: 'text/html', body: `<h1>${code} Title</h1><div><span>Actress:</span><a href="/actresses/example">Example</a></div>` });
    });
    await page.goto('https://missav.ai/cn');
    await page.evaluate(() => {
      window.saved = []; window.failSave = false; window.seen = new Set();
      window.chrome = { storage: { local: { get: (_, cb) => cb({}), set: async () => {} }, onChanged: { addListener() {} } },
        runtime: { onMessage: { addListener() {} }, sendMessage: async m => {
          if (m.type === 'loveav-save-works') {
            saved.push(m.works);
            if (failSave) return { ok: false, error: 'Test response unknown' };
            const details = m.works.map(w => { const status = seen.has(w.code) ? 'exists' : 'created'; seen.add(w.code); return { code: w.code, status }; });
            return { ok: true, total: m.works.length, created: details.filter(d => d.status === 'created').length, existing: details.filter(d => d.status === 'exists').length, excluded: 0, failed: 0, details };
          }
          if (/rendered-detail|probe-rendered/.test(m.type)) throw Error('Unexpected detail navigation');
          return { ok: true };
        } } };
    });
    for (const file of files) await page.addScriptTag({ path: path.join(__dirname, file) });
    const host = page.locator('#loveav-raindrop-saver-host'), overlay = page.locator('#loveav-page-selection');
    await host.locator('.tools-launcher').click();
    await host.locator('.layout-mode').selectOption('bottom');
    await host.locator('.choose').click();
    await overlay.getByRole('button', { name: '全选', exact: true }).click();
    await overlay.getByRole('button', { name: '收藏已选 6 项', exact: true }).click();
    const idle = async () => page.waitForFunction(() => !document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.retry-failed').disabled);
    await idle();
    await host.locator('.tools-launcher').click();
    assert.deepEqual(await page.evaluate(() => saved.map(group => group.map(w => w.code))), [codes.slice(0,4)]);
    assert.match(await host.locator('.phase').textContent(), /部分完成.*新增 4.*读取失败 2/);
    assert.equal(await host.locator('.retry-failed').textContent(), '重试未完成 2 项');
    assert.equal(await host.locator('[data-stat="failed"]').textContent(), '2');
    assert.deepEqual([...requests].sort(), codes);
    // Retrying while blocked still cannot write empty metadata or replay successful items.
    requests = [];
    await host.locator('.retry-failed').click(); await idle();
    assert.deepEqual(requests.sort(), codes.slice(4));
    assert.equal(await page.evaluate(() => saved.length), 1);
    assert.match(await host.locator('.phase').textContent(), /本轮未提交/);
    failing.clear(); requests = [];
    await host.locator('.retry-failed').click(); await idle();
    assert.deepEqual(await page.evaluate(() => saved.map(group => group.map(w => w.code))), [codes.slice(0,4), codes.slice(4)]);
    assert.equal(await host.locator('.retry-failed').isVisible(), false);
    // Access denial early in a batch retains items never started, not just HTTP failures.
    failing = new Set(codes); requests = [];
    await host.locator('.action').click(); await idle();
    assert.equal(requests.length, 4);
    assert.equal(await host.locator('.retry-failed').textContent(), '重试未完成 6 项');
    assert.match(await host.locator('.phase').textContent(), /读取失败 4，未开始 2/);
    failing.clear(); requests = [];
    await page.evaluate(() => { failSave = true; });
    await host.locator('.retry-failed').click(); await idle();
    assert.equal(await host.locator('[data-stat="failed"]').textContent(), '6');
    assert.equal(await host.locator('.retry-failed').textContent(), '重试未完成 6 项');
    await page.evaluate(() => { failSave = false; });
    await host.locator('.retry-failed').click(); await idle();
    assert.match(await host.locator('.phase').textContent(), /已存在 6/);
    assert.equal(await host.locator('.retry-failed').isVisible(), false);
    assert.equal(page.url(), 'https://missav.ai/cn'); assert.equal(page.context().pages().length, 1);
    assert.deepEqual(errors, []);
    console.log('PASS selected-six partial save, failure-only retry, persistent 403 no-write, unstarted preservation, submission-unknown retry and no navigation');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
