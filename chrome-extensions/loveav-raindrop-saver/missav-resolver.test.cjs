const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ body: '', contentType: 'text/html' }));
    await page.goto('https://example.test');
    await page.setContent(fs.readFileSync(path.join(__dirname, 'filter.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
    for (const file of ['filter-core.js', 'loveav-core.js', 'page-metadata.js', 'missav-resolver.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
    const results = await page.evaluate(async () => {
      const resolver = LoveAVMissAVResolver;
      window.testRules = { referenceTags: ['测试女优'], exportBlacklist: [], libraryCodeKeys: [] };
      window.testHtml = '<title>ABC-123</title><h1>ABC-123 完整标题</h1><video></video><a href="/cn/actresses/test">测试女优</a><div><span>Genres:</span><a href="/cn/genres/test">剧情</a></div><script src="https://static.cloudflareinsights.com/beacon.min.js"></script>';
      const response = html => ({ ok: true, text: async () => html });
      const opts = { maxRetry: 0, candidateDelayMs: 0, retryDelayMs: 0 };
      const work = await resolver.resolveWork('ABC-123', { ...opts, fetchImpl: async () => response(testHtml) });
      let challengeCalls = 0;
      const challenged = await resolver.resolveWork('ABC-123', { ...opts, fetchImpl: async () => {
        challengeCalls++;
        return response('<title>Just a moment...</title><form id="challenge-form"></form>');
      } });
      const network = await resolver.resolveWork('ABC-123', { ...opts, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
      const missing = await resolver.resolveWork('ABC-123', { ...opts, fetchImpl: async () => ({ ok: false, status: 404 }) });
      const limited = await resolver.resolveWork('ABC-123', { ...opts, fetchImpl: async () => ({ ok: false, status: 429 }) });
      window.testWork = work;
      window.testChallenge = challenged;
      return {
        work: LoveAVCore.classifyWork(work, testRules), challengeCalls, challenged, network, missing, limited,
        normalBlock: resolver.submissionBlockReason([work]),
        errorBlock: resolver.submissionBlockReason([work, network]),
        backgroundChallenge: resolver.pageLooksChallenged('<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'),
      };
    });
    assert.equal(results.work.status, 'ok');
    assert.deepEqual(results.work.tags, ['测试女优', '剧情']);
    assert.equal(results.work.folder, '参考女优Tag命中');
    assert.equal(results.challengeCalls, 1);
    assert.equal(results.challenged.status, 'access_challenge');
    assert.equal(results.network.status, 'network_error');
    assert.equal(results.missing.status, 'not_found');
    assert.equal(results.limited.status, 'rate_limited');
    assert.equal(results.normalBlock, '');
    assert.match(results.errorBlock, /整批未提交/);
    assert.equal(results.backgroundChallenge, false);
    // Exercise the actual manual UI: read failures must never reach save-works.
    await page.evaluate(() => {
      window.saveMessages = [];
      window.useChallenge = true;
      window.chrome = {
        storage: {
          local: { get: (_, cb) => cb({ loveavRules: testRules, loveavSettings: {} }), set: (_, cb) => cb() },
          session: { get: (_, cb) => cb({}), remove: (_, cb) => cb() },
        },
        runtime: { sendMessage: (message, cb) => {
          if (message.type === 'loveav-save-works') saveMessages.push(message);
          cb({ ok: true, authorized: true, created: 1, existing: 0, excluded: 0, failed: 0 });
        } },
      };
      LoveAVMissAVResolver.resolveWork = async () => useChallenge ? testChallenge : testWork;
    });
    await page.addScriptTag({ path: path.join(__dirname, 'filter-app.js') });
    await page.locator('#source').fill('ABC-123');
    await page.locator('#manual-run').click();
    await page.waitForFunction(() => document.querySelector('#manual-progress-text').textContent.includes('整批未提交'));
    assert.equal(await page.evaluate(() => saveMessages.length), 0);
    await page.evaluate(() => { useChallenge = false; });
    await page.locator('#manual-run').click();
    await page.waitForFunction(() => document.querySelector('#manual-progress-text').textContent.startsWith('完成：'));
    assert.equal(await page.evaluate(() => saveMessages.length), 1);
    assert.match(await page.locator('#manual-log').textContent(), /分类：参考女优Tag命中；标签：测试女优，剧情/);
    assert.deepEqual(errors, []);
    console.log('Resolver and manual UI: CDN false-positive, tags/classification, challenge/network/429 blocking, 404 distinction and safe submission passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
