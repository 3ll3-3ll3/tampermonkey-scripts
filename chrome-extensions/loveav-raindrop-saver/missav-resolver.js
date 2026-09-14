(function initLoveAVMissAVResolver(global, factory) {
  const api = factory(global.MissAVCodeFilterCore, global.LoveAVCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.LoveAVMissAVResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildResolver(FILTER, CORE) {
  'use strict';

  const DELAY_MS = 900;
  const CANDIDATE_DELAY_MS = 250;
  const MAX_RETRY = 1;

  function normalizeCode(value) {
    if (FILTER?.normalizeCode) return FILTER.normalizeCode(value);
    return CORE?.normalizeCode ? CORE.normalizeCode(value) : String(value || '').trim().toUpperCase();
  }

  function extractFC2Number(value) {
    return String(value || '').toUpperCase().match(/FC2[-_\s]*(?:PPV[-_\s]*)?(\d+)/i)?.[1] || '';
  }

  function codeVariants(value) {
    const code = normalizeCode(value);
    const variants = new Set([code, code.replace(/-/g, '')]);
    if (code.startsWith('FC2-PPV-')) {
      const number = extractFC2Number(code);
      variants.add(`FC2-${number}`);
      variants.add(`FC2PPV${number}`);
      variants.add(`FC2PPV-${number}`);
    }
    return [...variants].map((item) => item.toUpperCase()).filter(Boolean);
  }

  function candidateUrls(value, origin = 'https://missav.ai') {
    const code = normalizeCode(value);
    const base = String(origin || 'https://missav.ai').replace(/\/$/, '');
    if (code.startsWith('FC2-PPV-')) {
      const number = extractFC2Number(code);
      return [
        `${base}/cn/fc2-ppv-${number}`,
        `${base}/cn/fc2-ppv-${number}-chinese-subtitle`,
        `${base}/cn/fc2-ppv-${number}-uncensored-leak`,
        `${base}/dm96/cn/FC2-${number}`,
        `${base}/dm96/cn/FC2-PPV-${number}`,
      ];
    }
    const slug = code.toLowerCase();
    return [
      `${base}/cn/${slug}`,
      `${base}/cn/${slug}-chinese-subtitle`,
      `${base}/cn/${slug}-uncensored-leak`,
      `${base}/dm96/cn/${code}`,
    ];
  }

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isBadActressName(value) {
    const text = cleanText(value);
    return !text
      || /女优排行|女優排行|actress ranking|ranking/i.test(text)
      || /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*20\d{2}\b/i.test(text)
      || /今日热门|本週热门|本周热门|本月热门|最近更新|新作上市|中文字幕|无码流出|更多|收藏|登录|注册/i.test(text)
      || /MissAV|DM\d+|^\d+$/i.test(text);
  }

  function isBadTypeTag(value) {
    const text = cleanText(value);
    const tag = CORE?.cleanRaindropTag ? CORE.cleanRaindropTag(text) : text;
    return !text || !tag
      || /女优|女優|男优|男優|系列|发行商|發行商|导演|導演|标签|標籤|片商|收藏|登录|注册|更多|首页|首頁/i.test(text)
      || /官方.*电报|官方.*電報|电报群|電報群|Telegram|TG群|群|无广告|無廣告|免费漫画|免費漫畫|漫画|漫畫/i.test(text)
      || /AI[_\s-]*Jerk|Jerk[_\s-]*Off|亚博|亞博|赌场|賭場|世界杯|博彩|投注|VPN|性价王|性價王/i.test(text)
      || /色色主播|主播|直播|约炮|約炮|交友|下载|下載|磁力|种子|種子|网盘|網盤|云盘|雲盤|torrent|magnet/i.test(text)
      || /MissAV|DM\d+|^\d+$/i.test(text)
      || /_/.test(tag)
      || /[a-z]{2,}\d{2,}/i.test(text)
      || /https?:\/\//i.test(text)
      || /\.[a-z]{2,}/i.test(text);
  }

  function pageContainsCode(pageHtml, code) {
    const compact = String(pageHtml || '').toUpperCase().replace(/[_\s]/g, '-');
    const loose = compact.replace(/-/g, '');
    return codeVariants(code).some((variant) => compact.includes(variant) || loose.includes(variant.replace(/-/g, '')));
  }

  function pageLooksPlayable(pageHtml) {
    return /<video|m3u8|plyr|player|iframe|播放|play/i.test(String(pageHtml || ''));
  }

  function pageLooksChallenged(pageHtml) {
    return /cf-chl-|cloudflare|captcha|verify you are human|checking your browser|访问验证|安全验证/i.test(String(pageHtml || ''));
  }

  function extractActresses(doc) {
    const output = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      const text = cleanText(anchor.textContent || '');
      if (!/\/actresses?\//i.test(href) || /\/actors?\//i.test(href) || isBadActressName(text)) continue;
      const key = `${text}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(text);
    }
    return output;
  }

  function extractTypeTags(doc) {
    const output = [];

    function addTypeTag(value) {
      const text = cleanText(value);
      if (!text || isBadTypeTag(text)) return;
      const tag = CORE?.cleanRaindropTag ? CORE.cleanRaindropTag(text) : text;
      if (tag && !output.includes(tag)) output.push(tag);
    }

    function isTypeLabelText(value) {
      return /^(类型|類型|类别|類別)[:：]?$/.test(cleanText(value).replace(/\s/g, ''));
    }

    function genreAnchors(container) {
      if (!container) return [];
      return [...container.querySelectorAll('a[href]')].filter((anchor) => {
        const href = anchor.getAttribute('href') || '';
        const text = cleanText(anchor.textContent || '');
        return text && !isBadTypeTag(text) && /\/genres?\//i.test(href);
      });
    }

    for (const node of doc.querySelectorAll('div, span, p, li, dt, dd')) {
      const ownText = cleanText(node.childNodes.length === 1 ? node.textContent : '');
      if (!isTypeLabelText(ownText)) continue;
      let current = node;
      for (let depth = 0; depth < 5 && current; depth += 1) {
        for (const anchor of genreAnchors(current.parentElement)) addTypeTag(anchor.textContent || '');
        if (output.length) break;
        current = current.parentElement;
      }
      if (output.length) break;
    }

    if (!output.length) {
      for (const block of doc.querySelectorAll('div, p, li, section')) {
        const text = cleanText(block.textContent || '');
        if (!text || text.length > 180 || !/(类型|類型|类别|類別)\s*[：:]/i.test(text)) continue;
        for (const anchor of genreAnchors(block)) addTypeTag(anchor.textContent || '');
        if (output.length) break;
      }
    }
    return output;
  }

  function documentTitle(doc, code) {
    const values = [
      ...doc.querySelectorAll('h1'),
      doc.querySelector('meta[property="og:title"]'),
      doc.querySelector('meta[name="twitter:title"]'),
    ].map((element) => cleanText(element?.textContent || element?.getAttribute?.('content') || '')).filter(Boolean);
    values.push(cleanText(doc.title).replace(/\s*[-|–]\s*MissAV.*$/i, ''));
    return values.find((value) => pageContainsCode(value, code)) || values[0] || code;
  }

  function documentCover(doc, pageUrl) {
    const source = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || '';
    try { return source ? new URL(source, pageUrl).href : ''; } catch { return ''; }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function transientStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  async function fetchText(url, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    let lastError;
    for (let attempt = 0; attempt <= (options.maxRetry ?? MAX_RETRY); attempt += 1) {
      try {
        const response = await fetchImpl(url, { credentials: 'include', signal: options.signal });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          if (!transientStatus(response.status)) throw error;
          lastError = error;
        } else return await response.text();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
        if (Number(error?.status) >= 400 && !transientStatus(Number(error.status))) throw error;
      }
      if (attempt < (options.maxRetry ?? MAX_RETRY)) await sleep(options.retryDelayMs ?? 1000);
    }
    throw lastError || new Error('网络读取失败');
  }

  async function resolveWork(value, options = {}) {
    const code = normalizeCode(value);
    const urls = candidateUrls(code, options.origin);
    let lastError = '';
    let lastStatus = 0;
    let challenged = false;
    let rateLimited = false;
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      options.onAttempt?.({ code, url, index: index + 1, total: urls.length });
      try {
        const html = await fetchText(url, options);
        if (pageLooksChallenged(html)) {
          challenged = true;
          lastError = '页面要求访问验证';
          if (index < urls.length - 1) await sleep(options.candidateDelayMs ?? CANDIDATE_DELAY_MS);
          continue;
        }
        const hasCode = pageContainsCode(html, code);
        if (!hasCode) {
          lastError = '页面内容与番号不匹配';
        } else {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const actresses = extractActresses(doc);
          const typeTags = extractTypeTags(doc);
          const playable = pageLooksPlayable(html);
          const status = actresses.length
            ? (playable ? 'ok' : 'page_ok_play_unknown')
            : (playable ? 'no_actress_found' : 'need_manual_check');
          return {
            site: 'MissAV', code, url, status,
            title: documentTitle(doc, code),
            cover: documentCover(doc, url),
            actresses, typeTags,
            needsLookup: status === 'need_manual_check',
          };
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastStatus = Number(error?.status) || 0;
        if (lastStatus === 401 || lastStatus === 403) challenged = true;
        if (lastStatus === 429) rateLimited = true;
        lastError = error?.message || String(error);
      }
      if (index < urls.length - 1) await sleep(options.candidateDelayMs ?? CANDIDATE_DELAY_MS);
    }
    const status = rateLimited ? 'rate_limited' : challenged ? 'access_challenge' : lastStatus && lastStatus !== 404 ? 'network_error' : 'not_found';
    return {
      site: 'MissAV', code, url: urls[0], title: code, cover: '', actresses: [], typeTags: [],
      status, needsLookup: true, error: lastError || '全部候选地址均未匹配',
    };
  }

  return {
    DELAY_MS,
    CANDIDATE_DELAY_MS,
    normalizeCode,
    codeVariants,
    candidateUrls,
    pageContainsCode,
    pageLooksPlayable,
    pageLooksChallenged,
    resolveWork,
  };
});
