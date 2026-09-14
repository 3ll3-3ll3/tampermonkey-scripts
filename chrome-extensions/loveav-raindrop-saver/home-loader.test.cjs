const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const site of ['missav', '123av']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body></body>' }));
      await page.goto(site === 'missav' ? 'https://missav.ai/cn' : 'https://123av.com/cn');
      await page.evaluate((site) => {
        window.saved = []; window.chosen = []; window.clicks = 0;
        const card = (n) => `<article><a href="/cn/${site === '123av' ? 'v/' : ''}abc-${n}">ABC-${n}</a></article>`;
        window.addSection = (name, start) => {
          const section = document.createElement('section');
          section.className = 'rec__section';
          section.innerHTML = `<div class="section__head"><h2>${name}</h2><div class="grid rec__grid">${card(start)}${card(start + 1)}</div></div><div class="absolute"><button class="rec__more-btn">Load More</button></div>`;
          section.querySelector('button').addEventListener('click', () => {
            window.clicks++;
            setTimeout(() => {
              const grid = section.querySelector('.grid');
              const copy = grid.cloneNode(true);
              const n = start + copy.children.length;
              copy.insertAdjacentHTML('beforeend', card(n) + card(n + 1));
              grid.replaceWith(copy);
            }, 60);
          });
          document.body.append(section);
        };
        window.addSection('推荐', 100);
        window.addSection('最新', 200);
        document.body.insertAdjacentHTML('beforeend', '<div id="panel"><p class="load-empty"></p><p class="load-conflict" hidden></p><div id="rows"></div></div>');
      }, site);
      await page.addScriptTag({ path: path.join(__dirname, 'home-loader.js') });
      await page.evaluate(() => {
        window.loader = LoveAVHomeLoader({
          scan: () => [...document.querySelectorAll('article a')].map((anchor) => ({ anchor, work: { url: anchor.href, code: anchor.textContent, title: anchor.textContent } })),
          choose: (works) => window.chosen.push(works), save: async (works) => window.saved.push(works),
          isBusy: () => false, destination: () => 'MissAV',
        });
        loader.mount(document.querySelector('#rows'));
      });
      const row = page.locator('.load-row').first();
      await row.locator('.load-target').fill('5');
      await row.locator('.load-scope').selectOption('new');
      await row.locator('.load-start').click();
      await page.waitForFunction(() => !loader.active && window.chosen.length === 1);
      assert.deepEqual(await page.evaluate(() => chosen[0].map((w) => w.code)), ['ABC-102', 'ABC-103', 'ABC-104', 'ABC-105']);
      assert.equal(await page.evaluate(() => saved.length), 0);
      await row.locator('.load-mode').selectOption('save');
      await row.locator('.load-scope').selectOption('all');
      await row.locator('.load-start').click();
      await page.waitForFunction(() => !loader.active && saved.length === 1);
      assert.equal(await page.evaluate(() => saved[0].length), 6);
      await row.locator('.load-mode').selectOption('load');
      await row.locator('.load-target').fill('8');
      await row.locator('.load-start').click();
      await page.waitForFunction(() => !loader.active && document.querySelector('.load-status').textContent.includes('加载完成 8'));
      assert.equal(await page.evaluate(() => saved.length), 1);
      assert.equal(await page.evaluate(() => chosen.length), 1);
      // Stop an auto-save run while its next click is still loading.
      await row.locator('.load-mode').selectOption('save');
      await row.locator('.load-target').fill('50');
      await row.locator('.load-start').click();
      await row.locator('.load-stop').click();
      await page.waitForFunction(() => !loader.active);
      assert.equal(await page.evaluate(() => saved.length), 1);
      // No button / premature exhaustion must not trigger auto-save.
      await page.evaluate(() => document.querySelector('.rec__more-btn').remove());
      await row.locator('.load-start').click();
      await page.waitForFunction(() => !loader.active);
      assert.equal(await page.evaluate(() => saved.length), 1);
      assert.match(await row.locator('.load-status').textContent(), /已无更多/);
      // Existing userscript UI blocks even a no-click auto-save run.
      await page.evaluate(() => { const old = document.createElement('div'); old.id = 'missav-auto-loader-panel'; document.body.append(old); });
      await row.locator('.load-target').fill('1');
      await row.locator('.load-start').click();
      assert.match(await row.locator('.load-status').textContent(), /旧油猴/);
      assert.equal(await page.evaluate(() => saved.length), 1);
      if (site === '123av') {
        await page.evaluate(() => {
          const featured = document.createElement('div');
          featured.className = 'featured';
          featured.innerHTML = Array.from({ length: 21 }, (_, i) => {
            const n = 300 + (i % 20);
            return `<article style="${i ? 'display:none' : ''}"><a class="featured__link" href="/cn/v/abc-${n}"><h3>ABC-${n} 完整推荐标题</h3></a></article>`;
          }).join('');
          document.body.prepend(featured);
          window.copied = '';
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value) => { window.copied = value; } } });
          loader.refresh();
        });
        const featured = page.locator('.featured-row');
        assert.match(await featured.locator('.load-count').textContent(), /20/);
        await featured.locator('.featured-copy').click();
        assert.equal(await page.evaluate(() => copied.split('\n').length), 20);
        assert.equal(await page.evaluate(() => copied.split('\n')[19]), 'ABC-319 完整推荐标题');
        await featured.locator('summary').click();
        await featured.getByRole('checkbox', { name: 'ABC-319 完整推荐标题', exact: true }).check();
        await featured.locator('.featured-pick').click();
        assert.deepEqual(await page.evaluate(() => chosen.at(-1).map((w) => w.url.split('/').pop())), ['abc-319']);
        await featured.locator('.featured-all').click();
        assert.equal(await page.evaluate(() => chosen.at(-1).length), 20);
        const beforeClicks = await page.evaluate(() => clicks);
        await featured.locator('.featured-save').click();
        await page.waitForFunction(() => !loader.active && saved.length === 2);
        assert.equal(await page.evaluate(() => saved.at(-1).length), 20);
        assert.equal(await page.evaluate(() => clicks), beforeClicks, 'featured must not click Load More or carousel controls');
        console.log('123av: all 20 hidden featured items, clone dedup, full-title copy, partial selection and featured-only save passed');
      }
      assert.deepEqual(errors, []);
      console.log(`${site}: load-only, select-new, save-section, overshoot, grid replacement, stop, exhaustion and userscript conflict passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
