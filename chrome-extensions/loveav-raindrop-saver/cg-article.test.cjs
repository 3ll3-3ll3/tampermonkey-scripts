'use strict';

// Offline fixture only: no 51cg request, account access, or Raindrop write.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const articleUrl = 'https://51cg1.com/archives/275863/';
    const tags = ['后入', '母狗', '喷水', '黑料', '高潮痉挛', '潮吹', '吃瓜', '51吃瓜网', '敏感体质', '痉挛', '抽搐', '51吃瓜', '高潮视频合集', '高潮抽搐视频合集'];
    const tagLinks = tags.map((tag, index) => `<div class="keywords YkziYC"><a href="/tag/t${index}/">${tag}</a></div>`).join('');
    await page.route('**/*', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<title>站点后缀不应替代文章标题 | 51吃瓜网</title>
        <header><a rel="tag" href="/tag/header/">顶部标签干扰</a></header>
        <main><h1>高潮瞬间视频大合集 第二十五弹</h1>
          <p>关键词：#不应从正文猜标签</p>
          <div class="tags">${tagLinks}</div>
          <a href="https://ads.example/tag/ad/">广告标签</a>
        </main>
        <aside class="sidebar"><div class="tags"><a href="/tag/sidebar/">侧栏标签</a></div></aside>`,
    }));
    await page.goto(articleUrl);
    await page.evaluate(() => {
      window.sent = [];
      window.chrome = {
        storage: { local: { get: (_, callback) => callback({ loveavSettings: { siteCollectionNames: { '51cg': '我的51cg' } } }) } },
        runtime: {
          onMessage: { addListener() {} },
          sendMessage: async message => {
            sent.push(message);
            return { ok: true, status: sent.length === 1 ? 'created' : 'exists', folder: '我的51cg' };
          },
        },
      };
    });
    for (const file of ['cg-article.js', 'cg-content.js']) await page.addScriptTag({ path: path.join(__dirname, file) });

    assert.equal(await page.evaluate(() => LoveAVCGArticle.articleUrl(location.href + '?x=1#hash')), articleUrl);
    assert.equal(await page.evaluate(() => LoveAVCGArticle.articleUrl('https://evil.test/archives/275863/')), '');
    const extracted = await page.evaluate(() => LoveAVCGArticle.extract(document, location.href));
    assert.equal(extracted.title, '高潮瞬间视频大合集 第二十五弹');
    assert.deepEqual(extracted.tags, tags, 'live .tags > .keywords links are exact; header/sidebar/ad text is excluded');
    assert.equal(extracted.source, '文章标签');
    assert.throws(() => require('./cg-article.js').validate({ url: articleUrl, title: 'x', tags: ['y'] }, 'https://51cg1.com/archives/1/'), /来源网址不匹配/);

    const host = page.locator('#loveav-cg-host');
    assert.equal(await host.locator('.open').isVisible(), true);
    assert.equal(await page.evaluate(() => sent.length), 0, 'never writes on page load');
    await host.locator('.preview').click();
    assert.equal(await host.locator('.title').inputValue(), extracted.title);
    assert.deepEqual((await host.locator('.tags').inputValue()).split('\n'), tags);
    assert.match(await host.locator('.source').textContent(), /14 个标签/);
    assert.match(await host.locator('.destination').textContent(), /我的51cg/);
    await host.locator('.title').fill('用户修改的完整标题');
    await host.locator('.tags').fill('后入\n潮吹\n后入');
    await host.locator('.save').click();
    await page.waitForFunction(() => document.querySelector('#loveav-cg-host').shadowRoot.querySelector('.status').textContent.includes('已保存'));
    const [message] = await page.evaluate(() => sent);
    assert.equal(message.type, 'loveav-save-cg-article');
    assert.equal(message.article.title, '用户修改的完整标题');
    assert.deepEqual(message.article.tags, ['后入', '潮吹']);
    assert.equal(message.article.url, articleUrl);

    await host.locator('.close').click();
    await host.locator('.open').click();
    await page.waitForFunction(() => sent.length === 2);
    await page.waitForFunction(() => document.querySelector('#loveav-cg-host').shadowRoot.querySelector('.status').textContent.includes('已经存在'));
    const direct = await page.evaluate(() => sent[1]);
    assert.equal(direct.article.title, extracted.title, 'one-click path refreshes the live title');
    assert.deepEqual(direct.article.tags, tags, 'one-click path submits every live article tag');

    await host.locator('.tags').fill('');
    await host.locator('.save').click();
    await page.waitForFunction(() => document.querySelector('#loveav-cg-host').shadowRoot.querySelector('.status').textContent.includes('未识别到标签'));
    assert.equal(await page.evaluate(() => sent.length), 2, 'empty tags never submit');
    assert.deepEqual(errors, []);
    console.log('PASS 51cg live tag structure, preview/edit workflow, folder display, validation, and no-write guards');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
