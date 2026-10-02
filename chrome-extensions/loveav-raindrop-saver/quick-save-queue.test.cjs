'use strict';

// Offline fixtures only: verifies UI queueing without real site or Raindrop requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const files = ['filter-core.js', 'loveav-core.js', 'page-metadata.js', 'missav-resolver.js', 'page-selection.js', 'home-loader.js', 'content.js'];

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      if (route.request().isNavigationRequest()) {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
          <style>.grid{display:flex;gap:30px;margin:80px}.card{width:250px;height:180px;background:#ddd}</style>
          <div class="grid">
            <article class="card"><a href="/dm14/abc-101">ABC-101 First</a></article>
            <article class="card"><a href="/dm14/abc-102">ABC-102 Second</a></article>
            <article class="card"><a href="/dm14/abc-103">ABC-103 Third</a></article>
          </div>` });
      }
      const code = new URL(route.request().url()).pathname.split('/').pop().toUpperCase();
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<title>${code}</title><h1>${code}</h1><div><span>Actress:</span><a href="/actresses/example">Example</a></div>` });
    });
    await page.goto('https://missav.ai/');
    await page.evaluate(() => {
      window.saved = [];
      window.chrome = {
        storage: { local: { get: (_, cb) => cb({}) }, onChanged: { addListener() {} } },
        runtime: {
          onMessage: { addListener() {} },
          sendMessage: async message => {
            if (message.type === 'loveav-save-works') {
              saved.push(message);
              await new Promise(resolve => setTimeout(resolve, 250));
              return { ok: true, total: message.works.length, created: message.works.length, existing: 0, excluded: 0, failed: 0,
                details: message.works.map(work => ({ code: work.code, status: 'created', folder: 'MissAV', ruleFolder: '其他' })) };
            }
            return { ok: true };
          },
        },
      };
    });
    for (const file of files) await page.addScriptTag({ path: path.join(__dirname, file) });

    const host = page.locator('#loveav-raindrop-saver-host');
    const overlay = page.locator('#loveav-page-selection');
    const first = overlay.getByRole('button', { name: '收藏 ABC-101', exact: true });
    const second = overlay.getByRole('button', { name: '收藏 ABC-102', exact: true });
    await first.click();
    await host.locator('.panel').waitFor({ state: 'visible' });
    assert.equal(await host.locator('.panel').evaluate(node => node.classList.contains('compact')), true, 'single save opens compact status strip');
    assert.equal(await host.locator('.body').isVisible(), false, 'compact strip does not show the large body');
    assert.ok((await host.locator('.panel').boundingBox()).height < 90, 'compact status strip stays shallow');
    await second.waitFor({ state: 'visible' });
    await second.click();
    await second.click(); // Duplicate clicks while queued must not create duplicate writes.
    await page.waitForFunction(() => saved.length === 2 && document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('待处理队列完成'));
    const batches = await page.evaluate(() => saved.map(message => message.works.map(work => work.code)));
    assert.deepEqual(batches, [['ABC-101'], ['ABC-102']]);
    assert.equal(await host.locator('[data-stat="total"]').textContent(), '2');
    assert.equal(await host.locator('[data-stat="created"]').textContent(), '2');
    assert.match(await host.locator('.sub').textContent(), /已识别 3 个作品/);
    await host.locator('.minimize').click();
    assert.equal(await host.locator('.body').isVisible(), true, 'full progress and logs remain available on demand');
    assert.equal(await host.locator('.drag').isVisible(), true, 'panel exposes a drag handle');
    assert.deepEqual(errors, []);
    console.log('PASS: rapid single-card queue, duplicate suppression, compact status strip, expand and drag affordance');
    await page.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
