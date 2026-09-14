'use strict';

const assert = require('node:assert/strict');
const core = require('./loveav-core.js');
const filter = require('./filter-core.js');
global.MissAVCodeFilterCore = filter;
global.LoveAVCore = core;
const resolver = require('./missav-resolver.js');

assert.equal(core.extractCode('SNOS-355-Uncensored-Leaked'), 'SNOS-355');
assert.equal(core.extractCode('FC2-PPV-4972103'), 'FC2-PPV-4972103');
assert.equal(core.extractCode('300MIUM-1446'), '300MIUM-1446');
assert.equal(core.extractCode('/cn/v/START-619V-Uncensored-Leaked'), 'START-619V');
assert.equal(filter.normalizeCode('300MIUM-1446'), 'MIUM-1446');
assert.equal(filter.normalizeCode('START-619V-Uncensored-Leaked'), 'START-619');
assert.equal(filter.normalizeCode('FC2-PPV-4972103'), 'FC2-PPV-4972103');
assert.deepEqual(
  filter.parseCodeList([
    '1. SNOS-355-Uncensored-Leaked',
    '2. FC2-PPV-4972103',
    '3. 300MIUM-1446',
    '4. START-619V-Uncensored-Leaked',
    '5. START-619',
  ].join('\n')),
  ['SNOS-355', 'FC2-PPV-4972103', 'MIUM-1446', 'START-619'],
);

const library = [
  'tags,loveav_variants_json,loveav_canonical_code',
  '"小泽菜穗,美乳","[{""tags"":""小沢菜穗,熟女""}]","300MIUM-1446"',
  '"黑名单女优,人妻","[]","START-619V"',
].join('\n');
const rules = core.deriveRules(library, '黑名单女优', '熟女');
assert.deepEqual(rules.referenceTags, ['小泽菜穗', '小沢菜穗']);
assert.deepEqual(rules.exportBlacklist, ['熟女']);
assert.deepEqual(rules.libraryCodeKeys, ['MIUM1446', 'START619']);
assert.equal(rules.stats.libraryCodesStored, 2);
assert.equal(core.codeComparableKey('300MIUM-1446'), 'MIUM1446');
assert.equal(core.codeComparableKey('START-619V'), 'START619');
assert.equal(resolver.normalizeCode('START-619V-Uncensored-Leaked'), 'START-619');
assert.equal(resolver.candidateUrls('SNOS-355')[0], 'https://missav.ai/cn/snos-355');
assert.equal(resolver.candidateUrls('FC2-PPV-4972103').length, 5);
assert.equal(resolver.pageContainsCode('<title>SNOS-355 Uncensored</title>', 'SNOS-355'), true);
assert.equal(resolver.pageLooksChallenged('<title>Just a moment...</title><div class="cf-chl-widget">'), true);

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

assert.deepEqual(
  core.destinationForWork({ site: 'MissAV', folder: '参考女优Tag命中' }, { destinationMode: 'site' }),
  { key: 'site:MissAV', name: 'MissAV', id: 0, ruleFolder: '参考女优Tag命中' },
);
assert.deepEqual(
  core.destinationForWork({ site: '123AV', folder: '其他' }, { destinationMode: 'site' }),
  { key: 'site:123AV', name: 'javxxx&123av', id: 0, ruleFolder: '其他' },
);
assert.deepEqual(
  core.destinationForWork(
    { site: 'MissAV', folder: '需要查找' },
    { destinationMode: 'classification', collectionNames: { '需要查找': '待复核' }, collectionIds: { '需要查找': 42 } },
  ),
  { key: 'classification:需要查找', name: '待复核', id: 42, ruleFolder: '需要查找' },
);

console.log('loveav-core tests passed');
