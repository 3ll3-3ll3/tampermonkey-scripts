'use strict';
// Offline browser integration. Native chrome APIs are mocked; no real bookmarks are written.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'))).content_scripts[0].js;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const site of ['https://missav.ai/', 'https://123av.com/cn']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const href = code => site.includes('123av') ? `/cn/v/${code.toLowerCase()}` : `/dm14/${code.toLowerCase()}`;
      // Match actual URL patterns from core, shared with existing regression fixtures.
      await page.route('**/*', route => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
          <style>body{margin:0}.grid{display:flex;gap:30px;margin:80px}.card{width:200px;height:140px;background:#ddd}</style>
          <div class="grid">${['ABC-101','ABC-102','ABC-103'].map(code => `<article class="card"><a href="${href(code)}">${code} Title</a></article>`).join('')}</div><div style="height:2000px">Scroll fixture</div>` });
        const code = new URL(route.request().url()).pathname.split('/').pop().toUpperCase();
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<title>${code}</title><h1>${code}</h1><div><span>Actress:</span><a href="/actresses/example">Example</a></div>` });
      });
      await page.goto(site);
      await page.evaluate(() => {
        window.saved = []; window.sent = []; window.settings = {}; window.listeners = [];
        window.chrome = {
          storage: { local: { get: (key, cb) => cb(settings), set: async data => Object.assign(settings, data) }, onChanged: { addListener() {} } },
          runtime: { onMessage: { addListener(fn) { listeners.push(fn); } }, sendMessage: async message => {
            sent.push(message);
            if (message.type === 'loveav-save-works') {
              saved.push(message); await new Promise(r => setTimeout(r, 2000));
              return { ok: true, total: message.works.length, created: message.works.length, existing: 0, excluded: 0, failed: 0, details: [] };
            }
            return { ok: true };
          } },
        };
        window.command = message => new Promise(resolve => { for (const fn of listeners) fn(message, {}, resolve); });
      });
      for (const file of files) await page.addScriptTag({ path: path.join(__dirname, file) });
      const host = page.locator('#loveav-raindrop-saver-host');
      await host.locator('.tools-launcher').click();
      await host.locator('.layout-mode').selectOption('bottom');
      assert.equal(await page.evaluate(() => settings.loveavLayoutMode), 'bottom');
      const box = await host.locator('.panel').boundingBox();
      const bodyBox = await page.locator('body').boundingBox();
      if (process.env.LOVEAV_LAYOUT_SCREENSHOT && site.includes('missav')) await page.screenshot({ path: process.env.LOVEAV_LAYOUT_SCREENSHOT });
      assert.ok(bodyBox.y + bodyBox.height <= box.y + 1, 'bottom dock reserves a separate page viewport');
      await page.evaluate(() => { document.body.scrollTop = 700; });
      await host.locator('.close').click();
      assert.equal(await page.locator('#loveav-dock-page-layout').count(), 0);
      assert.ok(await page.evaluate(() => window.scrollY >= 690), 'closing dock preserves scroll position');
      await page.evaluate(() => window.scrollTo(0, 0));
      await host.locator('.tools-launcher').click();
      await host.locator('.layout-mode').selectOption('floating');
      await page.mouse.move(1200, 10);
      await page.waitForTimeout(1800);
      assert.equal(await host.locator('.panel').evaluate(n => n.classList.contains('compact')), true, 'floating view auto collapses');
      await host.locator('.minimize').click();
      await host.locator('.layout-mode').selectOption('sidebar');
      assert.equal(await host.locator('.panel').isVisible(), false, 'native view removes page overlay');
      assert.equal(await page.evaluate(() => sent.some(m => m.type === 'loveav-layout-open' && m.mode === 'sidebar')), true);
      let snapshot = await page.evaluate(() => command({ type: 'loveav-layout-snapshot' }));
      assert.equal(snapshot.mode, 'sidebar');
      assert.match(snapshot.html, /首页板块加载/);
      assert.match(snapshot.html, /待处理队列/);
      // Remote window uses the real renderer and forwards commands to the same source UI.
      const panel = await browser.newPage();
      await panel.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<header><p id="connection"></p><button id="reconnect">Reconnect</button><button id="focus-source">Source</button></header><main id="surface"></main>' }));
      await panel.goto('https://extension.test/layout-panel.html?tab=1&view=sidebar');
      await panel.exposeFunction('bridge', async message => {
        if (message.type === 'loveav-layout-forward') return page.evaluate(m => command(m), message.command);
        return { ok: true };
      });
      await panel.evaluate(() => { window.chrome = { runtime: { sendMessage: message => bridge(message) } }; });
      await panel.addScriptTag({ path: path.join(__dirname, 'layout-panel.js') });
      await panel.locator('#surface .layout-mode').waitFor();
      await panel.locator('#surface .layout-mode').selectOption('window');
      await page.waitForFunction(() => settings.loveavLayoutMode === 'window');
      await panel.locator('#surface .refresh').click();
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.logs').textContent.includes('已手动刷新'));
      // Rapid additions keep using one queue even while another view controls the task.
      const cards = page.locator('#loveav-page-selection');
      await cards.getByRole('button', { name: '收藏 ABC-101', exact: true }).click();
      await cards.getByRole('button', { name: '收藏 ABC-102', exact: true }).click();
      await cards.getByRole('button', { name: '收藏 ABC-102', exact: true }).click();
      await cards.getByRole('button', { name: '收藏 ABC-103', exact: true }).click();
      snapshot = await page.evaluate(() => command({ type: 'loveav-layout-snapshot' }));
      assert.match(snapshot.html, /ABC-103/);
      const removeId = await panel.evaluate(async () => {
        const s = await bridge({ type: 'loveav-layout-forward', tabId: 1, command: { type: 'loveav-layout-snapshot' } });
        const doc = new DOMParser().parseFromString(s.html, 'text/html');
        const row = [...doc.querySelectorAll('.queue-item')].find(n => n.textContent.includes('ABC-103'));
        return { session: s.session, id: row.querySelector('button').dataset.control };
      });
      await page.evaluate(data => command({ type: 'loveav-layout-act', event: 'click', ...data }), removeId);
      await page.evaluate(() => command({ type: 'loveav-layout-set', mode: 'bottom' }));
      await host.locator('.close').click();
      await page.waitForFunction(() => saved.length === 2 && document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('队列完成'));
      assert.deepEqual(await page.evaluate(() => saved.map(m => m.works[0].code)), ['ABC-101','ABC-102']);
      assert.equal(await host.locator('.panel').isVisible(), false, 'completion never reopens a closed panel');
      assert.equal(await host.locator('[data-stat="total"]').textContent(), '2');
      assert.equal((await page.evaluate(() => command({ type: 'loveav-layout-act', session: 'old', id: '1', event: 'click' }))).ok, false);
      assert.deepEqual(errors, []);
      await panel.close(); await page.close();
      console.log(`PASS four layouts, remote controls, queue/dedup/remove, dock geometry/restore: ${site}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
