'use strict';
// Neutral offline fixture. No real article reads or external writes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>浏览保护 — 本地演示</title><style>body{margin:0;padding:40px;background:#eef3f7;color:#203346;font-family:system-ui}main{margin-left:380px}article,.advertisement{padding:20px;background:white;border-radius:12px;margin:20px 0}img{width:180px;height:90px;background:#8aabb9}h1{font-size:28px}</style></head><body><main><h1>文章列表 · 本地测试</h1><article id="keep"><h2>旅行摄影入门</h2><img alt="示意图"><p>这是一篇普通演示文章。</p></article><article id="block"><h2>促销活动资讯</h2><p>用于验证关键词屏蔽。</p></article><div class="advertisement">示例广告区域</div><a id="manual" href="/leave">点选隐藏测试区域</a></main></body></html>` }));
    await page.goto('https://example.test/');
    await page.evaluate(() => {
      window.persisted = {};
      window.chrome = { storage: { local: {
        get: async () => persisted,
        set: async data => Object.assign(persisted, data),
      } } };
    });
    await page.addScriptTag({ path: path.join(__dirname, 'reading-guard.js') });
    const panel = page.locator('#loveav-reading-guard');
    assert.equal(await panel.locator('section').isVisible(), false);
    assert.equal(await page.locator('img').isVisible(), false);
    await panel.locator('.launcher').click();
    await panel.locator('[data-key="keywords"]').fill('促销');
    await panel.locator('[data-key="ads"]').check();
    await panel.locator('[data-key="reading"]').check();
    await panel.locator('.apply').click();
    assert.equal(await page.locator('#block').isVisible(), false);
    assert.equal(await page.locator('#keep').isVisible(), true);
    assert.equal(await page.locator('.advertisement').isVisible(), false);
    assert.equal(await page.locator('#keep p').evaluate(node => getComputedStyle(node).fontSize), '18px');
    assert.equal(await page.evaluate(() => persisted.loveavReadingGuard.keywords), '促销');
    await page.evaluate(() => {
      const card = document.createElement('article'); card.id = 'later';
      card.innerHTML = '<h2>新的促销文章</h2>'; document.querySelector('main').append(card);
    });
    await page.waitForFunction(() => document.querySelector('#later').hasAttribute('data-loveav-guard-blocked'));
    await panel.locator('.pick').click();
    await page.locator('#manual').click();
    assert.equal(page.url(), 'https://example.test/');
    assert.equal(await page.locator('#manual').isVisible(), false);
    await panel.locator('.undo').click();
    assert.equal(await page.locator('#manual').isVisible(), true);
    if (process.env.GUARD_SCREENSHOT) await page.screenshot({ path: process.env.GUARD_SCREENSHOT });
    await panel.locator('.reset').click();
    for (const selector of ['img', '#block', '#later', '.advertisement', '#manual']) assert.equal(await page.locator(selector).isVisible(), true, `${selector} restored`);
    await page.keyboard.press('Escape');
    assert.equal(await panel.locator('section').isVisible(), false);
    await page.keyboard.press('Alt+Shift+P');
    assert.equal(await panel.locator('section').isVisible(), true);
    // Reinitialization restores saved opt-out and does not create two panels.
    await page.addScriptTag({ path: path.join(__dirname, 'reading-guard.js') });
    assert.equal(await page.locator('#loveav-reading-guard').count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS hidden media, scoped keyword filtering, dynamic cards, ad markers, reversible manual hiding, local settings and keyboard controls');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
