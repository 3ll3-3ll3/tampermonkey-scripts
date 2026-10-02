const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, 'badnews-batch-like.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    async function scenario({pages = 3, nextKind = 'normal', loginPage = 0, likedFirst = false, stopOnNext = false, reloadOnNext = false}) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const clicks = [], navigations = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.exposeFunction('recordLike', id => clicks.push(id));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        const n = Number(u.searchParams.get('page') || 1);
        if (route.request().isNavigationRequest()) navigations.push(n);
        const id = n === 1 ? '101' : String(100 + n);
        const vote = (id, liked = false) => `<div class="midcol ${liked ? 'likes' : 'unvoted'}" data-tid="${id}"><i class="fa fa-thumbs-o-up" onclick="recordLike('${id}');this.parentElement.classList.add('likes')">赞</i></div>`;
        const href = nextKind === 'external' ? 'https://other.test/news?page=2' : nextKind === 'cycle' && n === 2 ? '/news' : `/news?page=${n+1}`;
        const next = n < 3 && nextKind !== 'missing' ? `<a rel="next" href="${href}">下一页</a>` : '';
        return route.fulfill({contentType:'text/html; charset=utf-8', body:`<!doctype html><html><body>${n === loginPage ? '<a href="/login">登录</a>' : ''}${vote(id, n === 1 && likedFirst)}${n === 2 ? vote('101') : ''}${next}<script>${script}</script></body></html>`});
      });
      await page.goto('https://bad.news/news');
      assert.deepEqual(errors, []);
      const panel = page.locator('#badnews-batch-like');
      await panel.locator('.launcher').click();
      await panel.locator('.pages').fill(String(pages));
      await panel.locator('.delay').fill('250');
      await panel.locator('.start').click();
      if (reloadOnNext) {
        await page.waitForURL('**/news?page=2');
        await page.waitForFunction(() => document.querySelector('#badnews-batch-like')?.shadowRoot.querySelector('.status').textContent.includes('即将继续'));
        await page.reload();
        assert.equal(await panel.locator('.panel').isVisible(), false);
        assert.equal(await panel.locator('.status').textContent(), '等待手动启动');
      } else if (stopOnNext) {
        await page.waitForURL('**/news?page=2');
        await panel.locator('.stop').click();
        await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.includes('已停止'));
      } else {
        await page.waitForFunction(() => {
          const s = document.querySelector('#badnews-batch-like')?.shadowRoot.querySelector('.status').textContent || '';
          return s.startsWith('完成：') || s.includes('已停止') || s.includes('未登录');
        }, null, {timeout:30000});
      }
      const status = await panel.locator('.status').textContent();
      assert.equal(await page.evaluate(() => sessionStorage.getItem('badnews-batch-like-handoff-v1')), null);
      assert.deepEqual(errors, []);
      await context.close();
      return {clicks,navigations,status};
    }
    let result = await scenario({pages:2});
    assert.deepEqual(result.clicks, ['101','102']);
    assert.deepEqual(result.navigations,[1,2]);
    assert.match(result.status,/完成：2 页/);
    result = await scenario({pages:3,likedFirst:true});
    assert.deepEqual(result.clicks,['102','103']);
    assert.deepEqual(result.navigations,[1,2,3]);
    result = await scenario({nextKind:'missing'});
    assert.deepEqual(result.navigations,[1]); assert.match(result.status,/下一页/);
    result = await scenario({nextKind:'external'});
    assert.deepEqual(result.navigations,[1]);
    result = await scenario({nextKind:'cycle'});
    assert.deepEqual(result.navigations,[1,2]); assert.match(result.status,/循环/);
    result = await scenario({loginPage:2});
    assert.deepEqual(result.clicks,['101']); assert.match(result.status,/未登录/);
    result = await scenario({stopOnNext:true});
    assert.deepEqual(result.clicks,['101']);
    result = await scenario({reloadOnNext:true});
    assert.deepEqual(result.clicks,['101']);
    console.log('PASS: specified page count, cross-page dedup, all-liked first page, missing/external/cyclic next, login expiry, stop and manual reload at handoff');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
