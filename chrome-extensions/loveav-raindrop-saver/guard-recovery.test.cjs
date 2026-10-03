'use strict';
// All URLs resolve to neutral fixtures; no live website or account is accessed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><style>body{padding-left:400px}a,aside{display:block;padding:20px}</style>
      <main><h1>Neutral fixture</h1><aside id="manual">Hide this box</aside><p>Non-unique region</p><p>Second region</p></main>
      <div class="advertisement">Example marked promotion</div>
      <a id="external" href="https://other.example/path?private=never-log" target="_blank">External link</a>
      <a id="another" href="https://another.example/" target="_blank">Other link</a>
      <a id="unsafe" href="javascript:void(0)">Non-web scheme</a>` })) ;
    await page.addInitScript({ content: `
      window.clockOffset = 0;
      const realNow = Date.now; Date.now = () => realNow() + window.clockOffset;
      window.chrome = { storage: { local: {
        get: async () => JSON.parse(localStorage.getItem('fixture-storage') || '{}'),
        set: async data => localStorage.setItem('fixture-storage', JSON.stringify({...JSON.parse(localStorage.getItem('fixture-storage') || '{}'), ...data}))
      } } };
      window.navigations = [];
      document.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (link) { navigations.push(link.id); event.preventDefault(); }
      });
      window.snapshots = [];
      window.addEventListener('message', e => { if(e.data?.type === 'loveav-popup-stats') snapshots.push(e.data); });
      ${fs.readFileSync(path.join(__dirname, 'popup-guard-main.js'), 'utf8')}
    ` });
    const inject = async () => page.addScriptTag({ path: path.join(__dirname, 'reading-guard.js') });
    const panel = page.locator('#loveav-reading-guard');
    const storedRules = () => page.evaluate(() => JSON.parse(localStorage.getItem('fixture-storage'))['loveavGuardRules:https://example.test/']);
    await page.goto('https://example.test/'); await inject();
    await panel.locator('.launcher').click();
    await panel.locator('summary').first().click();
    await panel.locator('.hidden-list button').first().click();
    assert.equal(await page.locator('.advertisement').isVisible(), true);
    await page.evaluate(() => document.body.append(document.createElement('hr')));
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.advertisement').isVisible(), true, 'manual reveal survives rescans');
    await panel.locator('.pick').click(); await page.locator('#manual').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fixture-storage') || '{}')['loveavGuardRules:https://example.test/']?.includes('#manual'));
    assert.deepEqual(await storedRules(), ['#manual']);
    await page.reload(); await inject();
    await page.waitForFunction(() => document.querySelector('#manual').hasAttribute('data-loveav-guard-rule'));
    assert.equal(await page.locator('#manual').isVisible(), false, 'rule restored after reload');
    assert.equal(await page.locator('.advertisement').isVisible(), false, 'one-page reveal expires on reload');
    await page.goto('https://example.test/other'); await inject();
    assert.equal(await page.locator('#manual').isVisible(), true, 'rules do not spill into other paths');
    await page.goto('https://example.test/'); await inject();
    await panel.locator('.launcher').click();
    await panel.locator('summary').first().click();
    await panel.locator('.rule-list button').click();
    assert.equal(await page.locator('#manual').isVisible(), true);
    assert.deepEqual(await storedRules(), []);
    await panel.locator('.pick').click(); await page.locator('main p').first().click();
    assert.deepEqual(await storedRules(), [], 'no unstable nth-child rules persisted');
    await panel.locator('.undo').click();

    await panel.locator('.close').click();
    await page.locator('#external').click();
    await page.waitForFunction(() => snapshots.at(-1)?.entries.some(e => e.domain === 'other.example'));
    assert.deepEqual(await page.evaluate(() => navigations), []);
    assert.equal(await page.evaluate(() => JSON.stringify(snapshots).includes('private=')), false, 'logs omit path and query');
    await panel.locator('.launcher').click();
    await panel.locator('summary').nth(1).click();
    await panel.locator('.block-list button').first().click();
    await panel.locator('.close').click();
    await page.evaluate(() => document.querySelector('#external').click());
    await page.locator('#another').click();
    assert.deepEqual(await page.evaluate(() => navigations), [], 'synthetic/unrelated clicks do not consume permission');
    await page.locator('#external').click();
    assert.deepEqual(await page.evaluate(() => navigations), ['external']);
    await page.locator('#external').click();
    assert.deepEqual(await page.evaluate(() => navigations), ['external'], 'permission used once');
    await panel.locator('.launcher').click();
    await panel.locator('.block-list button').first().click();
    await page.waitForFunction(() => document.querySelector('#loveav-reading-guard').shadowRoot.querySelector('.status').textContent.startsWith('已临时放行'));
    await page.evaluate(() => { clockOffset = 31000; });
    await panel.locator('.close').click();
    await page.locator('#external').click();
    assert.deepEqual(await page.evaluate(() => navigations), ['external'], 'permission expires in 30 seconds');
    await page.locator('#unsafe').click();
    await page.waitForFunction(() => snapshots.at(-1)?.entries.at(-1)?.allowable === false);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) window.open('https://ads.example/' + i); });
    await page.waitForFunction(() => snapshots.at(-1)?.entries.length === 30);
    assert.equal(await page.evaluate(() => snapshots.at(-1).entries.length), 30);
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('never-log')), false);
    if (process.env.GUARD_SCREENSHOT) {
      await panel.locator('.launcher').click();
      await page.screenshot({ path: process.env.GUARD_SCREENSHOT });
    }
    assert.deepEqual(errors, []);
    console.log('PASS ad reveal, reload/path isolation, rule deletion, conservative selectors, one-shot trusted link permit, expiry and private bounded logs');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
