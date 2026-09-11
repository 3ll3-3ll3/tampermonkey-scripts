const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectScript, SCRIPT_NAME_RE } = require('./loveav-whostv-runner.js');

function validScript(config) {
  return `(async () => {
  'use strict';
  const CONFIG = ${JSON.stringify(config, null, 2)};
  const runtimeScope = typeof window === 'undefined' ? globalThis : window;
  const runtimeKey = '__whosTvScrapeRuntime';
  runtimeScope.cancelWhosTvScrape = () => true;
  const pageUrl = new URL(location.href);
  pageUrl.searchParams.set('tab', 'solved');
  await fetch(pageUrl, { credentials: 'include', cache: 'no-store' });
})();`;
}

test('接受有效的增量脚本并读取截止点', () => {
  const source = validScript({
    mode: 'incremental', fromPage: 1, toPage: null, cutoffPath: '/helps/11194',
    outputFile: 'whos_tv_solved_answers_since_2026-09-10.json', delayMs: 500,
    requestTimeoutMs: 30000, maxPages: 500,
  });
  const result = inspectScript(source, 'whostv_incremental_20260911-100158.js');
  assert.equal(result.config.cutoffPath, '/helps/11194');
});

test('接受有效的第 1-n 页脚本', () => {
  const source = validScript({
    mode: 'pages', fromPage: 1, toPage: 3, cutoffPath: '',
    outputFile: 'whos_tv_solved_answers_pages_1-3.json', delayMs: 500,
    requestTimeoutMs: 30000, maxPages: 3,
  });
  assert.equal(inspectScript(source, 'whostv_pages_1_3_20260911-100158.js').config.toPage, 3);
});

test('拒绝截止点无效或关键安全标记缺失的脚本', () => {
  const invalidCutoff = validScript({
    mode: 'incremental', fromPage: 1, toPage: null, cutoffPath: '/helps/latest',
    outputFile: 'whos_tv_solved_answers_since_2026-09-10.json', delayMs: 500,
    requestTimeoutMs: 30000, maxPages: 500,
  });
  assert.throws(() => inspectScript(invalidCutoff, 'whostv_incremental_20260911-100158.js'), /截止帖无效/);
  assert.throws(
    () => inspectScript(invalidCutoff.replace("cache: 'no-store'", "cache: 'default'"), 'whostv_incremental_20260911-100158.js'),
    /不是经过校验/,
  );
});

test('文件名只接受 LoveAV Whos.tv 生成格式', () => {
  assert.equal(SCRIPT_NAME_RE.test('whostv_incremental_20260911-100158.js'), true);
  assert.equal(SCRIPT_NAME_RE.test('random.js'), false);
});
