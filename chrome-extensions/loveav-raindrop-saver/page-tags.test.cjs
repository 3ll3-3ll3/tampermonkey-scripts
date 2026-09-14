'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const site of ['missav', '123av']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const origin = site === 'missav' ? 'https://missav.ai' : 'https://123av.com';
      const prefix = site === 'missav' ? '/cn/' : '/cn/v/';
      const detailUrl = origin + prefix + 'abc-123';
      const actressRoute = site === 'missav' ? '/actresses/test' : '/stars/test';
      const genreRoute = site === 'missav' ? '/genres/test' : '/tags/test';
      const normal = `<title>ABC-123</title><h1>ABC-123 完整标题</h1>
        <nav><a href="/genres/other">导航类型</a><a href="/actresses/top">排行女优</a></nav>
        <div class="grid"><div><span>女优：</span><a href="${actressRoute}">测试女优</a></div>
        <div><span>类型：</span><a href="${genreRoute}">剧情</a><a href="https://other.test/genres/x">广告标签</a></div>
        <div><span>男优：</span><a href="/actors/man">测试男优</a></div></div>
        <div class="rec__grid"><a href="/actresses/other">推荐女优</a><a href="/genres/other">推荐类型</a></div>
        <script src="https://static.cloudflareinsights.com/beacon.min.js"></script>`;
      const list = `<h1>首页</h1><article><a href="${prefix}abc-123">ABC-123 完整标题</a></article>`;
      let responseBody = normal;
      let httpStatus = 200;
      await page.route('**/*', route => route.fulfill({ status: httpStatus, contentType: 'text/html; charset=utf-8', body: route.request().isNavigationRequest() ? list : responseBody }));
      await page.goto(origin + '/cn');
      await page.evaluate(() => {
        window.saved = [];
        window.rules = { referenceTags: ['测试女优'], exportBlacklist: [], libraryCodeKeys: [] };
        window.chrome = {
          storage: { local: { get: (_, cb) => cb({ loveavRules: rules }) }, onChanged: { addListener() {} } },
          runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
            if (message.type === 'loveav-save-works' || message.type === 'loveav-save-work') {
              saved.push(message.works || [message.work]);
              return { ok: true, status: 'created', created: 1, total: 1, existing: 0, failed: 0, excluded: 0, details: [] };
            }
            return { ok: true };
          } },
        };
      });
      for (const file of ['filter-core.js', 'loveav-core.js', 'page-metadata.js', 'missav-resolver.js', 'page-selection.js', 'home-loader.js', 'content.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
      const host = page.locator('#loveav-raindrop-saver-host');
      await page.getByRole('button', { name: '♥ LoveAV 工具', exact: true }).click();
      await host.locator('.action').click();
      await page.waitForFunction(() => saved.length === 1);
      assert.deepEqual(await page.evaluate(() => LoveAVCore.classifyWork(saved[0][0], rules).tags), ['测试女优', '剧情']);
      assert.equal(await page.evaluate(() => LoveAVCore.classifyWork(saved[0][0], rules).folder), '参考女优Tag命中');
      for (const body of ['<title>Just a moment...</title>', '<h1>ABC-999 错误作品</h1><a href="/actresses/wrong">错误女优</a>', '<h1>ABC-123</h1><nav><a href="/genres/other">仅导航</a></nav>']) {
        responseBody = body;
        await host.locator('.action').click();
        await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('整批未提交'));
        assert.equal(await page.evaluate(() => saved.length), 1);
      }
      httpStatus = 403;
      await host.locator('.action').click();
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('整批未提交'));
      assert.equal(await page.evaluate(() => saved.length), 1);
      httpStatus = 200;
      // Current-detail entry uses the same parser as batch fetching.
      await page.evaluate(({ normal, url }) => {
        history.pushState({}, '', url);
        const section = document.createElement('section');
        section.id = 'fixture-detail';
        section.innerHTML = normal;
        document.querySelector('h1').remove();
        document.body.prepend(section);
      }, { normal, url: detailUrl });
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.choose').hidden);
      await host.locator('.action').click();
      await page.waitForFunction(() => saved.length === 2);
      assert.deepEqual(await page.evaluate(() => LoveAVCore.classifyWork(saved[1][0], rules).tags), ['测试女优', '剧情']);
      await page.evaluate(() => { document.querySelector('#fixture-detail').innerHTML = '<h1>ABC-123</h1><nav><a href="/genres/other">仅导航</a></nav>'; });
      await host.locator('.action').click();
      await page.waitForFunction(() => document.querySelector('#loveav-raindrop-saver-host').shadowRoot.querySelector('.phase').textContent.includes('未提交 Raindrop'));
      assert.equal(await page.evaluate(() => saved.length), 2);
      assert.deepEqual(errors, []);
      console.log(`${site}: detail/batch tags, reference classification, nav/actor/recommendation exclusion, challenge/403/mismatch/empty-metadata no-write passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
