const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./filter-core.js');
const manifest = require('./manifest.json');

test('manifest is a minimal standalone Chrome extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, '全局番号过滤器');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.options_page, 'filter.html');
  assert.deepEqual(manifest.permissions, ['clipboardWrite']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
});

test('filters mixed text with v0.5.13-compatible rules', () => {
  const input = 'ABF354\nhttps://missav.ai/cn/sone-314-chinese-subtitle\nFC2 PPV 4625027\n800×540, 161.2 KB\nOffice 365';
  assert.deepEqual(core.parseInputCodeList(input), ['ABF-354', 'SONE-314', 'FC2-PPV-4625027']);
});

test('handles million-character input without truncation', () => {
  const lines = [];
  for (let index = 0; index < 100000; index++) lines.push(`普通文字 ${index}`);
  lines.splice(100, 0, 'abf-354');
  lines.splice(50000, 0, 'FC2 PPV 4625027');
  lines.push('https://missav.ai/cn/sone-314-chinese-subtitle');
  const input = lines.join('\n');
  assert.ok(input.length > 1000000);
  assert.deepEqual(core.parseInputCodeList(input), ['ABF-354', 'FC2-PPV-4625027', 'SONE-314']);
});
