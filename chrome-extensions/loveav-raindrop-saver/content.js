(function initLoveAVRaindropContent() {
  'use strict';

  const BUTTON_ID = 'loveav-raindrop-save-button';
  const TOAST_ID = 'loveav-raindrop-save-toast';
  const CORE = globalThis.LoveAVCore;
  const DETAIL_CONCURRENCY = 4;
  let saving = false;

  function siteForUrl(value = location.href) {
    const host = new URL(value, location.href).hostname.toLowerCase();
    if (host === 'missav.ai' || host.endsWith('.missav.ai') || host === 'missav.ws' || host.endsWith('.missav.ws')) return 'MissAV';
    if (host === '123av.com' || host.endsWith('.123av.com')) return '123AV';
    return '';
  }

  function textOf(element) {
    return CORE.cleanText(element?.textContent || element?.getAttribute?.('content') || '');
  }

  function titleFromDocument(doc) {
    const candidates = [
      ...doc.querySelectorAll('h1'),
      doc.querySelector('meta[property="og:title"]'),
      doc.querySelector('meta[name="twitter:title"]'),
    ].map(textOf).filter(Boolean);
    candidates.push(CORE.cleanText(doc.title).replace(/\s*[-|–]\s*(?:MissAV|123AV).*$/i, ''));
    return candidates.find((value) => CORE.extractCode(value)) || candidates[0] || '';
  }

  function canonicalFromDocument(doc, fallbackUrl) {
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const url = new URL(canonical || fallbackUrl, fallbackUrl);
    url.hash = '';
    return url.href;
  }

  function collectAnchorTexts(doc, pattern) {
    const seen = new Set();
    const result = [];
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      if (!pattern.test(href)) continue;
      const text = textOf(anchor);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
    }
    return result;
  }

  function isDetailUrl(value, site = siteForUrl(value)) {
    const url = new URL(value, location.href);
    if (site === 'MissAV') {
      return /\/(?:[a-z]{2}|dm\d+\/[^/]+)\/[a-z0-9][^/?#]*$/i.test(url.pathname)
        && Boolean(CORE.extractCode(decodeURIComponent(url.pathname)));
    }
    return site === '123AV' && /\/v\//i.test(url.pathname) && Boolean(CORE.extractCode(decodeURIComponent(url.pathname)));
  }

  function workFromDocument(doc, fallbackUrl, hint = {}) {
    const site = siteForUrl(fallbackUrl);
    if (!site || !isDetailUrl(fallbackUrl, site)) return null;
    const title = titleFromDocument(doc) || hint.title || '';
    const code = CORE.extractCode(title) || CORE.extractCode(decodeURIComponent(new URL(fallbackUrl).pathname)) || hint.code || '';
    if (!code) return null;
    const coverSource = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
      || '';
    let cover = '';
    try {
      if (coverSource) cover = new URL(coverSource, fallbackUrl).href;
    } catch {}
    return {
      site,
      code,
      title,
      url: canonicalFromDocument(doc, fallbackUrl),
      cover,
      actresses: collectAnchorTexts(doc, /\/(?:actress(?:es)?|actor(?:s)?)\//i),
      typeTags: collectAnchorTexts(doc, /\/(?:genres?|categor(?:y|ies))\//i),
      needsLookup: false,
    };
  }

  function currentDetailWork() {
    return workFromDocument(document, location.href);
  }

  function titleHintForAnchor(anchor, code) {
    const card = anchor.closest('.card, article, [class*="card"], [class*="video"], li');
    const values = [textOf(anchor), textOf(card)].filter(Boolean);
    return values.find((value) => CORE.extractCode(value) === code)
      || values.find((value) => CORE.extractCode(value))
      || code;
  }

  function listedWorks() {
    const site = siteForUrl();
    const output = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      let url;
      try {
        url = new URL(anchor.getAttribute('href'), location.href);
      } catch {
        continue;
      }
      url.hash = '';
      url.search = '';
      if (siteForUrl(url.href) !== site || !isDetailUrl(url.href, site)) continue;
      const code = CORE.extractCode(decodeURIComponent(url.pathname)) || CORE.extractCode(textOf(anchor));
      if (!code) continue;
      const key = url.href.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ site, code, title: titleHintForAnchor(anchor, code), url: url.href });
    }
    return output;
  }

  async function fetchDetailedWork(item) {
    try {
      const response = await fetch(item.url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return workFromDocument(doc, item.url, item) || { ...item, actresses: [], typeTags: [], cover: '', needsLookup: true };
    } catch {
      return { ...item, actresses: [], typeTags: [], cover: '', needsLookup: true };
    }
  }

  async function mapConcurrent(items, limit, mapper, onProgress) {
    const output = new Array(items.length);
    let next = 0;
    let completed = 0;
    async function worker() {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        output[index] = await mapper(items[index], index);
        completed += 1;
        onProgress?.(completed, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return output;
  }

  function toast(message, kind = 'info', persistent = false) {
    document.getElementById(TOAST_ID)?.remove();
    const element = document.createElement('div');
    element.id = TOAST_ID;
    element.textContent = message;
    Object.assign(element.style, {
      position: 'fixed', right: '22px', bottom: '146px', zIndex: '2147483647', maxWidth: '420px',
      padding: '11px 14px', borderRadius: '10px', color: '#fff', font: '14px/1.45 system-ui,sans-serif',
      background: kind === 'error' ? '#b42318' : kind === 'success' ? '#067647' : '#344054',
      boxShadow: '0 8px 24px rgba(0,0,0,.28)',
    });
    document.documentElement.append(element);
    if (!persistent) setTimeout(() => element.remove(), kind === 'error' ? 8000 : 5200);
    return element;
  }

  function buttonText() {
    const detail = currentDetailWork();
    if (detail) return `存到 Raindrop · ${detail.code}`;
    const count = listedWorks().length;
    return count ? `批量收藏本页 · ${count}` : '';
  }

  async function saveCurrent() {
    if (saving) return;
    const detail = currentDetailWork();
    const listed = detail ? [] : listedWorks();
    if (!detail && !listed.length) {
      toast('当前页面没有识别到可收藏的作品', 'error');
      return;
    }
    saving = true;
    const button = document.getElementById(BUTTON_ID);
    if (button) button.disabled = true;
    try {
      if (detail) {
        if (button) button.textContent = '保存中…';
        const response = await chrome.runtime.sendMessage({ type: 'loveav-save-work', work: detail });
        if (!response?.ok) throw new Error(response?.error || '保存失败');
        if (response.status === 'excluded') {
          toast(`未保存：命中 Raindrop 导出黑名单（${response.matches.join('、')}）`, 'error');
        } else if (response.status === 'exists') {
          toast(`${detail.code} 已经存在于 Raindrop`, 'success');
        } else toast(`${detail.code} 已保存到「${response.folder}」`, 'success');
      } else {
        const progress = toast(`准备解析 ${listed.length} 个作品…`, 'info', true);
        const works = await mapConcurrent(listed, DETAIL_CONCURRENCY, fetchDetailedWork, (done, total) => {
          progress.textContent = `正在解析作品详情：${done}/${total}`;
          if (button) button.textContent = `解析中 ${done}/${total}`;
        });
        progress.textContent = `正在查重、分类并批量写入 ${works.length} 个作品…`;
        if (button) button.textContent = '写入 Raindrop…';
        const response = await chrome.runtime.sendMessage({ type: 'loveav-save-works', works });
        if (!response?.ok) throw new Error(response?.error || '批量保存失败');
        const summary = `处理 ${response.total} 条：新增 ${response.created}，已存在 ${response.existing}，黑名单排除 ${response.excluded}`;
        toast(summary, response.errors?.length ? 'error' : 'success');
      }
    } catch (error) {
      toast(error.message || String(error), 'error');
    } finally {
      saving = false;
      if (button) {
        button.disabled = false;
        button.textContent = buttonText();
      }
    }
  }

  function syncButton() {
    const label = buttonText();
    const existing = document.getElementById(BUTTON_ID);
    if (!label) {
      existing?.remove();
      return;
    }
    if (existing) {
      if (!saving) existing.textContent = label;
      return;
    }
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = label;
    button.title = '按 LoveAV 5.13 规则直接收藏到 Raindrop';
    Object.assign(button.style, {
      position: 'fixed', right: '22px', bottom: '88px', zIndex: '2147483646', padding: '10px 15px',
      border: '0', borderRadius: '999px', color: '#fff', background: '#5b5bd6', cursor: 'pointer',
      font: '600 14px/1.2 system-ui,sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.28)',
    });
    button.addEventListener('click', saveCurrent);
    document.documentElement.append(button);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'loveav-save-current') return undefined;
    saveCurrent();
    return Promise.resolve({ accepted: true });
  });

  syncButton();
  new MutationObserver(() => {
    clearTimeout(syncButton.timer);
    syncButton.timer = setTimeout(syncButton, 350);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
