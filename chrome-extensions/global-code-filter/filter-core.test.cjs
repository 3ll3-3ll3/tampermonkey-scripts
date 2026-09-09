const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./filter-core.js');
const manifest = require('./manifest.json');

test('manifest is a minimal standalone Chrome extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, '全局番号过滤器');
  assert.equal(manifest.version, '1.0.1');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.options_page, 'filter.html');
  assert.deepEqual(manifest.permissions, ['clipboardWrite']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
});

test('normalizes numeric studio prefixes and V release suffixes', () => {
  assert.equal(core.normalizeCode('300MIUM-1446'), 'MIUM-1446');
  assert.equal(core.normalizeCode('START-619V-Uncensored-Leaked'), 'START-619');
  const input = [
    '1. SNOS-355-Uncensored-Leaked',
    '2. FC2-PPV-4972103',
    '3. SNOS-342-Uncensored-Leaked',
    '4. SNOS-313-Uncensored-Leaked',
    '5. ROYD-347-Uncensored-Leaked',
    '6. 300MIUM-1446',
    '7. FNS-256',
    '8. START-619V-Uncensored-Leaked',
    '9. IPZZ-916',
    '10. START-636-Uncensored-Leaked',
    '11. SNOS-401-Uncensored-Leaked',
    '12. NSODN-025-Uncensored-Leaked',
    '13. FC2-PPV-4971673',
    '14. SNOS-310-Uncensored-Leaked',
    '15. START-631',
    '16. DSOD-060-Uncensored-Leaked',
    '17. DLDSS-542',
    '18. FNS-254',
    '19. SDAB-357',
    '20. FC2-PPV-4973177',
  ].join('\n');
  assert.deepEqual(core.parseInputCodeList(input), [
    'SNOS-355', 'FC2-PPV-4972103', 'SNOS-342', 'SNOS-313', 'ROYD-347',
    'MIUM-1446', 'FNS-256', 'START-619', 'IPZZ-916', 'START-636',
    'SNOS-401', 'NSODN-025', 'FC2-PPV-4971673', 'SNOS-310', 'START-631',
    'DSOD-060', 'DLDSS-542', 'FNS-254', 'SDAB-357', 'FC2-PPV-4973177',
  ]);
});

test('does not turn common numbered noise into codes', () => {
  const input = 'Office 365\nISO-9001A\n300OFFICE-365\n2026-09-09\n1920x1080';
  assert.deepEqual(core.parseInputCodeList(input), []);
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
