'use strict';

// Run against local HTML only. No real site requests or Raindrop writes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const site of ['missav', '123av']) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const origin = site === 'missav' ? 'https://missav.ai' : 'https://123av.com';
      const prefix = site === 'missav' ? '/cn/' : '/cn/v/';
      const card = (code, title = '测试标题') => `<${site === 'missav' ? 'div' : 'article'} class="${site === 'missav' ? 'item' : 'card'}"><a href="${prefix}${code.toLowerCase()}"><img alt="cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></a><a href="${prefix}${code.toLowerCase()}">${code} ${title}</a></${site === 'missav' ? 'div' : 'article'}>`;
      const html = `<!doctype html><html><head><title>列表</title><style>body{margin:0;padding:190px 30px 40px} .grid,.rec__grid{display:grid;grid-template-columns:repeat(3,260px);gap:25px}.item,.card{height:180px;background:#ddd}img{width:250px;height:125px}h2{margin:18px}</style></head><body><section id="first"><h2>推荐</h2><div class="${site === 'missav' ? 'grid grid-cols-3' : 'rec__grid'}">${card('ABC-101', '目标标题')}${card('ABC-102')}${card('ABC-103')}</div></section><section id="second"><h2>最新</h2><div class="grid">${card('ABC-101')}${card('ABC-104')}</div></section></body></html>`;
      const requests = [];
      await page.route('**/*', async (route) => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        requests.push(route.request().url());
        const code = route.request().url().split('/').pop().toUpperCase();
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<h1>${code} 详情</h1><a href="/actresses/example">示例女优</a>` });
      });
      await page.goto(origin + '/cn');
      await page.evaluate(() => {
        window.saved = [];
        window.chrome = {
          storage: { local: { get: (_key, cb) => cb({}) }, onChanged: { addListener() {} } },
          runtime: { onMessage: { addListener() {} }, sendMessage: async (message) => {
            if (message.type === 'loveav-save-works') {
              window.saved.push(message.works);
              return { ok: true, total: message.works.length, created: message.works.length, existing: 0, excluded: 0, failed: 0, details: [] };
            }
            return { ok: true };
          } },
        };
      });
      for (const file of ['filter-core.js', 'loveav-core.js', 'page-metadata.js', 'missav-resolver.js', 'page-selection.js', 'home-loader.js', 'content.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
      await page.getByRole('button', { name: '♥ LoveAV 工具', exact: true }).click();
      await page.getByRole('button', { name: '选择部分收藏', exact: true }).click();
      const overlay = page.locator('#loveav-page-selection');
      const selected = async (number) => {
        await page.waitForFunction((n) => document.querySelector('#loveav-page-selection').shadowRoot.querySelector('.save').textContent === `收藏已选 ${n} 项`, number);
      };
      assert.equal(await overlay.locator('.count').textContent(), '已选 0 / 本页 4 个作品');
      await overlay.getByRole('checkbox', { name: '选择 ABC-101', exact: true }).first().check();
      await selected(1);
      assert.equal(await overlay.getByRole('checkbox', { name: '选择 ABC-101', exact: true }).last().isChecked(), true);
      assert.equal(new URL(page.url()).pathname, '/cn', 'checkbox must not navigate');

      // Load More adds cards without selecting them; replacing a grid preserves selection by URL.
      await page.evaluate((markup) => {
        const grid = document.querySelector('#first > div');
        grid.insertAdjacentHTML('beforeend', markup);
        grid.replaceWith(grid.cloneNode(true));
      }, card('ABC-105'));
      await page.waitForFunction(() => document.querySelector('#loveav-page-selection').shadowRoot.querySelector('.count').textContent.includes('/ 本页 5 '));
      await selected(1);
      assert.equal(await overlay.getByRole('checkbox', { name: '选择 ABC-105', exact: true }).isChecked(), false);

      await overlay.getByRole('button', { name: '清空全部', exact: true }).click();
      await overlay.getByLabel('选择板块').selectOption({ label: '推荐' });
      await overlay.getByRole('button', { name: '全选', exact: true }).click();
      await selected(4);
      await overlay.getByRole('button', { name: '反选', exact: true }).click();
      await selected(0);
      await overlay.getByLabel('选择板块').selectOption('all');
      await page.evaluate((markup) => {
        const section = document.createElement('section');
        section.style.marginTop = '1500px';
        section.innerHTML = `<h2>屏幕外板块</h2><div class="grid">${markup}</div>`;
        document.body.append(section);
      }, card('ABC-106'));
      await page.waitForFunction(() => document.querySelector('#loveav-page-selection').shadowRoot.querySelector('.count').textContent.includes('/ 本页 6 '));
      await overlay.getByRole('button', { name: '选择可见区域', exact: true }).click();
      await selected(5);
      await overlay.getByRole('button', { name: '清空全部', exact: true }).click();
      await overlay.getByLabel('标题关键词或多行番号').fill('目标标题\nABC-104');
      await overlay.getByRole('button', { name: '勾选匹配', exact: true }).click();
      await selected(2);

      // A site header at the highest CSS z-index must not intercept the save button.
      await page.evaluate(() => {
        const nav = document.createElement('nav');
        nav.id = 'blocking-nav';
        nav.style.cssText = 'position:fixed;inset:0 0 auto;height:160px;background:#111;z-index:2147483647';
        nav.textContent = 'Site navigation';
        document.documentElement.append(nav);
      });
      await overlay.getByRole('button', { name: '收起', exact: true }).click();
      assert.equal(await overlay.getByRole('button', { name: '全选', exact: true }).isVisible(), false);
      const grip = await overlay.locator('.handle').boundingBox();
      await page.mouse.move(grip.x + 10, grip.y + 8);
      await page.mouse.down();
      await page.mouse.move(40, 40, { steps: 8 });
      await page.mouse.up();
      const reachableSave = await overlay.locator('.save').boundingBox();
      assert.ok(reachableSave.y < 160, 'drag must move save button into the header region for regression');
      await overlay.locator('.save').click({ trial: true, timeout: 2000 });
      await page.setViewportSize({ width: 600, height: 550 });
      await overlay.locator('.save').click({ trial: true, timeout: 2000 });
      const resized = await overlay.locator('.toolbar').boundingBox();
      assert.ok(resized.x >= 0 && resized.x + resized.width <= 600 && resized.y >= 0 && resized.y + resized.height <= 550);
      await page.setViewportSize({ width: 1200, height: 900 });
      await overlay.getByRole('button', { name: '重置位置', exact: true }).click();
      await overlay.getByRole('button', { name: '展开', exact: true }).click();
      assert.ok((await overlay.locator('.toolbar').boundingBox()).y > 160);

      // Host/body replacement does not lose selected snapshots, even when a selected card disappears.
      await page.evaluate(() => {
        const body = document.body.cloneNode(true);
        document.body.replaceWith(body);
        document.querySelector('#loveav-page-selection').remove();
        document.querySelector('#loveav-raindrop-saver-host').remove();
        for (const a of document.querySelectorAll('a[href$="abc-104"]')) a.closest('article, .item')?.remove();
      });
      await page.waitForFunction(() => document.querySelector('#loveav-page-selection')?.shadowRoot.querySelector('.count').textContent.includes('已移出页面 1'));
      await selected(2);
      await overlay.getByRole('button', { name: '收藏已选 2 项', exact: true }).click();
      await page.waitForFunction(() => window.saved.length === 1);
      assert.deepEqual(await page.evaluate(() => window.saved[0].map((w) => w.code)), ['ABC-101', 'ABC-104']);
      assert.deepEqual(requests.map((url) => url.split('/').pop()).sort(), ['abc-101', 'abc-104']);
      await page.getByRole('button', { name: '选择部分收藏 · 已选 2', exact: true }).click();
      await selected(2);
      await overlay.getByRole('button', { name: '退出选择', exact: true }).click();
      await page.evaluate(() => {
        history.pushState({}, '', '/cn/new');
        document.body.append(document.createElement('hr'));
      });
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.choose').textContent === '选择部分收藏');
      await page.getByRole('button', { name: '♥ LoveAV 工具', exact: true }).click();
      await page.getByRole('button', { name: '选择部分收藏', exact: true }).click();
      await selected(0);
      assert.deepEqual(errors, []);
      console.log(`${site}: selected-only submission, dedup, groups, viewport, keywords, Load More, remount and navigation reset passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
