'use strict';

const assert = require('node:assert/strict');
const core = require('./loveav-core.js');

assert.equal(core.extractCode('SNOS-355-Uncensored-Leaked'), 'SNOS-355');
assert.equal(core.extractCode('FC2-PPV-4972103'), 'FC2-PPV-4972103');
assert.equal(core.extractCode('300MIUM-1446'), '300MIUM-1446');
assert.equal(core.extractCode('/cn/v/START-619V-Uncensored-Leaked'), 'START-619V');

const library = [
  'tags,loveav_variants_json',
  '"小泽菜穗,美乳","[{""tags"":""小沢菜穗,熟女""}]"',
  '"黑名单女优,人妻","[]"',
].join('\n');
const rules = core.deriveRules(library, '黑名单女优', '熟女');
assert.deepEqual(rules.referenceTags, ['小泽菜穗', '小沢菜穗']);
assert.deepEqual(rules.exportBlacklist, ['熟女']);

const reference = core.classifyWork({
  code: 'DLDSS-533', actresses: ['小泽菜穗'], typeTags: ['美乳'], needsLookup: false,
}, rules);
assert.equal(reference.folder, '参考女优Tag命中');
assert.deepEqual(reference.tags, ['小泽菜穗', '美乳']);

const needCheck = core.classifyWork({
  code: 'ABC-123', actresses: ['小泽菜穗'], typeTags: [], needsLookup: true,
}, rules);
assert.equal(needCheck.folder, '需要查找');

const excluded = core.classifyWork({
  code: 'ABC-124', actresses: [], typeTags: ['熟女'], needsLookup: false,
}, rules);
assert.equal(excluded.folder, '其他');
assert.equal(excluded.excluded, true);
assert.deepEqual(excluded.tags, ['#未知女优', '熟女']);

assert.equal(core.workCodeFromUrl('https://missav.ai/dldss-533', 'MissAV'), 'DLDSS-533');
assert.equal(core.workCodeFromUrl('https://missav.ai/cn/dldss-533', 'MissAV'), 'DLDSS-533');
assert.equal(core.workCodeFromUrl('https://missav.ai/dm339/cn/dldss-533', 'MissAV'), 'DLDSS-533');
assert.equal(core.workCodeFromUrl('https://missav.ai/dm339/dldss-533', 'MissAV'), 'DLDSS-533');
assert.equal(core.workCodeFromUrl('https://missav.ai/dm339', 'MissAV'), '');
assert.equal(core.workCodeFromUrl('https://missav.ai/cn/genres/dldss-533', 'MissAV'), '');
assert.equal(core.workCodeFromUrl('https://123av.com/cn/v/fc2-ppv-4972103', '123AV'), 'FC2-PPV-4972103');
assert.equal(core.workCodeFromUrl('https://123av.com/cn', '123AV'), '');

console.log('loveav-core tests passed');
