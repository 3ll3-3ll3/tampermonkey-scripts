const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ body: '<body></body>', contentType: 'text/html' }));
    const vote = (id, liked = false) => `<div class="midcol ${liked ? 'likes' : 'unvoted'}" data-tid="${id}"><i class="fa ${liked ? 'fa-thumbs-up' : 'fa-thumbs-o-up'}" onclick="vote(this)">赞</i><i class="fa fa-thumbs-o-down" onclick="down(this)">踩</i></div>`;
    async function setup(html) {
      await page.goto('https://bad.news/news');
      await page.setContent(html);
      await page.evaluate(() => {
        window.clicks = []; window.downs = [];
        window.vote = el => { clicks.push(el.parentElement.dataset.tid); el.parentElement.classList.add('likes'); };
        window.down = el => downs.push(el.parentElement.dataset.tid);
      });
      await page.addScriptTag({ path: path.join(__dirname, 'badnews-batch-like.user.js') });
      assert.equal(await page.locator('#badnews-batch-like').locator('.panel').isVisible(), false);
      await page.getByRole('button', { name: '批量点赞', exact: true }).click();
    }
    const panel = page.locator('#badnews-batch-like');
    await setup(vote('101') + vote('102', true) + `<aside class="side" id="top-content-news">${vote('101')}${vote('103')}</aside>`);
    assert.equal(await panel.locator('.delay').inputValue(), '1000');
    await panel.locator('.delay').fill('249');
    await panel.locator('.start').click();
    assert.match(await panel.locator('.status').textContent(), /250–60000/);
    assert.deepEqual(await page.evaluate(() => clicks), []);
    await panel.locator('.delay').fill('250');
    await panel.locator('.start').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.startsWith('完成：'));
    assert.deepEqual(await page.evaluate(() => clicks), ['101']);
    await panel.locator('.scope').selectOption('rank');
    await panel.locator('.start').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.startsWith('完成：'));
    assert.deepEqual(await page.evaluate(() => clicks), ['101', '103']);
    assert.deepEqual(await page.evaluate(() => downs), []);
    // Ranking icons can be hover-only and keep login-required handler classes
    // even when the page no longer displays a login link.
    await setup(`<style>.relatedlist .midcol{visibility:hidden}</style><aside class="side" id="top-content-news"><div class="relatedlist">${vote('151').replace('fa fa-thumbs-o-up', 'fa login-requiredi fa-thumbs-o-up')}<a href="/t/151">排行条目</a></div></aside>`);
    await panel.locator('.scope').selectOption('rank');
    assert.equal(await panel.locator('.start').isEnabled(), true);
    await panel.locator('.start').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.startsWith('完成：'));
    assert.deepEqual(await page.evaluate(() => clicks), ['151']);
    // An asynchronously populated ranking updates an already-open panel.
    await setup('<aside class="side" id="top-content-news"></aside>');
    await panel.locator('.scope').selectOption('rank');
    assert.equal(await panel.locator('.start').isEnabled(), false);
    await page.evaluate(html => document.querySelector('.side').innerHTML = html, vote('152'));
    await page.waitForFunction(() => !document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.start').disabled);
    assert.match(await panel.locator('.count').textContent(), /可处理 1/);
    // Repeated icons and cloned work containers must only cause one click.
    await setup(vote('201') + vote('201') + vote('202', true));
    await panel.locator('.scope').selectOption('all');
    await panel.locator('.start').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.startsWith('完成：'));
    assert.deepEqual(await page.evaluate(() => clicks), ['201']);
    // Login is a hard gate, no account changes in this state.
    await setup('<a href="/login">登录</a>' + vote('301'));
    await panel.locator('.start').click();
    assert.match(await panel.locator('.status').textContent(), /未登录/);
    assert.deepEqual(await page.evaluate(() => clicks), []);
    // Stop prevents all later items, including when the current request is pending.
    await setup(vote('401') + vote('402'));
    await page.evaluate(() => { window.vote = el => clicks.push(el.parentElement.dataset.tid); });
    await panel.locator('.start').click();
    await panel.locator('.stop').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.startsWith('已停止'));
    assert.deepEqual(await page.evaluate(() => clicks), ['401']);
    // No confirmation: do not retry and do not continue the batch.
    await setup(vote('501') + vote('502'));
    await page.evaluate(() => { window.vote = el => clicks.push(el.parentElement.dataset.tid); });
    await panel.locator('.start').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.includes('未确认点赞状态'));
    assert.deepEqual(await page.evaluate(() => clicks), ['501']);
    // A positive UI update reverting shortly after is not success.
    await setup(vote('601') + vote('602'));
    await page.evaluate(() => { window.vote = el => { clicks.push(el.parentElement.dataset.tid); el.parentElement.classList.add('likes'); setTimeout(() => el.parentElement.classList.remove('likes'), 100); }; });
    await panel.locator('.start').click();
    await page.waitForFunction(() => document.querySelector('#badnews-batch-like').shadowRoot.querySelector('.status').textContent.includes('状态回退'));
    assert.deepEqual(await page.evaluate(() => clicks), ['601']);
    console.log('PASS: manual-only UI, scope isolation, ID dedup, existing-like skip, no downvotes, login gate, stop, timeout/no retry, UI rollback');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
