(function initLoveAVRaindropContent() {
  'use strict';

  const HOST_ID = 'loveav-raindrop-saver-host';
  const CORE = globalThis.LoveAVCore;
  const DETAIL_CONCURRENCY = 4;
  let saving = false;
  let cancelled = false;
  let ui = null;

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
    try {
      return Boolean(CORE.workCodeFromUrl(new URL(value, location.href).href, site));
    } catch {
      return false;
    }
  }

  function workFromDocument(doc, fallbackUrl, hint = {}) {
    const site = siteForUrl(fallbackUrl);
    if (!site || !isDetailUrl(fallbackUrl, site)) return null;
    const title = titleFromDocument(doc) || hint.title || '';
    const code = CORE.extractCode(title) || CORE.workCodeFromUrl(new URL(fallbackUrl).href, site) || hint.code || '';
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
      const code = CORE.workCodeFromUrl(url.href, site) || CORE.extractCode(textOf(anchor));
      if (!code) continue;
      const key = url.href.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ site, code, title: titleHintForAnchor(anchor, code), url: url.href });
    }
    return output;
  }

  async function fetchDetailedWork(item) {
    if (cancelled) return null;
    try {
      const response = await fetch(item.url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return workFromDocument(doc, item.url, item) || { ...item, actresses: [], typeTags: [], cover: '', needsLookup: true };
    } catch (error) {
      return { ...item, actresses: [], typeTags: [], cover: '', needsLookup: true, detailError: error.message || String(error) };
    }
  }

  async function mapConcurrent(items, limit, mapper, onProgress) {
    const output = new Array(items.length);
    let next = 0;
    let completed = 0;
    async function worker() {
      while (true) {
        if (cancelled) return;
        const index = next;
        next += 1;
        if (index >= items.length) return;
        output[index] = await mapper(items[index], index);
        completed += 1;
        onProgress?.(completed, items.length, items[index], output[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return output;
  }

  function addLog(message, kind = 'info') {
    if (!ui) return;
    const row = document.createElement('div');
    row.className = `log ${kind}`;
    row.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`;
    ui.logs.append(row);
    while (ui.logs.children.length > 250) ui.logs.firstElementChild.remove();
    ui.logs.scrollTop = ui.logs.scrollHeight;
  }

  function setPhase(message, kind = 'info') {
    if (!ui) return;
    ui.phase.textContent = message;
    ui.phase.dataset.kind = kind;
  }

  function setProgress(done, total) {
    if (!ui) return;
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeDone = Math.min(safeTotal, Math.max(0, Number(done) || 0));
    ui.progress.value = safeTotal ? safeDone / safeTotal * 100 : 0;
    ui.progressText.textContent = safeTotal ? `${safeDone}/${safeTotal}` : '—';
  }

  function setStats(values = {}) {
    if (!ui) return;
    for (const [key, value] of Object.entries(values)) {
      if (ui.stats[key]) ui.stats[key].textContent = String(value);
    }
  }

  function buttonText() {
    const detail = currentDetailWork();
    if (detail) return `存到 Raindrop · ${detail.code}`;
    const count = listedWorks().length;
    return count ? `批量收藏本页 · ${count}` : '未识别到作品';
  }

  function openPanel() {
    ensureUi();
    ui.panel.hidden = false;
    ui.launcher.hidden = true;
    syncUi();
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.hidden = true;
    ui.launcher.hidden = false;
  }

  async function saveCurrent() {
    if (saving) return;
    const detail = currentDetailWork();
    const listed = detail ? [] : listedWorks();
    if (!detail && !listed.length) {
      openPanel();
      setPhase('当前页面没有识别到可收藏的作品', 'error');
      addLog('请等页面加载完成后点“刷新识别”', 'error');
      return;
    }
    saving = true;
    cancelled = false;
    openPanel();
    ui.action.disabled = true;
    ui.stop.disabled = false;
    ui.logs.textContent = '';
    setStats({ total: detail ? 1 : listed.length, parsed: 0, created: 0, existing: 0, excluded: 0, failed: 0 });
    try {
      if (detail) {
        setPhase(`正在查重、分类并保存 ${detail.code}…`);
        setProgress(0, 1);
        addLog(`已识别当前作品：${detail.code}`);
        const response = await chrome.runtime.sendMessage({ type: 'loveav-save-work', work: detail });
        if (!response?.ok) throw new Error(response?.error || '保存失败');
        setStats({ parsed: 1, [response.status === 'created' ? 'created' : response.status === 'exists' ? 'existing' : 'excluded']: 1 });
        setProgress(1, 1);
        if (response.status === 'excluded') {
          setPhase('处理完成：已按黑名单排除', 'warn');
          addLog(`${detail.code} 黑名单排除：${response.matches.join('、')}`, 'warn');
        } else if (response.status === 'exists') {
          setPhase('处理完成：Raindrop 中已存在', 'success');
          addLog(`${detail.code} 已存在，未重复写入`, 'success');
        } else {
          setPhase(`处理完成：已保存到「${response.folder}」`, 'success');
          addLog(`${detail.code} 新增到「${response.folder}」`, 'success');
        }
      } else {
        setPhase(`正在解析 ${listed.length} 个作品详情…`);
        setProgress(0, listed.length);
        addLog(`已从当前页面识别 ${listed.length} 个唯一作品`);
        const works = await mapConcurrent(listed, DETAIL_CONCURRENCY, fetchDetailedWork, (done, total, item, result) => {
          setProgress(done, total);
          setStats({ parsed: done });
          setPhase(`正在解析作品详情：${done}/${total}`);
          addLog(`${item.code} ${result?.detailError ? '详情读取失败，将进入需要查找' : '详情读取完成'}`, result?.detailError ? 'warn' : 'info');
        });
        if (cancelled) {
          setPhase('已停止，未执行 Raindrop 写入', 'warn');
          addLog('用户停止了本次处理', 'warn');
          return;
        }
        const completedWorks = works.filter(Boolean);
        setPhase(`正在查重、分类并批量写入 ${completedWorks.length} 个作品…`);
        addLog('开始执行 LoveAV 5.13 分类、黑名单和 Raindrop 查重');
        const response = await chrome.runtime.sendMessage({ type: 'loveav-save-works', works: completedWorks });
        if (!response?.ok) throw new Error(response?.error || '批量保存失败');
        setStats(response);
        for (const item of response.details || []) {
          const labels = { created: '已新增', exists: '已存在', excluded: '黑名单排除', failed: '失败' };
          const suffix = item.matches?.length ? `：${item.matches.join('、')}` : item.folder ? ` → ${item.folder}` : item.error ? `：${item.error}` : '';
          addLog(`${item.code} ${labels[item.status] || item.status}${suffix}`, item.status === 'created' || item.status === 'exists' ? 'success' : item.status === 'failed' ? 'error' : 'warn');
        }
        const summary = `完成 ${response.total} 条：新增 ${response.created}，已存在 ${response.existing}，黑名单排除 ${response.excluded}，失败 ${response.failed}`;
        setPhase(summary, response.failed ? 'error' : 'success');
      }
    } catch (error) {
      setPhase(error.message || String(error), 'error');
      addLog(error.message || String(error), 'error');
    } finally {
      saving = false;
      if (ui) ui.stop.disabled = true;
      syncUi();
    }
  }

  function ensureUi() {
    if (ui?.host?.isConnected) return ui;
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      document.documentElement.append(host);
    }
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0 auto auto 0', 'important');
    host.style.setProperty('width', '0', 'important');
    host.style.setProperty('height', '0', 'important');
    host.style.setProperty('overflow', 'visible', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}button{font:inherit}.launcher,.panel{pointer-events:auto}.launcher{position:fixed;left:18px;bottom:18px;z-index:2147483647;border:1px solid #8b7cf6;border-radius:999px;padding:11px 16px;background:#5b4fcf;color:#fff;font:700 14px/1.2 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 10px 30px #0006;cursor:pointer}.launcher[hidden],.panel[hidden]{display:none!important}.panel{position:fixed;left:18px;bottom:18px;z-index:2147483647;width:min(460px,calc(100vw - 36px));max-height:min(720px,calc(100vh - 36px));overflow:hidden;border:1px solid #475569;border-radius:15px;background:#0f172af2;color:#e5e7eb;box-shadow:0 18px 55px #0009;font:13px/1.45 system-ui,"Microsoft YaHei",sans-serif}.head{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid #334155}.title{font-size:16px;font-weight:800}.sub{color:#94a3b8;font-size:12px}.close{border:0;background:transparent;color:#cbd5e1;font-size:22px;cursor:pointer}.body{padding:13px;overflow:auto;max-height:calc(min(720px,100vh - 36px) - 54px)}.phase{margin-bottom:10px;padding:9px 10px;border-radius:8px;background:#1e293b;color:#dbeafe}.phase[data-kind="success"]{background:#064e3b;color:#d1fae5}.phase[data-kind="warn"]{background:#713f12;color:#fef3c7}.phase[data-kind="error"]{background:#7f1d1d;color:#fee2e2}.actions{display:flex;gap:8px;margin:10px 0}.primary,.secondary{border:0;border-radius:8px;padding:9px 12px;color:#fff;cursor:pointer}.primary{flex:1;background:#4f46e5;font-weight:700}.secondary{background:#475569}.stop{background:#b91c1c}.primary:disabled,.secondary:disabled{opacity:.45;cursor:not-allowed}.barrow{display:flex;align-items:center;gap:9px;margin:8px 0}.barrow progress{width:100%;height:10px;accent-color:#7c6df2}.progress-text{min-width:50px;text-align:right;color:#cbd5e1}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:10px 0}.stat{padding:7px;border:1px solid #334155;border-radius:8px;background:#172033;text-align:center}.stat b{display:block;font-size:16px;color:#fff}.stat span{color:#94a3b8;font-size:11px}.logs{height:230px;overflow:auto;border:1px solid #334155;border-radius:8px;background:#080f1e;padding:8px;font:12px/1.45 Consolas,"Microsoft YaHei",monospace}.log{padding:3px 0;border-bottom:1px solid #1e293b;color:#cbd5e1}.log.success{color:#86efac}.log.warn{color:#fde68a}.log.error{color:#fca5a5}.ready{margin-top:8px;color:#94a3b8;font-size:12px}
      </style>
      <button class="launcher" type="button" title="打开 LoveAV 一键收藏面板">♥ LoveAV 收藏</button>
      <section class="panel" hidden>
        <div class="head"><div><div class="title">LoveAV → Raindrop</div><div class="sub"></div></div><button class="close" type="button" title="收起">×</button></div>
        <div class="body">
          <div class="phase" data-kind="info">正在识别当前页面…</div>
          <div class="actions"><button class="primary action" type="button"></button><button class="secondary refresh" type="button">刷新识别</button><button class="secondary stop" type="button" disabled>停止</button></div>
          <div class="barrow"><progress max="100" value="0"></progress><span class="progress-text">—</span></div>
          <div class="stats">
            <div class="stat"><b data-stat="total">0</b><span>识别</span></div><div class="stat"><b data-stat="parsed">0</b><span>已解析</span></div><div class="stat"><b data-stat="created">0</b><span>新增</span></div>
            <div class="stat"><b data-stat="existing">0</b><span>已存在</span></div><div class="stat"><b data-stat="excluded">0</b><span>排除</span></div><div class="stat"><b data-stat="failed">0</b><span>失败</span></div>
          </div>
          <div class="logs"><div class="log">面板已就绪，点击上方按钮开始。</div></div>
          <div class="ready">本页仅保存派生分类结果；不会上传 LoveAV 主体库和规则文件。</div>
        </div>
      </section>`;
    const find = (selector) => shadow.querySelector(selector);
    ui = {
      host, shadow, launcher: find('.launcher'), panel: find('.panel'), action: find('.action'), refresh: find('.refresh'),
      stop: find('.stop'), close: find('.close'), phase: find('.phase'), progress: find('progress'),
      progressText: find('.progress-text'), logs: find('.logs'), sub: find('.sub'), stats: {},
    };
    for (const element of shadow.querySelectorAll('[data-stat]')) ui.stats[element.dataset.stat] = element;
    ui.launcher.addEventListener('click', openPanel);
    ui.close.addEventListener('click', closePanel);
    ui.action.addEventListener('click', saveCurrent);
    ui.refresh.addEventListener('click', () => { syncUi(); addLog('已手动刷新页面识别结果'); });
    ui.stop.addEventListener('click', () => { cancelled = true; ui.stop.disabled = true; setPhase('正在停止；已发出的 Raindrop 请求不会强行中断', 'warn'); });
    return ui;
  }

  function syncUi() {
    ensureUi();
    const detail = currentDetailWork();
    const count = detail ? 1 : listedWorks().length;
    ui.sub.textContent = `${siteForUrl()} · 已识别 ${count} 个作品`;
    if (!saving) {
      ui.action.textContent = buttonText();
      ui.action.disabled = count === 0;
      setStats({ total: count });
      if (ui.phase.textContent === '正在识别当前页面…') {
        setPhase(count ? `已就绪：${detail ? `当前作品 ${detail.code}` : `当前页面 ${count} 个作品`}` : '页面已加载，暂未识别到作品', count ? 'success' : 'warn');
      }
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'loveav-save-current') return undefined;
    openPanel();
    saveCurrent();
    return Promise.resolve({ accepted: true });
  });

  syncUi();
  new MutationObserver(() => {
    clearTimeout(syncUi.timer);
    syncUi.timer = setTimeout(syncUi, 350);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
