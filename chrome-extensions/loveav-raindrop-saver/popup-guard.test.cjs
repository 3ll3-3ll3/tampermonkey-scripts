'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ content: `window.nativeCalls = []; window.open = (...args) => { nativeCalls.push(args); return 'native-result'; };\n${fs.readFileSync(path.join(__dirname, 'popup-guard-main.js'), 'utf8')}` });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>Popup test</title>
      <script>window.startupResult=window.open('https://ads.example/start');</script>
      <button id="popup" onclick="window.open('https://ads.example/click')">Test popup</button>
      <a id="external" href="https://ads.example/landing" target="_blank">External</a>
      <a id="internal" href="/next">Internal</a>
      <a id="internal-tab" href="/next" target="_blank">Internal new tab</a>
      <a id="scheme" href="customapp://open">App</a>
      <form id="form" action="https://ads.example/form" target="_blank"><button>Submit</button></form>
      <article id="good-card"><h2><a href="/article/one">普通文章</a></h2><img alt="文章图片"></article>
      <article id="inline-ad"><a href="https://ads.example/banner"><img alt="推广横幅"></a></article>
      <article id="mixed"><h2><a href="/article/two">另一篇文章</a></h2><a id="mixed-ad" href="https://ads.example/mixed"><img alt="广告"></a></article>
      <footer><a id="footer-image" href="https://ordinary.example"><img alt="友情链接"></a></footer>
      <div class="ad-overlay">Advertisement overlay</div>` }));
    await page.goto('https://example.test/');
    assert.equal(await page.evaluate(() => startupResult), null, 'document-start popup blocked');
    await page.evaluate(() => {
      window.blockedCount = 0;
      window.addEventListener('message', e => { if (e.data?.type === 'loveav-popup-stats') blockedCount = e.data.count; });
      window.postMessage({ type: 'loveav-popup-query' }, '*');
      window.changedListeners = [];
      window.persisted = { loveavReadingGuard: { media: false } };
      window.chrome = { storage: {
        onChanged: { addListener: fn => changedListeners.push(fn) },
        local: { get: async () => persisted, set: async data => {
          const changes = Object.fromEntries(Object.entries(data).map(([key, newValue]) => [key, { newValue }]));
          Object.assign(persisted, data); changedListeners.forEach(fn => fn(changes, 'local'));
        } },
      } };
      window.navigationClicks = [];
      document.addEventListener('click', e => {
        const link = e.target.closest('a');
        if (link) { navigationClicks.push(link.id); e.preventDefault(); }
      });
    });
    for (const name of ['popup-guard-sync.js', 'reading-guard.js']) await page.addScriptTag({ path: path.join(__dirname, name) });
    await page.waitForFunction(() => blockedCount === 1);
    await page.locator('#popup').click();
    await page.locator('#external').click();
    await page.locator('#scheme').click();
    await page.locator('#internal').click();
    await page.locator('#internal-tab').click();
    assert.deepEqual(await page.evaluate(() => navigationClicks), ['internal', 'internal-tab']);
    await page.evaluate(() => {
      document.querySelector('#internal-tab').click();
      document.querySelector('#form').submit();
      document.querySelector('#form').requestSubmit();
      window.open();
      window.open('/same-origin');
    });
    await page.waitForFunction(() => blockedCount === 9);
    assert.deepEqual(await page.evaluate(() => nativeCalls), []);
    assert.equal(page.context().pages().length, 1);
    assert.equal(await page.locator('.ad-overlay').isVisible(), false);
    assert.equal(await page.locator('#inline-ad').isVisible(), false, 'inline image advertisement removed including empty card wrapper');
    assert.equal(await page.locator('#good-card').isVisible(), true);
    assert.equal(await page.locator('#mixed').isVisible(), true);
    assert.equal(await page.locator('#mixed-ad').isVisible(), false);
    assert.equal(await page.locator('#footer-image').isVisible(), true, 'footer links not treated as article-list ads');
    await page.evaluate(() => {
      const ad = document.createElement('article'); ad.id = 'late-ad';
      ad.innerHTML = '<a href="https://ads.example/late"><img alt="Late banner"></a>'; document.body.append(ad);
    });
    await page.waitForFunction(() => document.querySelector('#late-ad').hasAttribute('data-loveav-guard-ad'));
    const panel = page.locator('#loveav-reading-guard');
    await panel.locator('.launcher').click();
    await page.waitForFunction(() => document.querySelector('#loveav-reading-guard').shadowRoot.querySelector('.popup-count').textContent.includes('9'));
    await panel.locator('.pick').click();
    await page.locator('#external').click();
    assert.equal(await page.locator('#external').isVisible(), false, 'picker can hide blocked advertising links');
    assert.equal(page.url(), 'https://example.test/');
    await panel.locator('.undo').click();
    await panel.locator('[data-key="popups"]').uncheck();
    await panel.locator('.apply').click();
    await page.waitForFunction(() => persisted.loveavReadingGuard.popups === false);
    // Message delivery must complete before exercising the page-world hook.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.open('/allowed')), 'native-result');
    assert.equal(await page.evaluate(() => window.open('https://ads.example/still-blocked')), null);
    await panel.locator('.reset').click();
    await page.waitForFunction(() => persisted.loveavReadingGuard.external === false);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => window.open('https://ordinary.example/')), 'native-result');
    assert.equal(await page.locator('.ad-overlay').isVisible(), true);
    for (const id of ['inline-ad', 'mixed-ad', 'late-ad']) assert.equal(await page.locator('#' + id).isVisible(), true, 'inline promotion restored');
    assert.deepEqual(errors, []);
    console.log('PASS early/script/click/blank popups, external navigation, native/synthetic links, form bypass, counter, settings bridge and reversible switches');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
