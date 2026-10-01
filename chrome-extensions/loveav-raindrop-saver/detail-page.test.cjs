'use strict';

// Offline fixtures only: no site requests, accounts, or Raindrop writes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const files = ['filter-core.js', 'loveav-core.js', 'page-metadata.js', 'missav-resolver.js', 'page-selection.js', 'home-loader.js', 'content.js'];

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const url of [
      'https://missav.ai/dm14/jul-925-english-subtitle',
      'https://missav.ai/dm14/cn/jul-925-chinese-subtitle/',
      'https://missav.ws/jul-925?test=1',
      'https://123av.com/en/v/jul-925-english-subtitle',
      'https://www.123av.com/cn/v/jul-925-uncensored-leaked/',
    ]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const origin = new URL(url).origin;
      const prefix = url.includes('123av.com') ? '/en/v/' : '/dm14/';
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <title>JUL-925 Test title</title><h1>JUL-925 Test title</h1>
        <div><span>Actress:</span><a href="/actresses/example">Example</a></div>
        <div><span>Genre:</span><a href="/genres/test">Test</a></div>
        <section><h2>Recommendations</h2><article class="card"><a href="${prefix}abc-123">ABC-123 Other work</a></article></section>` }));
      await page.goto(url);
      await page.evaluate(() => {
        window.saved = [];
        window.chrome = {
          storage: { local: { get: (_, cb) => cb({ loveavSettings: { workflow: { pagePrimaryAction: 'filter' } } }) }, onChanged: { addListener() {} } },
          runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
            saved.push(message);
            await new Promise(resolve => setTimeout(resolve, 100));
            return { ok: true, status: saved.length > 1 ? 'exists' : 'created', folder: 'Test', ruleFolder: 'Test' };
          } },
        };
      });
      for (const file of files) await page.addScriptTag({ path: path.join(__dirname, file) });
      const host = page.locator('#loveav-raindrop-saver-host');
      const quick = host.locator('.quick-save');
      assert.equal(await quick.isVisible(), true, 'detail entry visible without opening the panel');
      assert.match(await quick.textContent(), /JUL-925/);
      assert.equal(await page.evaluate(() => saved.length), 0, 'never save on page load');
      await quick.click();
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('已保存'));
      const [message] = await page.evaluate(() => saved);
      assert.equal(message.type, 'loveav-save-work');
      assert.equal(message.work.code, 'JUL-925');
      assert.equal(message.work.url, url);
      assert.deepEqual(message.work.actresses, ['Example']);
      assert.equal(await page.evaluate(() => saved.length), 1, 'recommendations not submitted');
      await host.locator('.close').click();
      assert.equal(await quick.isVisible(), true);
      await quick.click();
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('已存在'));
      await host.locator('.close').click();
      // Route-only navigation must remove stale one-click entry without a DOM mutation.
      await page.evaluate(url => history.pushState({}, '', url), origin + '/');
      await quick.waitFor({ state: 'hidden' });
      await host.locator('.tools-launcher').click();
      assert.match(await host.locator('.alternate').textContent(), /批量收藏本页/);
      await host.locator('.close').click();
      await page.evaluate(url => history.pushState({}, '', url), url);
      await quick.waitFor({ state: 'visible' });
      // Invalid detail metadata must never cause saving recommendations instead.
      await page.locator('h1').evaluate(node => { node.textContent = 'ABC-999 Wrong page'; });
      await page.evaluate(() => { document.title = 'Wrong page'; });
      await quick.click();
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('未提交 Raindrop'));
      assert.equal(await page.evaluate(() => saved.length), 2);
      assert.deepEqual(errors, []);
      console.log(`PASS detail entry, single save, existing feedback, route changes and no-write guard: ${url}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
