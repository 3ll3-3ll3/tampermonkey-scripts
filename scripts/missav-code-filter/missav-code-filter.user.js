// ==UserScript==
// @name         MissAV 番号过滤器（v0.5.13 兼容）
// @namespace    wjl.local
// @version      1.0.0
// @description  复刻 MissAV Manager v0.5.13 的番号过滤器，支持粘贴、多文件、Raindrop CSV、复制与 TXT 下载。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @match        https://missav.ws/*
// @match        https://*.missav.ws/*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// ==/UserScript==

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MissAVCodeFilterCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // This core is a browser-safe extraction of MissAV Manager v0.5.13's
  // src/parser.js, src/inputExtractor.js and the required CSV reader.
  function decodeLooseText(text) {
    return String(text || '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  }

  function extractFC2Number(value) {
    const text = String(value || '').trim().toUpperCase();
    const patterns = [
      /^FC2[_\-\s]*PPV[_\-\s]*(\d+)$/i,
      /^FC2[_\-\s]*(\d+)$/i,
      /FC2[_\-\s]*PPV[_\-\s]*(\d+)/i,
      /FC2[_\-\s]*(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return '';
  }

  function extractCodeFromUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    let slug = raw;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const url = new URL(raw);
        slug = url.pathname.split('/').filter(Boolean).pop() || '';
      }
    } catch {
      slug = raw.split(/[?#]/)[0].split('/').filter(Boolean).pop() || raw;
    }
    slug = decodeURIComponent(slug)
      .replace(/-chinese-subtitle$/i, '')
      .replace(/-uncensored-leak$/i, '')
      .replace(/[_\s]+/g, '-')
      .trim();
    const fc2 = slug.match(/^fc2(?:-?ppv)?-?(\d{4,10})$/i);
    if (fc2) return `FC2-PPV-${fc2[1]}`;
    const normal = slug.match(/^([a-z]{2,8})-?(\d{2,5})$/i);
    if (normal) return `${normal[1].toUpperCase()}-${normal[2]}`;
    return '';
  }

  function normalizeCode(value) {
    let code = String(value || '').trim();
    const shouldExtract = /^https?:\/\//i.test(code)
      || /missav\./i.test(code)
      || /-(chinese-subtitle|uncensored-leak)$/i.test(code);
    const urlCode = shouldExtract ? extractCodeFromUrl(code) : '';
    if (urlCode) return normalizeCode(urlCode);
    code = decodeLooseText(code).toUpperCase().replace(/\s+/g, '');
    if (/^FC2/i.test(code)) {
      const number = extractFC2Number(code);
      if (number) return `FC2-PPV-${number}`;
    }
    const match = code.match(/^([A-Z]{2,8})[-_]?(\d{2,5})$/);
    if (match) return `${match[1]}-${match[2]}`;
    return code;
  }

  function codeComparableKey(code) {
    const normalized = normalizeCode(code);
    if (normalized.startsWith('FC2-PPV-')) return `FC2PPV${extractFC2Number(normalized)}`;
    return normalized.replace(/-/g, '');
  }

  const NOISE_CODE_PREFIXES = new Set([
    'MESSAGE', 'MESSAGES', 'USERPIC', 'MEDIA', 'VIDEO', 'PHOTO', 'AVATAR',
    'PAGINATION', 'DETAILS', 'STATUS', 'TITLE', 'BODY', 'CLASS', 'STYLE',
    'DATE', 'HTML', 'BUTTON', 'INPUT', 'IMAGE', 'THUMB', 'THUMBNAIL',
    'AV', 'TOP', 'BEST', 'FUCK', 'MOODYZ', 'TAMEIKE', 'ALL', 'PDF',
    'TELEGRAM', 'LOGO', 'JOHREN', 'IEOR', 'PROBABILITY', 'STATISTICS',
    'PYTHON', 'OFFICE', 'GITHUB', 'SERIES', 'WEIXIN', 'RESULT', 'RELATED',
    'THREAD', 'XIUREN', 'WXSYNC', 'JAVA', 'LARGE', 'RJ', 'NO', 'PRO',
    'YOUPORN', 'TV',
  ]);
  const DATE_WORD_PREFIXES = new Set([
    'JAN', 'JANUARY', 'FEB', 'FEBRUARY', 'MAR', 'MARCH', 'APR', 'APRIL',
    'MAY', 'JUN', 'JUNE', 'JUL', 'JULY', 'AUG', 'AUGUST', 'SEP', 'SEPT',
    'SEPTEMBER', 'OCT', 'OCTOBER', 'NOV', 'NOVEMBER', 'DEC', 'DECEMBER',
  ]);

  function isNoiseCodePrefix(code) {
    const match = String(code || '').toUpperCase().match(/^([A-Z]+)-([0-9]+)$/);
    if (!match) return false;
    const prefix = match[1];
    const number = Number(match[2]);
    if (NOISE_CODE_PREFIXES.has(prefix)) return true;
    if (DATE_WORD_PREFIXES.has(prefix) && number >= 1900 && number <= 2099) return true;
    return ['SPRING', 'SUMMER', 'FALL', 'AUTUMN', 'WINTER'].includes(prefix)
      && number >= 1900 && number <= 2099;
  }

  function isLikelyStandardCode(code) {
    if (/^PPV-\d+/i.test(code) || isNoiseCodePrefix(code)) return false;
    return /^(FC2-PPV-\d{4,10}|[A-Z]{2,8}-\d{2,5})$/.test(code);
  }

  function addCode(codes, raw, index, trusted) {
    const code = normalizeCode(raw);
    const valid = trusted
      ? /^(FC2-PPV-\d{4,10}|[A-Z]{2,8}-\d{2,5})$/.test(code)
      : isLikelyStandardCode(code);
    if (valid) codes.push({ code, index: index || 0 });
  }

  const TRUSTED_AV_HOSTS = [
    'missav.ai', 'missav.ws', '123av.com', 'avbase.net', 'javdb.com',
    'javbus.com', 'javlibrary.com', 'supjav.com', 'njav.tv', 'jable.tv', 'jav.guru',
  ];

  function isTrustedAvHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return TRUSTED_AV_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
  }

  function extractCodesFromTrustedAvUrl(input) {
    const raw = String(input || '').trim().replace(/[.,;!?]+$/, '');
    if (!/^https?:\/\//i.test(raw)) return [];
    let url;
    try { url = new URL(raw); } catch { return []; }
    if (!isTrustedAvHost(url.hostname)) return [];
    const source = decodeURIComponent(url.pathname);
    const matches = [];
    const exact = extractCodeFromUrl(url.href);
    if (/^(FC2-PPV-\d{4,10}|[A-Z]{2,8}-\d{2,5})$/.test(exact)) matches.push(exact);
    for (const match of source.matchAll(/(?:^|[^a-z0-9])fc2(?:[\s_-]*ppv)?[\s_-]*(\d{4,10})(?=$|[^0-9])/gi)) {
      matches.push(`FC2-PPV-${match[1]}`);
    }
    for (const match of source.matchAll(/(?:^|[^a-z])([a-z]{2,8})[\s_-]+(\d{2,5})(?=$|[^0-9])/gi)) {
      const code = normalizeCode(`${match[1]}-${match[2]}`);
      if (isLikelyStandardCode(code)) matches.push(code);
    }
    return [...new Set(matches)];
  }

  function maskGenericNoise(text) {
    const preserveLength = match => match.replace(/[^\r\n]/g, ' ');
    return String(text || '')
      .replace(/https?:\/\/[^\s"'<>)]*/gi, preserveLength)
      .replace(/<[^>]*>/g, preserveLength)
      .replace(/\b\d{1,5}\s*[×x]\s*\d{1,5}\b/gi, preserveLength)
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:bytes?|[kmgt]i?b)\b/gi, preserveLength)
      .replace(/\bview\s+results\s+page\b/gi, preserveLength)
      .replace(/\b(?:powered\s+by\s+)?whos\.tv\b/gi, preserveLength)
      .replace(/\bmissav\s+daily\b/gi, preserveLength)
      .replace(/\buncensored[\s_-]+leak(?:ed)?\b/gi, preserveLength)
      .replace(/@\s*[a-z][a-z0-9_]{1,31}/gi, preserveLength)
      .replace(/\b[a-z][a-z0-9_]{1,31}\s+\d{1,2}\s*(?:岁|years?\s+old)/gi, preserveLength)
      .replace(/\b[a-z][a-z0-9_]{1,31}\s+\d{1,3}\s*(?:秒|分钟|小时|小時|天)前/gi, preserveLength);
  }

  function parseCodeList(text) {
    const decoded = decodeLooseText(String(text || ''));
    const codes = [];
    for (const match of decoded.matchAll(/https?:\/\/[^\s"'<>)]*/gi)) {
      for (const code of extractCodesFromTrustedAvUrl(match[0])) addCode(codes, code, match.index, true);
    }
    const visibleText = maskGenericNoise(decoded);
    for (const match of visibleText.matchAll(/(^|[^A-Za-z0-9])FC2(?:[ \t_-]*PPV)?[ \t_-]*(\d{4,10})(?=$|[^A-Za-z0-9])/gi)) {
      addCode(codes, `FC2-PPV-${match[2]}`, (match.index || 0) + match[1].length, false);
    }
    for (const match of visibleText.matchAll(/(^|[^A-Za-z0-9])([A-Za-z]{2,8})[ \t_-]+(\d{2,5})(?=$|[^A-Za-z0-9])/g)) {
      addCode(codes, `${match[2]}-${match[3]}`, (match.index || 0) + match[1].length, false);
    }
    for (const match of visibleText.matchAll(/(^|[^A-Za-z0-9])([A-Z]{2,8})(\d{2,5})(?=$|[^A-Za-z0-9])/g)) {
      addCode(codes, `${match[2]}-${match[3]}`, (match.index || 0) + match[1].length, false);
    }
    const seen = new Set();
    return codes.sort((a, b) => a.index - b.index).filter(item => {
      const key = codeComparableKey(item.code);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => item.code);
  }

  function uniqueHeaders(headers) {
    const seen = new Map();
    return headers.map((header, index) => {
      const base = String(header || '').trim() || `Column${index + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? `${base}_${count + 1}` : base;
    });
  }

  function appendCsvContinuation(row, column, value) {
    const current = String(row[column] || '');
    row[column] = current ? `${current}\n${value}` : String(value || '');
  }

  function repairRaindropLineBreaks(headers, rows, rowLengths) {
    const official = ['id', 'title', 'note', 'excerpt', 'url', 'folder', 'tags', 'created', 'cover', 'highlights', 'favorite'];
    if (headers.length !== official.length || official.some((name, index) => String(headers[index] || '').toLowerCase() !== name)) return rows;
    const repaired = [];
    let current = null;
    let continuationColumn = null;
    rows.forEach((row, index) => {
      const rawLength = rowLengths[index] || 0;
      if (/^\d+$/.test(String(row[0] || '').trim())) {
        current = row.slice();
        repaired.push(current);
        continuationColumn = rawLength > 0 && rawLength < official.length ? rawLength - 1 : null;
        return;
      }
      if (!current || continuationColumn === null) {
        if (row.some(value => String(value || '').trim())) repaired.push(row);
        return;
      }
      const sourceUrl = row.findIndex(value => /^https?:\/\//i.test(String(value || '').trim()));
      if (sourceUrl >= 0 && continuationColumn < 4 && !String(current[4] || '').trim()) {
        appendCsvContinuation(current, continuationColumn, row.slice(0, sourceUrl).join(','));
        for (let source = sourceUrl, target = 4; source < rawLength && target < official.length; source++, target++) current[target] = row[source] || '';
        continuationColumn = null;
        return;
      }
      appendCsvContinuation(current, continuationColumn, row.slice(0, rawLength).join(','));
    });
    return repaired;
  }

  function parseCSV(text) {
    const input = String(text || '').replace(/^\ufeff/, '');
    const records = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let index = 0; index < input.length; index++) {
      const ch = input[index];
      const next = input[index + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') { field += '"'; index++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        row.push(field); field = '';
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') index++;
        row.push(field); records.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field.length || row.length) { row.push(field); records.push(row); }
    while (records.length && records[records.length - 1].every(value => !String(value || '').trim())) records.pop();
    const rawHeaders = records.shift() || [];
    const headers = uniqueHeaders(rawHeaders.map((header, index) => String(header || '').trim() || `Column${index + 1}`));
    const colCount = Math.max(headers.length, ...records.map(record => record.length), 0);
    while (headers.length < colCount) headers.push(`Column${headers.length + 1}`);
    const rowLengths = records.map(record => record.length);
    const rows = records.map(record => {
      const next = record.slice(0, colCount);
      while (next.length < colCount) next.push('');
      return next;
    });
    return { headers, rows: repairRaindropLineBreaks(headers, rows, rowLengths) };
  }

  const JAV_FOLDER_PATTERN = /(?:日本\s*av|missav|123av|\bjav\b|番号)/i;

  function uniqueCodes(values) {
    const seen = new Set();
    return (values || []).filter(code => {
      const key = codeComparableKey(code);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeTrustedMissavUrl(value) {
    const raw = String(value || '').trim().replace(/[.,;!?，。；！？]+$/, '');
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (!['missav.ai', 'missav.ws'].some(domain => host === domain || host.endsWith(`.${domain}`))) return '';
      parsed.hash = '';
      return parsed.href;
    } catch { return ''; }
  }

  function entriesFromCodesAndUrls(codes, urlPairs) {
    const sourceByKey = new Map();
    for (const pair of urlPairs || []) {
      const sourceUrl = normalizeTrustedMissavUrl(pair && pair.url);
      if (!sourceUrl) continue;
      const values = Array.isArray(pair.codes) ? pair.codes : extractCodesFromTrustedAvUrl(sourceUrl);
      for (const code of values) {
        const key = codeComparableKey(code);
        if (key && !sourceByKey.has(key)) sourceByKey.set(key, sourceUrl);
      }
    }
    return uniqueCodes(codes).map(code => ({ code, sourceUrl: sourceByKey.get(codeComparableKey(code)) || '' }));
  }

  function isRaindropCsv(parsed) {
    const headers = new Set((parsed && parsed.headers || []).map(header => String(header || '').trim().toLowerCase()));
    return ['title', 'url', 'folder', 'tags', 'created', 'cover'].every(header => headers.has(header));
  }

  function titleIsEssentiallyCode(title, code) {
    const normalized = String(title || '').trim().replace(/[【】[\]()]/g, '').replace(/\s*#\d+\s*$/, '').trim();
    if (!normalized) return false;
    const only = parseCodeList(normalized);
    if (only.length !== 1 || codeComparableKey(only[0]) !== codeComparableKey(code)) return false;
    const codePattern = String(code).replace('-', '[\\s_-]*');
    return new RegExp(`^${codePattern}$`, 'i').test(normalized);
  }

  function parseRaindropCsvCodes(parsed) {
    const indexByName = new Map(parsed.headers.map((header, index) => [String(header || '').trim().toLowerCase(), index]));
    const at = (row, name) => String(row[indexByName.get(name)] || '');
    const output = [];
    for (const row of parsed.rows || []) {
      const title = at(row, 'title');
      const url = at(row, 'url');
      const folder = at(row, 'folder');
      const trustedUrlCodes = extractCodesFromTrustedAvUrl(url);
      const contextualCodes = parseCodeList(title);
      output.push(...trustedUrlCodes);
      const trustedContext = JAV_FOLDER_PATTERN.test(folder) || trustedUrlCodes.length > 0;
      for (const code of contextualCodes) if (trustedContext || titleIsEssentiallyCode(title, code)) output.push(code);
    }
    return uniqueCodes(output);
  }

  function parseRaindropCsvEntries(parsed) {
    const indexByName = new Map(parsed.headers.map((header, index) => [String(header || '').trim().toLowerCase(), index]));
    const urlIndex = indexByName.get('url');
    const urls = [];
    for (const row of parsed.rows || []) {
      const sourceUrl = normalizeTrustedMissavUrl(String(row[urlIndex] || ''));
      if (sourceUrl) urls.push({ url: sourceUrl, codes: extractCodesFromTrustedAvUrl(sourceUrl) });
    }
    return entriesFromCodesAndUrls(parseRaindropCsvCodes(parsed), urls);
  }

  function parseInputEntries(text) {
    const raw = String(text || '');
    const firstLine = raw.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
    if (firstLine.includes('title') && firstLine.includes('url') && firstLine.includes('folder') && firstLine.includes('cover')) {
      try {
        const parsed = parseCSV(raw);
        if (isRaindropCsv(parsed)) return parseRaindropCsvEntries(parsed);
      } catch {}
    }
    const urlPairs = [];
    for (const match of raw.matchAll(/https?:\/\/[^\s"'<>)]*/gi)) {
      const sourceUrl = normalizeTrustedMissavUrl(match[0]);
      if (sourceUrl) urlPairs.push({ url: sourceUrl, codes: extractCodesFromTrustedAvUrl(sourceUrl) });
    }
    return entriesFromCodesAndUrls(parseCodeList(raw), urlPairs);
  }

  function parseInputCodeList(text) {
    return parseInputEntries(text).map(entry => entry.code);
  }

  return {
    version: 'v0.5.13-compatible',
    normalizeCode,
    codeComparableKey,
    extractCodesFromTrustedAvUrl,
    parseCodeList,
    parseCSV,
    isRaindropCsv,
    parseRaindropCsvCodes,
    parseInputEntries,
    parseInputCodeList,
  };
});

(() => {
  'use strict';

  const core = globalThis.MissAVCodeFilterCore;
  if (!core) throw new Error('[MissAV Code Filter] core is missing');

  const PANEL_ID = 'missav-code-filter-panel';
  const STYLE_ID = 'missav-code-filter-style';
  const HAS_MENU_COMMAND = typeof GM_registerMenuCommand === 'function';
  const existing = globalThis.__missavCodeFilter;
  if (existing && typeof existing.show === 'function') {
    existing.show();
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} { position: fixed; top: 14px; right: 14px; z-index: 2147483647; width: min(620px, calc(100vw - 28px)); max-height: calc(100vh - 28px); overflow: auto; color: #e5e7eb; background: rgba(15,23,42,.98); border: 1px solid #475569; border-radius: 14px; box-shadow: 0 18px 55px rgba(0,0,0,.5); font: 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${PANEL_ID} .mcf-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #111827; border-bottom: 1px solid #334155; }
    #${PANEL_ID} .mcf-title strong { display: block; font-size: 15px; }
    #${PANEL_ID} .mcf-title small { color: #93c5fd; }
    #${PANEL_ID} .mcf-close { padding: 1px 8px; color: #cbd5e1; background: transparent; border: 0; font-size: 20px; cursor: pointer; }
    #${PANEL_ID} .mcf-body { padding: 12px; }
    #${PANEL_ID} .mcf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    #${PANEL_ID} label { display: block; min-width: 0; }
    #${PANEL_ID} .mcf-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; color: #cbd5e1; }
    #${PANEL_ID} textarea { display: block; width: 100%; min-height: 290px; padding: 9px; resize: vertical; color: #f8fafc; background: #0b1220; border: 1px solid #475569; border-radius: 8px; font: 12px/1.5 ui-monospace,Consolas,monospace; }
    #${PANEL_ID} textarea[readonly] { background: #101827; }
    #${PANEL_ID} .mcf-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
    #${PANEL_ID} button, #${PANEL_ID} .mcf-file-label { padding: 6px 10px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; cursor: pointer; font: inherit; }
    #${PANEL_ID} button:hover, #${PANEL_ID} .mcf-file-label:hover { filter: brightness(1.12); }
    #${PANEL_ID} .mcf-secondary { background: #475569; }
    #${PANEL_ID} .mcf-danger { background: #991b1b; }
    #${PANEL_ID} .mcf-file-label input { display: none; }
    #${PANEL_ID} .mcf-status { flex: 1; min-width: 180px; color: #93c5fd; text-align: right; }
    #${PANEL_ID} .mcf-status[data-kind="done"] { color: #86efac; }
    #${PANEL_ID} .mcf-status[data-kind="error"] { color: #fca5a5; }
    #${PANEL_ID} .mcf-note { margin-top: 9px; color: #94a3b8; font-size: 12px; }
    @media (max-width: 720px) { #${PANEL_ID} .mcf-grid { grid-template-columns: 1fr; } #${PANEL_ID} textarea { min-height: 190px; } }
  `;
  (document.head || document.documentElement).appendChild(style);

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.style.display = HAS_MENU_COMMAND ? 'none' : 'block';
  panel.innerHTML = `
    <div class="mcf-head">
      <div class="mcf-title"><strong>MissAV 番号过滤器</strong><small>v0.5.13 规则兼容</small></div>
      <button class="mcf-close" type="button" title="隐藏面板">×</button>
    </div>
    <div class="mcf-body">
      <div class="mcf-grid">
        <label><span class="mcf-label"><strong>原始文字</strong><small>粘贴或导入多个文件</small></span><textarea class="mcf-input" placeholder="粘贴 TG、网页、HTML、Markdown、MissAV 链接或番号" spellcheck="false"></textarea></label>
        <label><span class="mcf-label"><strong>过滤后的番号</strong><small class="mcf-count">0 条 · 一行一个</small></span><textarea class="mcf-output" placeholder="识别结果会自动显示在这里" spellcheck="false" readonly></textarea></label>
      </div>
      <div class="mcf-actions">
        <label class="mcf-file-label">导入文件<input class="mcf-files" type="file" multiple accept=".txt,.html,.htm,.md,.json,.csv,.log,text/plain,text/html,text/csv,application/json"></label>
        <button class="mcf-run" type="button">执行过滤</button>
        <button class="mcf-copy mcf-secondary" type="button">复制结果</button>
        <button class="mcf-save mcf-secondary" type="button">下载 TXT</button>
        <button class="mcf-clear mcf-danger" type="button">清空</button>
        <span class="mcf-status">就绪</span>
      </div>
      <div class="mcf-note">只在本页本地处理输入，不联网、不保存历史、不读取账号、Cookie 或浏览器存储。</div>
    </div>
  `;
  (document.body || document.documentElement).appendChild(panel);

  const input = panel.querySelector('.mcf-input');
  const output = panel.querySelector('.mcf-output');
  const count = panel.querySelector('.mcf-count');
  const status = panel.querySelector('.mcf-status');
  const files = panel.querySelector('.mcf-files');
  let entries = [];
  let debounceTimer = null;

  function setStatus(text, kind) {
    status.textContent = text;
    status.dataset.kind = kind || '';
  }

  function filterNow(label) {
    try {
      entries = core.parseInputEntries(input.value);
      output.value = entries.map(entry => entry.code).join('\n');
      const urlCount = entries.filter(entry => entry.sourceUrl).length;
      const firstLine = input.value.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
      let structured = false;
      if (firstLine.includes('title') && firstLine.includes('url') && firstLine.includes('folder') && firstLine.includes('cover')) {
        try { structured = core.isRaindropCsv(core.parseCSV(input.value)); } catch {}
      }
      count.textContent = `${entries.length} 条 · 一行一个${structured ? ' · Raindrop 结构化过滤' : ''}`;
      setStatus(`${label || '已识别'}：${entries.length} 条${urlCount ? ` · ${urlCount} 条保留可信 MissAV 链接` : ''}`, entries.length ? 'done' : '');
      return entries;
    } catch (error) {
      entries = [];
      output.value = '';
      count.textContent = '0 条 · 一行一个';
      setStatus(`过滤失败：${error.message || error}`, 'error');
      return [];
    }
  }

  function scheduleFilter() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => filterNow('手动输入'), 120);
  }

  async function importFiles(fileList) {
    const selected = [...fileList];
    if (!selected.length) return;
    const results = await Promise.allSettled(selected.map(file => file.text()));
    const successful = [];
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') successful.push({ name: selected[index].name, text: result.value });
      else failed++;
    });
    if (!successful.length) {
      setStatus(`所选 ${selected.length} 个文件均读取失败`, 'error');
      files.value = '';
      return;
    }
    const merged = successful.map(item => item.text).join('\n\n');
    input.value = input.value.trimEnd() ? `${input.value.trimEnd()}\n\n${merged}` : merged;
    filterNow(successful.length === 1 ? successful[0].name : `${successful.length} 个文件${failed ? `（${failed} 个失败）` : ''}`);
    files.value = '';
  }

  async function copyResults() {
    filterNow('已识别');
    if (!output.value) { setStatus('没有可复制的番号', 'error'); return; }
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(output.value, 'text');
      else await navigator.clipboard.writeText(output.value);
      setStatus(`已复制 ${entries.length} 条`, 'done');
    } catch (error) { setStatus(`复制失败：${error.message || error}`, 'error'); }
  }

  function downloadResults() {
    filterNow('已识别');
    if (!output.value) { setStatus('没有可下载的番号', 'error'); return; }
    const now = new Date();
    const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), '_', String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')].join('');
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${stamp}_parsed_codes.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`已下载 ${entries.length} 条`, 'done');
  }

  function clearAll() {
    clearTimeout(debounceTimer);
    input.value = '';
    output.value = '';
    entries = [];
    count.textContent = '0 条 · 一行一个';
    setStatus('已清空', '');
  }

  function showPanel() { panel.style.display = 'block'; input.focus(); }
  function hidePanel() { panel.style.display = 'none'; }
  function togglePanel() { if (panel.style.display === 'none') showPanel(); else hidePanel(); }

  input.addEventListener('input', scheduleFilter);
  files.addEventListener('change', () => importFiles(files.files));
  panel.querySelector('.mcf-run').addEventListener('click', () => filterNow('已识别'));
  panel.querySelector('.mcf-copy').addEventListener('click', copyResults);
  panel.querySelector('.mcf-save').addEventListener('click', downloadResults);
  panel.querySelector('.mcf-clear').addEventListener('click', clearAll);
  panel.querySelector('.mcf-close').addEventListener('click', hidePanel);

  globalThis.__missavCodeFilter = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    filterText(text) {
      input.value = String(text || '');
      return filterNow('API 输入');
    },
    getEntries() { return entries.map(entry => ({ ...entry })); },
  };

  if (HAS_MENU_COMMAND) GM_registerMenuCommand('打开/隐藏 MissAV 番号过滤器', togglePanel);
  console.info('[MissAV Code Filter] ready', core.version);
})();
