const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./missav-code-filter-core.js');

test('normalizes standard and FC2 codes', () => {
  assert.equal(core.normalizeCode('abf354'), 'ABF-354');
  assert.equal(core.normalizeCode('FC2 4625027'), 'FC2-PPV-4625027');
  assert.equal(core.normalizeCode('https://missav.ai/dm96/cn/FC2-4625027'), 'FC2-PPV-4625027');
});

test('keeps source order and removes duplicate HTML noise', () => {
  const input = '<div id="message14298">ABF-354</div>\nhttps://missav.ai/cn/sone-314-chinese-subtitle\nFC2 PPV 4625027\n<span class="media_video">ABF354</span>';
  assert.deepEqual(core.parseCodeList(input), ['ABF-354', 'SONE-314', 'FC2-PPV-4625027']);
});

test('ignores ordinary URLs, images, dimensions and file sizes', () => {
  const input = 'https://hostloc.com/thread-1285447-1-1.html\nhttps://example.com/assets/mark_1232.jpg\n800×540, 161.2 KB\n90x122, 1.4 MB\nhttps://123av.com/cn/v/393otim-648-uncensored-leaked\nhttps://missav.ai/cn/ofes-022-uncensored-leak';
  assert.deepEqual(core.parseCodeList(input), ['OTIM-648', 'OFES-022']);
});

test('rejects product, course, date, time, age and suffix noise', () => {
  const input = 'PDF24 Office 365 Java 11 IEOR 6711 Fall 2013 RJ01393321 PRO-18 YOUPORN-51 TV-20 TV-1920\nWhos.tv 17.07.2026 00:50:02\n▶️ SIRO-5690-UNCENSORED-LEAK 13:48\nKNMB-026 完全生猛风格 @ Miiro 18岁\nOPEN-0604 正规影片标题';
  assert.deepEqual(core.parseCodeList(input), ['SIRO-5690', 'KNMB-026', 'OPEN-0604']);
});

test('keeps exact MissAV source URL', () => {
  assert.deepEqual(core.parseInputEntries('<a href="https://missav.ai/dm15/meyd-916-uncensored-leak">MEYD-916 完整影片</a>'), [{
    code: 'MEYD-916',
    sourceUrl: 'https://missav.ai/dm15/meyd-916-uncensored-leak',
  }]);
});

test('filters official Raindrop CSV by meaningful columns', () => {
  const csv = `id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
1,"GOSE product",,,https://example.com/page,臀模,,2026-01-01,https://example.com/fill_mark_1232.jpg,,false
2,"Sivr 336 #1",,"Video Sivr 336 #1 HQ",https://example.com/watch/123,日本av,,2026-01-01,https://example.com/logo_300.png,,false
3,"Office 365 教程",,,https://example.com/office,学习,,2026-01-01,https://example.com/office_365.png,,false
4,"ABF-356",,,https://123av.com/cn/v/abf-356-uncensored-leaked,日本av,,2026-01-01,https://cdn.example.com/cover.webp,,false
5,"MIUM-1047",,,https://missav.ai/cn/mium-1047-uncensored-leak,MissAV_Import,,2026-01-01,https://cdn.example.com/cover.webp,,false`;
  assert.deepEqual(core.parseInputCodeList(csv), ['SIVR-336', 'ABF-356', 'MIUM-1047']);
});

test('accepts MissAV ws mirror and keeps real codes near Telegram noise', () => {
  const input = `
    <div class="status details">800×540, 161.2 KB</div>
    <a href="https://missav.ws/fft-041-uncensored-leak?utm_source=telegram">详情</a>
    MissAV Daily 16.07.2026 14:22:16
    DVAJ-609 アリスJAPAN 13分钟前
    鲍鱼云 @baoyuyun 24.06.2026 名称: MIFD-070
  `;
  assert.deepEqual(core.parseInputCodeList(input), ['FFT-041', 'DVAJ-609', 'MIFD-070']);
});

test('replays the v0.5.13 59-row feedback classification', () => {
  const confirmed = ['SIVR-336', 'OFJE-473', 'OFJE-357', 'NSPS-234', 'OFES-022', 'ABF-356', 'JUVR-294', 'KIWVR-849', 'NAMHVR-002', 'OTIM-648', 'SAVR-1069', 'VRKM-1654', 'MIUM-1047'];
  const rejected = [
    'MARK-1232', 'LARGE-301944', 'XV-10', 'ALL-18', 'TMYX-019', 'THREAD-1285447', 'XIUREN-2024', 'NO-8633',
    'PDF-24', 'TELEGRAM-18', 'RJ-01114383', 'LOGO-128', 'JOHREN-18', 'RJ-01393321', 'IEOR-6711', 'FALL-2013',
    'DG-2017', 'PROBABILITY-70', 'STATISTICS-251', 'SPRING-2013', 'PYTHON-100', 'THREAD-1802960', 'OF-21', 'CB-345',
    'RELATED-2479604', 'WXSYNC-2024', 'TPS-128', 'OFFICE-365', 'QQ-44866828', 'GITHUB-2406', 'SERIES-15', 'PRO-18',
    'WEIXIN-40425640', 'TS-12434', 'RESULT-2023', 'TPS-640', 'WEIXIN-37737254', 'QQ-38869359', 'VW-01', 'TPS-110', 'TV-20',
    'QQ-22163371', 'LOGO-300', 'POST-247662', 'TS-4646', 'JAVA-11', 'LOGO-192',
  ];
  const header = 'id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite';
  const confirmedRows = confirmed.map((code, index) => `${index + 1},${code},,,https://123av.com/cn/v/${code.toLowerCase()},日本av,,2026-01-01,https://cdn.example.com/cover.webp,,false`);
  const rejectedRows = rejected.map((code, index) => `${index + 100},"普通资料 ${code}",,,https://example.com/thread/${code.toLowerCase()},学习资料,,2026-01-01,https://example.com/assets/${code.toLowerCase()}.jpg,,false`);
  assert.deepEqual(core.parseInputCodeList([header, ...confirmedRows, ...rejectedRows].join('\n')), confirmed);
});
