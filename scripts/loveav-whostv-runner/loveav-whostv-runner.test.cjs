const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectScript, SCRIPT_NAME_RE, OUTPUT_PATH_HINT, validateOutputDirectory, writeJsonToDirectory } = require('./loveav-whostv-runner.js');

function validScript(config) {
  config = { outputMode: 'project-imports-v1', outputDirectoryHint: OUTPUT_PATH_HINT, ...config };
  return `(async () => {
  'use strict';
  const CONFIG = ${JSON.stringify(config, null, 2)};
  const runtimeScope = typeof window === 'undefined' ? globalThis : window;
  const runtimeKey = '__whosTvScrapeRuntime';
  runtimeScope.cancelWhosTvScrape = () => true;
  const writer = runtimeScope.__loveavWhosTvWriteJson;
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

test('拒绝仍使用普通下载的旧脚本', () => {
  const source = validScript({ mode: 'pages', fromPage: 1, toPage: 1,
    outputFile: 'whos_tv_solved_answers_pages_1-1.json', delayMs: 500,
    requestTimeoutMs: 30000, outputMode: 'download' });
  assert.throws(() => inspectScript(source, 'whostv_pages_1_1_20260916-120000.js'), /旧版下载脚本/);
});

function fixtureDirectory(options = {}) {
  const files = new Map(Object.entries(options.files || {}));
  const events = [];
  const handle = {
    kind: 'directory', name: 'imports',
    queryPermission: async () => options.permission || 'granted',
    removeEntry: async (name) => { events.push('remove'); files.delete(name); },
    getFileHandle: async (name, init = {}) => {
      events.push(init.create ? 'create' : 'lookup');
      if (!files.has(name)) {
        if (!init.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        files.set(name, '');
      }
      return {
        createWritable: async () => {
          let pending;
          return {
            write: async (text) => {
              events.push('write');
              if (options.failWrite) throw new Error('disk full');
              pending = text;
            },
            close: async () => {
              events.push('close');
              if (options.failClose) throw new Error('commit failed');
              files.set(name, options.corruptReadback ? 'corrupt' : pending);
            },
            abort: async () => { events.push('abort'); },
          };
        },
        getFile: async () => ({ size: Buffer.byteLength(files.get(name)), text: async () => files.get(name) }),
      };
    },
  };
  return { handle, files, events };
}

function outputOptions(extra = {}) {
  return {
    fileName: 'whos_tv_solved_answers_since_2026-09-11.json',
    content: JSON.stringify({ count: 1, entries: [{ title: '测试', answer: 'ABC-123' }] }),
    mimeType: 'application/json;charset=utf-8', outputDirectoryHint: OUTPUT_PATH_HINT,
    ...extra,
  };
}

test('完整 JSON 写入授权目录并回读确认，提交后才返回成功', async () => {
  const fixture = fixtureDirectory();
  const options = outputOptions({ onCommitStart: () => fixture.events.push('commit-start') });
  const result = await writeJsonToDirectory(fixture.handle, options);
  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(result.fileName, options.fileName);
  assert.equal(result.bytes, Buffer.byteLength(options.content));
  assert.equal(fixture.files.get(result.fileName), options.content);
  assert.ok(fixture.events.indexOf('commit-start') < fixture.events.indexOf('close'));
});

test('同名已有 JSON 被保留，新结果另存且返回实际文件名', async () => {
  const options = outputOptions();
  const fixture = fixtureDirectory({ files: { [options.fileName]: 'previous result' } });
  const result = await writeJsonToDirectory(fixture.handle, options);
  assert.notEqual(result.fileName, options.fileName);
  assert.match(result.fileName, /^whos_tv_solved_answers_since_2026-09-11_[0-9]+_[a-f0-9]+\.json$/);
  assert.equal(fixture.files.get(options.fileName), 'previous result');
  assert.equal(fixture.files.get(result.fileName), options.content);
});

test('错误目录、失效权限和无效结果在创建文件前拒绝', async () => {
  assert.throws(() => validateOutputDirectory({ kind: 'directory', name: 'Downloads' }), /请选择 imports/);
  const denied = fixtureDirectory({ permission: 'denied' });
  await assert.rejects(writeJsonToDirectory(denied.handle, outputOptions()), /权限已失效/);
  assert.equal(denied.events.length, 0);
  const invalid = fixtureDirectory();
  await assert.rejects(writeJsonToDirectory(invalid.handle, outputOptions({ fileName: '../outside.json' })), /参数无效/);
  await assert.rejects(writeJsonToDirectory(invalid.handle, outputOptions({ content: '{"count":0,"entries":[]}' })), /不是完整/);
  assert.equal(invalid.events.length, 0);
});

test('写入失败和提交前取消会 abort 且清除本轮空文件，既有结果不受影响', async () => {
  const failed = fixtureDirectory({ failWrite: true, files: { 'old.json': 'keep' } });
  await assert.rejects(writeJsonToDirectory(failed.handle, outputOptions()), /disk full/);
  assert.equal(failed.events.includes('abort'), true);
  assert.deepEqual([...failed.files], [['old.json', 'keep']]);
  const cancelled = fixtureDirectory();
  await assert.rejects(writeJsonToDirectory(cancelled.handle, outputOptions({
    checkCancelled: () => { if (cancelled.events.includes('write')) throw new Error('用户取消'); },
  })), /用户取消/);
  assert.equal(cancelled.events.includes('close'), false);
  assert.equal(cancelled.files.size, 0);
});

test('提交失败或保存后核验失败准确返回未知结果并保留文件供检查', async () => {
  for (const options of [{ failClose: true }, { corruptReadback: true }]) {
    const fixture = fixtureDirectory(options);
    await assert.rejects(writeJsonToDirectory(fixture.handle, outputOptions()), (error) => {
      assert.equal(error.fileMayExist, true);
      assert.match(error.message, /保存结果尚未确认/);
      return true;
    });
    assert.equal(fixture.files.size, 1);
    assert.equal(fixture.events.includes('remove'), false);
  }
});
