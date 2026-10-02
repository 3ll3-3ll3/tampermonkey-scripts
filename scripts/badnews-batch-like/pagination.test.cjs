const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, 'badnews-batch-like.user.js'), 'utf8')
  .replaceAll('await pause(1500, page)', 'await pause(200, page)')
  .replaceAll('await pause(1200, page)', 'await pause(20, page)');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    async function scenario({
      mode = 'continuous', pages = 3, range = '', parity = 'all', lastPage = 6,
      nextKind = 'normal', loginPage = 0, likedFirst = false, stopOnNext = false,
      reloadOnNext = false, numericLinks = false, pathStyle = 'query'
    } = {}) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const clicks = [], navigations = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.exposeFunction('recordLike', id => clicks.push(id));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        const n = pathStyle === 'dash' ? Number(u.pathname.match(/\/page-(\d+)$/)?.[1] || 1) : Number(u.searchParams.get('page') || 1);
        if (route.request().isNavigationRequest()) navigations.push(n);
        const id = String(100 + n);
        const vote = (voteId, liked = false) => `<div class="midcol ${liked ? 'likes' : 'unvoted'}" data-tid="${voteId}"><i class="fa fa-thumbs-o-up" onclick="recordLike('${voteId}');this.parentElement.classList.add('likes')">赞</i></div>`;
        const pageHref = value => pathStyle === 'dash' ? (value === 1 ? '/tag/porn' : `/tag/porn/page-${value}`) : `/news?page=${value}`;
        const href = nextKind === 'external' ? 'https://other.test/news?page=2' : nextKind === 'cycle' && n === 2 ? (pathStyle === 'dash' ? pageHref(1) : '/news') : pageHref(n + 1);
        const next = n < lastPage && nextKind !== 'missing' ? `<a rel="next" href="${href}">下一页</a>` : '';
        const numbered = numericLinks ? Array.from({ length: lastPage }, (_, i) => `<a href="${pageHref(i + 1)}">${i + 1}</a>`).join('') : '';
        const last = nextKind === 'normal' ? `<a class="last-page" href="${pageHref(lastPage)}">${lastPage}</a>` : '';
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body>${n === loginPage ? '<a href="/login">登录</a>' : ''}${vote(id, n === 1 && likedFirst)}${n === 2 && pathStyle === 'query' ? vote('101') : ''}<nav class="pagination">${numbered}${next}${last}</nav><script>${script}</script></body></html>` });
      });
      await page.goto(pathStyle === 'dash' ? 'https://bad.news/tag/porn' : 'https://bad.news/news');
      assert.deepEqual(errors, []);
      const panel = page.locator('#badnews-batch-like');
      await panel.locator('.launcher').click();
      await panel.locator('.page-mode').selectOption(mode);
      if (mode === 'continuous') await panel.locator('.pages').fill(String(pages));
      if (mode === 'custom') await panel.locator('.range').fill(range);
      await panel.locator('.parity').selectOption(parity);
      await panel.locator('.delay').fill('250');
      await panel.locator('.start').click();
      if (reloadOnNext) {
        await page.waitForURL(pathStyle === 'dash' ? '**/tag/porn/page-2' : '**/news?page=2');
        await page.waitForFunction(() => document.querySelector('#badnews-batch-like')?.shadowRoot.querySelector('.status').textContent.includes('即将继续'));
        await page.reload();
        assert.equal(await panel.locator('.panel').isVisible(), false);
        assert.equal(await panel.locator('.status').textContent(), '等待手动启动');
      } else if (stopOnNext) {
        await page.waitForURL(pathStyle === 'dash' ? '**/tag/porn/page-2' : '**/news?page=2');
        await panel.locator('.stop').click();
        await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.includes('已停止'));
      } else {
        await page.waitForFunction(() => {
          const s = document.querySelector('#badnews-batch-like')?.shadowRoot.querySelector('.status').textContent || '';
          return s.startsWith('完成：') || s.includes('已停止') || s.includes('未登录') || s.includes('找不到');
        }, null, { timeout: 30000 });
      }
      const status = await panel.locator('.status').textContent();
      assert.equal(await page.evaluate(() => sessionStorage.getItem('badnews-batch-like-handoff-v2')), null);
      assert.deepEqual(errors, []);
      await context.close();
      return { clicks, navigations, status };
    }

    let result = await scenario({ pages: 2 });
    assert.deepEqual(result.clicks, ['101', '102']);
    assert.deepEqual(result.navigations, [1, 2]);
    assert.match(result.status, /所选 2 页/);

    result = await scenario({ pages: 3, likedFirst: true });
    assert.deepEqual(result.clicks, ['102', '103']);
    assert.deepEqual(result.navigations, [1, 2, 3]);

    result = await scenario({ mode: 'custom', range: '1-3，5' });
    assert.deepEqual(result.clicks, ['101', '102', '103', '105']);
    assert.deepEqual(result.navigations, [1, 2, 3, 4, 5]);
    assert.match(result.status, /1-3, 5/);

    result = await scenario({ mode: 'custom', range: '1-5', parity: 'odd' });
    assert.deepEqual(result.clicks, ['101', '103', '105']);
    assert.deepEqual(result.navigations, [1, 2, 3, 4, 5]);

    result = await scenario({ mode: 'all', lastPage: 3 });
    assert.deepEqual(result.clicks, ['101', '102', '103']);
    assert.deepEqual(result.navigations, [1, 2, 3]);

    result = await scenario({ mode: 'custom', range: '2-8', lastPage: 8, pathStyle: 'dash' });
    assert.deepEqual(result.clicks, ['102', '103', '104', '105', '106', '107', '108']);
    assert.deepEqual(result.navigations, [1, 2, 3, 4, 5, 6, 7, 8]);

    result = await scenario({ nextKind: 'missing' });
    assert.deepEqual(result.navigations, [1]); assert.match(result.status, /找不到/);
    result = await scenario({ nextKind: 'external' });
    assert.deepEqual(result.navigations, [1]); assert.match(result.status, /找不到/);
    result = await scenario({ nextKind: 'cycle' });
    assert.deepEqual(result.navigations, [1, 2]); assert.match(result.status, /循环/);
    result = await scenario({ loginPage: 2 });
    assert.deepEqual(result.clicks, ['101']); assert.match(result.status, /未登录/);
    result = await scenario({ stopOnNext: true });
    assert.deepEqual(result.clicks, ['101']);
    result = await scenario({ reloadOnNext: true });
    assert.deepEqual(result.clicks, ['101']);

    console.log('PASS: current/continuous/custom/all page plans, odd filter, skipped pages, dedup, unsafe pagination, login expiry, stop and manual reload');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
