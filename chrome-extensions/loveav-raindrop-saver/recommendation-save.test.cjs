'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const site of ['missav', '123av']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const origin = site === 'missav' ? 'https://missav.ai' : 'https://123av.com';
      const prefix = site === 'missav' ? '/dm14/' : '/en/v/';
      const card = code => `<article class="card"><a href="${prefix}${code.toLowerCase()}">${code} Test work</a></article>`;
      const metadata = '<div><span>Actress:</span><a href="/actresses/test">Example</a></div>';
      await page.route('**/*', route => {
        if (!route.request().isNavigationRequest()) {
          const code = new URL(route.request().url()).pathname.split('/').pop().toUpperCase();
          return route.fulfill({ contentType: 'text/html', body: `<h1>${code}</h1>${metadata}` });
        }
        return route.fulfill({ contentType: 'text/html', body: `<style>.grid{display:flex;gap:20px}.card{width:230px;height:140px;background:#ddd}body{padding-left:100px}</style><h1>JUL-925 Current</h1>${metadata}
          <a href="${prefix}jul-925">Current permalink</a><section id="recommendations"><h2>Recommendations</h2><div class="grid">${card('ABC-101')}${card('ABC-102')}${card('ABC-101')}</div></section>
          <aside><h2>Sidebar</h2>${card('ABC-103')}</aside>` });
      });
      await page.goto(origin + prefix + 'jul-925');
      await page.evaluate(() => {
        window.saved = [];
        window.chrome = { storage: { local: { get: (_, cb) => cb({}) }, onChanged: { addListener() {} } }, runtime: {
          onMessage: { addListener() {} }, sendMessage: async message => {
            saved.push(message);
            return { ok: true, total: message.works?.length || 1, created: message.works?.length || 1, existing: 0, excluded: 0, failed: 0, details: [] };
          },
        } };
      });
      for (const file of ['filter-core.js', 'loveav-core.js', 'page-metadata.js', 'missav-resolver.js', 'page-selection.js', 'home-loader.js', 'content.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
      const host = page.locator('#loveav-raindrop-saver-host');
      const overlay = page.locator('#loveav-page-selection');
      const codes = async () => page.evaluate(() => saved.at(-1).works.map(work => work.code).sort());
      const done = async n => page.waitForFunction(n => saved.length === n && document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.startsWith('完成'), n);
      assert.equal(await page.evaluate(() => saved.length), 0);
      assert.equal(await overlay.locator('.quick-card').count(), 3);
      assert.equal(await host.locator('.quick-batch').count(), 0);
      assert.equal(await overlay.locator('.quick-group').count(), 0);
      for (const button of await overlay.locator('.quick-card').all()) {
        const rect = await button.boundingBox();
        assert.equal(rect.width, 28);
        assert.equal(rect.height, 28);
        assert.equal(await button.textContent(), '♥');
      }
      if (process.env.LOVEAV_UI_SCREENSHOT && site === 'missav') await page.screenshot({ path: process.env.LOVEAV_UI_SCREENSHOT });
      await overlay.getByRole('button', { name: '收藏 ABC-103', exact: true }).click();
      await done(1);
      assert.deepEqual(await codes(), ['ABC-103']);
      await host.locator('.close').click();
      await host.locator('.tools-launcher').click();
      await host.locator('.choose').click();
      await overlay.locator('.groups').selectOption({ label: 'Recommendations' });
      await overlay.locator('[data-select="all"]').click();
      await overlay.locator('.save').click();
      await done(2);
      assert.deepEqual(await codes(), ['ABC-101', 'ABC-102']);
      await host.locator('.close').click();
      await host.locator('.tools-launcher').click();
      await host.locator('.batch-list').click();
      await done(3);
      assert.deepEqual(await codes(), ['ABC-101', 'ABC-102', 'ABC-103']);
      // Selection stays active on detail pages, including after later DOM changes.
      await host.locator('.choose').click();
      await overlay.locator('[data-select="clear"]').click();
      await page.evaluate(html => document.querySelector('#recommendations .grid').insertAdjacentHTML('beforeend', html), card('ABC-104'));
      await overlay.getByRole('checkbox', { name: '选择 ABC-104', exact: true }).check();
      await overlay.locator('.save').click();
      await done(4);
      assert.deepEqual(await codes(), ['ABC-104']);
      await host.locator('.close').click();
      // Search/category pages use the same automatic card discovery, without a Load More button.
      await page.evaluate(() => history.pushState({}, '', '/search?q=example'));
      await host.locator('.quick-save').waitFor({ state: 'hidden' });
      await overlay.getByRole('button', { name: '收藏 ABC-104', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await host.locator('.tools-launcher').isVisible(), true);
      assert.deepEqual(errors, []);
      console.log(`${site}: passive card/section save, dedup, detail recommendations, selection, dynamic cards, search routes passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
