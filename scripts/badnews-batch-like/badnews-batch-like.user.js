// ==UserScript==
// @name         Bad.news 批量点赞工具
// @namespace    https://github.com/3ll3-3ll3/tampermonkey-scripts
// @version      1.2.1
// @description  手动批量点赞正文或排行榜；正文支持当前页、连续页、自定义页码范围、全部页与奇偶页筛选。
// @match        https://bad.news/*
// @match        https://www.bad.news/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/badnews-batch-like/badnews-batch-like.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/badnews-batch-like/badnews-batch-like.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('badnews-batch-like')) return;
  const host = document.createElement('div');
  host.id = 'badnews-batch-like';
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font:14px/1.5 system-ui;color:#edf3ff}*{box-sizing:border-box}[hidden]{display:none!important}
    button,select,input{font:inherit;color:inherit;background:#26364c;border:1px solid #50627c;border-radius:7px;padding:8px;cursor:pointer}
    button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #6caeff}
    .panel{width:min(390px,calc(100vw - 40px));max-height:80vh;overflow:auto;background:#101c2e;border:1px solid #5d7290;border-radius:12px;padding:14px;box-shadow:0 6px 30px #0008}
    header{display:flex;justify-content:space-between;align-items:center}h2{font-size:17px;margin:0}p{margin:10px 0}
    label{display:block;margin:10px 0}select{width:100%}input{width:100px}.range{width:100%}.page-options{border:1px solid #50627c;border-radius:8px;padding:10px;margin:10px 0}.preview{color:#b4d7ff;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap}
    .start{background:#245cc4}.stop{background:#853333}.note{color:#afc1da;font-size:12px}.log{max-height:180px;overflow:auto;font-size:12px;overflow-wrap:anywhere}
    .log div{padding:4px 0;border-top:1px solid #293b51}progress{width:100%}
  </style><button class="launcher">批量点赞</button><section class="panel" hidden>
    <header><h2>Bad.news 批量点赞</h2><button class="close" aria-label="收起">×</button></header>
    <p class="note">点赞会提交到当前网站账号，可能影响公开评分。不是 Raindrop 收藏。正文可像打印文档一样选择页码范围，排行榜仅当前页。</p>
    <label>处理范围<select class="scope"><option value="main">正文作品</option><option value="rank">右侧排行榜</option><option value="all">正文 + 排行榜</option></select></label>
    <label>每次间隔 <input class="delay" type="number" min="250" max="60000" step="50" value="1000"> 毫秒</label>
    <div class="page-options"><label>正文页码范围<select class="page-mode"><option value="current">当前页</option><option value="continuous">从当前页连续处理</option><option value="custom">自定义页码 / 页码范围</option><option value="all">全部页（需识别末页）</option></select></label>
    <label class="continuous-field" hidden>连续处理 <input class="pages" type="number" min="1" max="1000" step="1" value="1"> 页（含当前页）</label>
    <label class="custom-field" hidden>页码 <input class="range" type="text" placeholder="例如：1-3,5,8-10" aria-label="自定义页码"></label>
    <label>页码筛选<select class="parity"><option value="all">所选范围内全部页</option><option value="odd">仅奇数页</option><option value="even">仅偶数页</option></select></label>
    <p class="preview" role="status"></p></div>
    <p class="note">自定义使用网站实际页码；支持中文逗号，重复页自动去重并升序执行。只沿页面已有分页链接跳转，途经未选中的页不点赞。跨页期间请勿手动刷新。</p>
    <p class="count"></p><div class="actions"><button class="refresh">刷新识别</button><button class="start">开始点赞</button><button class="stop" disabled>停止</button></div>
    <progress max="1" value="0"></progress><p class="status" role="status">等待手动启动</p><div class="log" role="log"></div>
    <p class="note">跳过已点赞；状态未知时不点击。结果仅按网页按钮状态确认，不代表服务器持久化校验。结果不明后请刷新页面核对，不自动重试。</p>
  </section>`;
  document.documentElement.append(host);
  const $ = s => shadow.querySelector(s);
  let running = false, stopped = false;
  const HANDOFF_KEY = 'badnews-batch-like-handoff-v2';
  const safeUrl = value => { const url = new URL(value, location.href); url.hash = ''; return url.href; };
  function listingKey(value) {
    const url = new URL(value, location.href);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/page(?:\/|-)\d+\/?$/, '').replace(/\/$/, '') || '/';
    for (const key of ['page', 'p']) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  }
  function nextPage() {
    const links = [...document.querySelectorAll('a[href]')].filter(a => {
      const label = [a.textContent, a.getAttribute('aria-label'), a.getAttribute('title')].filter(Boolean).map(s => s.trim());
      return visible(a) && !a.closest('.side,[id^="top-content-"],.disabled,[aria-disabled="true"]') &&
        (a.relList.contains('next') || a.matches('.pagination .next a,.pager .next a,a.next,a.next-page') ||
          label.some(s => /^(?:下一[页頁]|下[页頁]|下一[页頁]\s*[›»>→]+|next(?:\s+page)?(?:\s*[›»>→]+)?)$/i.test(s)));
    });
    const urls = [...new Set(links.map(a => {
      try {
        const url = new URL(a.getAttribute('href'), location.href);
        return url.protocol === 'https:' && url.origin === location.origin && !url.username && !url.password &&
          listingKey(url.href) === listingKey(location.href) && safeUrl(url.href) !== safeUrl(location.href) ? safeUrl(url.href) : '';
      } catch { return ''; }
    }).filter(Boolean))];
    if (urls.length > 1) throw Error('发现多个不同的下一页链接，已停止，请手动确认');
    return urls[0] || '';
  }
  function pageNumber(value = location.href) {
    const url = new URL(value, location.href);
    const values = [url.searchParams.get('page'), url.searchParams.get('p'), url.pathname.match(/\/page(?:\/|-)(\d+)\/?$/)?.[1]].filter(v => v !== null && v !== undefined);
    if (!values.length) return 1;
    if (values.some(v => !/^\d+$/.test(v)) || new Set(values.map(Number)).size !== 1) throw Error('无法确认网站页码，请先打开带明确页码的页面');
    return Number(values[0]);
  }
  function paginationLinks() {
    return [...document.querySelectorAll('a[href]')].filter(a => visible(a) && !a.closest('.side,[id^="top-content-"],.disabled,[aria-disabled="true"]')).map(a => {
      try {
        const url = new URL(a.getAttribute('href'), location.href);
        const label = (a.textContent || '').trim();
        const labeled = a.closest('.pagination,.pager') || ['next','prev','first','last'].some(rel => a.relList.contains(rel)) || /^(?:\d+|首页|末页|尾页|上一[页頁]|下一[页頁]|first|last|next|previous)(?:\s*[›»>→«‹<←]*)$/i.test(label);
        if (!labeled || url.origin !== location.origin || url.protocol !== 'https:' || url.username || url.password || listingKey(url.href) !== listingKey(location.href)) return null;
        return { url: safeUrl(url.href), page: pageNumber(url.href), last: a.relList.contains('last') || a.matches('.last-page') || /^(?:末页|尾页|末頁|尾頁|last(?: page)?)$/i.test(label) };
      } catch { return null; }
    }).filter(Boolean);
  }
  function parseRange(input) {
    const normalized = input.trim().replace(/[，、；;]/g, ',').replace(/[–—－]/g, '-');
    if (!normalized) throw Error('请输入页码，例如 1-3,5,8-10');
    const pages = new Set();
    for (const part of normalized.split(',')) {
      const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!match) throw Error('页码格式不正确，请使用 1-3,5,8-10');
      const start = Number(match[1]), end = Number(match[2] || match[1]);
      if (start < 1 || end > 1000 || start > end) throw Error('页码应为 1–1000，范围起点不能大于终点');
      for (let n = start; n <= end; n++) pages.add(n);
    }
    return [...pages].sort((a,b) => a-b);
  }
  function makePlan() {
    const current = pageNumber();
    if ($('.scope').value !== 'main') return [current];
    const mode = $('.page-mode').value;
    let pages;
    if (mode === 'current') pages = [current];
    else if (mode === 'custom') pages = parseRange($('.range').value);
    else if (mode === 'continuous') {
      const count = Number($('.pages').value);
      if (!Number.isInteger(count) || count < 1 || current + count - 1 > 1000) throw Error('连续页数必须是正整数，末页不能超过 1000');
      pages = Array.from({length: count}, (_,i) => current+i);
    } else {
      const ends = [...new Set(paginationLinks().filter(link => link.last).map(link => link.page))];
      if (ends.length !== 1 || ends[0] < current || ends[0] > 1000) throw Error('未识别到明确末页，请使用自定义范围或连续处理');
      pages = Array.from({length: ends[0]}, (_,i) => i+1);
    }
    const parity = $('.parity').value;
    pages = pages.filter(n => parity === 'all' || n % 2 === (parity === 'odd' ? 1 : 0));
    if (!pages.length) throw Error('筛选后没有页码，请调整范围或奇偶页选项');
    return pages;
  }
  function summarize(pages) {
    const groups = [];
    for (let i = 0; i < pages.length; i++) {
      const start = pages[i];
      while (i+1 < pages.length && pages[i+1] === pages[i]+1) i++;
      groups.push(start === pages[i] ? String(start) : `${start}-${pages[i]}`);
    }
    return groups.slice(0,20).join(', ') + (groups.length > 20 ? ' …' : '');
  }
  function routeTo(target) {
    const links = paginationLinks(), current = pageNumber();
    const direct = [...new Set(links.filter(link => link.page === target).map(link => link.url))];
    if (direct.length === 1) return direct[0];
    if (direct.length > 1) throw Error(`第 ${target} 页链接不唯一，已停止`);
    if (target > current) {
      const next = nextPage();
      if (next && pageNumber(next) <= target) return next;
    } else {
      const prior = links.filter(link => link.page < current && link.page >= target).sort((a,b) => a.page-b.page);
      if (prior.length) return prior[0].url;
    }
    throw Error(`找不到前往第 ${target} 页的安全分页链接，已停止；请先手动打开该页`);
  }
  function clearHandoff() { try { sessionStorage.removeItem(HANDOFF_KEY); } catch {} }
  function readHandoff() {
    let job;
    try { job = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null'); } catch {}
    clearHandoff(); // Consume once: reloading a running page never resumes it.
    if (!job) return null;
    if (job.expected !== safeUrl(location.href) || !Number.isFinite(job.expires) || job.expires < Date.now() || job.expires > Date.now() + 120000 ||
      !Array.isArray(job.targets) || !job.targets.length || job.targets.length > 1000 || !job.targets.every((n,i) => Number.isInteger(n) && n >= 1 && n <= 1000 && (!i || n > job.targets[i-1])) ||
      !Number.isInteger(job.done) || job.done < 0 || job.done >= job.targets.length ||
      !Number.isFinite(job.delay) || job.delay < 250 || job.delay > 60000 ||
      !Array.isArray(job.seen) || !job.seen.every(id => /^\d+$/.test(id)) ||
      !Array.isArray(job.visited) || !job.visited.length || job.visited.length > 2000 ||
      !job.visited.every(url => listingKey(url) === listingKey(location.href)) ||
      !Number.isInteger(job.confirmed) || job.confirmed < 0 || !Number.isInteger(job.skipped) || job.skipped < 0) return null;
    return job;
  }
  const attempted = new Set();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const containers = () => [...document.querySelectorAll('.midcol[data-tid]')].filter(el => /^\d+$/.test(el.dataset.tid));
  const isRank = el => Boolean(el.closest('.side, [id^="top-content-"]'));
  const up = el => el.querySelector('i.fa-thumbs-o-up[onclick],i.fa-thumbs-up[onclick]');
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  // Ranking vote icons may only appear on hover; the visible row is the scope.
  const inScope = el => visible(el) || (isRank(el) && visible(el.closest('.relatedlist') || el));
  function state(el) {
    const button = up(el);
    if (!button) return 'unknown';
    // login-required is a handler hook, not proof of the current account state.
    if (el.classList.contains('likes') || button.classList.contains('fa-thumbs-up')) return 'liked';
    if (button.classList.contains('fa-thumbs-o-up') && !el.classList.contains('dislikes') && !el.querySelector('.fa-thumbs-down')) return 'unliked';
    return 'unknown';
  }
  function loggedOut() {
    return [...document.querySelectorAll('a[href]')].some(a => {
      try { const u = new URL(a.getAttribute('href'), location.href); return u.origin === location.origin && u.pathname === '/login' && visible(a); } catch { return false; }
    });
  }
  function discover() {
    const mode = $('.scope').value, found = new Map();
    for (const el of containers()) {
      if (mode === 'main' && isRank(el) || mode === 'rank' && !isRank(el)) continue;
      if (!inScope(el)) continue;
      if (!found.has(el.dataset.tid)) found.set(el.dataset.tid, []);
      found.get(el.dataset.tid).push(el);
    }
    return [...found].map(([id, nodes]) => ({ id, nodes }));
  }
  function currentState(id) {
    const nodes = containers().filter(el => el.dataset.tid === id);
    const states = nodes.map(state);
    // Any duplicate showing a positive state prevents toggling the work off.
    if (states.includes('liked')) return 'liked';
    return states.includes('unliked') ? 'unliked' : 'unknown';
  }
  function log(message) {
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    $('.log').append(line);
    while ($('.log').children.length > 200) $('.log').firstChild.remove();
    $('.log').scrollTop = $('.log').scrollHeight;
  }
  function updatePageUi() {
    const main = $('.scope').value === 'main';
    const mode = $('.page-mode').value;
    $('.page-options').hidden = !main;
    $('.continuous-field').hidden = mode !== 'continuous';
    $('.custom-field').hidden = mode !== 'custom';
    if (!main) return { plan: [pageNumber()], error: '' };
    try {
      const plan = makePlan();
      $('.preview').textContent = `将处理 ${plan.length} 页：${summarize(plan)}（当前网站第 ${pageNumber()} 页）`;
      return { plan, error: '' };
    } catch (error) {
      $('.preview').textContent = `无法开始：${error.message}`;
      return { plan: [], error: error.message };
    }
  }
  function refresh() {
    const items = discover();
    const liked = items.filter(item => currentState(item.id) === 'liked').length;
    const ready = items.filter(item => currentState(item.id) === 'unliked' && !attempted.has(item.id)).length;
    const unknown = items.filter(item => currentState(item.id) === 'unknown').length;
    const pending = items.filter(item => currentState(item.id) !== 'liked' && attempted.has(item.id)).length;
    const reason = !items.length ? '；没有找到当前显示的条目，请等待排行榜加载后刷新识别'
      : !ready ? `；${unknown ? '有未知状态，不能安全点赞' : pending ? '已尝试项需要刷新页面核对' : '当前范围已全部点赞'}` : '';
    $('.count').textContent = `识别 ${items.length} 项 · 已点赞 ${liked} · 可处理 ${ready} · 未知 ${unknown}${reason}`;
    const { plan, error } = updatePageUi();
    const main = $('.scope').value === 'main';
    const current = pageNumber();
    const hasOtherPage = main && plan.some(page => page !== current);
    $('.page-mode').disabled = running || !main;
    $('.pages').disabled = running || !main || $('.page-mode').value !== 'continuous';
    $('.range').disabled = running || !main || $('.page-mode').value !== 'custom';
    $('.parity').disabled = running || !main;
    $('.start').disabled = running || Boolean(error) || (!ready && !(hasOtherPage && (items.length || paginationLinks().length)));
  }
  function check(page) {
    if (stopped) throw Error('已停止；已发出的点击无法撤回，请核对最后一项');
    if (location.href !== page) throw Error('页面已切换，已停止');
    if (loggedOut()) throw Error('页面显示未登录，请自行登录后刷新，再开始');
  }
  async function pause(ms, page) {
    const end = Date.now() + ms;
    while (Date.now() < end) { check(page); await sleep(Math.min(150, end - Date.now())); }
    check(page);
  }
  async function run(continuation = null) {
    if (running) return;
    clearHandoff();
    const page = location.href;
    stopped = false;
    let confirmed = 0, skipped = 0, completed = 0;
    let navigating = false;
    try {
      check(page);
      const delay = Number($('.delay').value);
      if (!Number.isFinite(delay) || delay < 250 || delay > 60000) throw Error('间隔必须为 250–60000 毫秒');
      const targets = continuation?.targets || makePlan();
      const job = continuation || { targets, done: 0, delay, seen: [], visited: [], confirmed: 0, skipped: 0 };
      const seen = new Set(job.seen);
      running = true;
      for (const el of shadow.querySelectorAll('select,input,.start,.refresh')) el.disabled = true;
      $('.stop').disabled = false;
      if (continuation) {
        $('.status').textContent = `已进入网站第 ${pageNumber()} 页；计划进度 ${job.done}/${job.targets.length}，即将继续，可点击停止`;
        await pause(1500, page);
      }
      const currentPage = pageNumber();
      const targetPage = job.targets[job.done];
      if (currentPage !== targetPage) {
        const next = routeTo(targetPage);
        const visited = [...job.visited, safeUrl(page)];
        if (visited.includes(next)) throw Error('分页指向已访问页面，已停止，避免循环');
        $('.status').textContent = `网站第 ${currentPage} 页不在本次选择中；1.5 秒后前往第 ${targetPage} 页，不会点赞本页`;
        await pause(1500, page);
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...job, seen: [...seen], visited,
          expected: next, expires: Date.now() + 120000 }));
        navigating = true;
        location.assign(next);
        return;
      }
      const deadline = Date.now() + 15000;
      while (!discover().length && Date.now() < deadline) await pause(250, page);
      const queue = discover().map(item => item.id);
      if (!queue.length) throw Error('当前范围没有识别到点赞按钮');
      $('progress').max = queue.length; $('progress').value = 0;
      log(`网站第 ${currentPage} 页（所选 ${job.done + 1}/${job.targets.length}）：${queue.length} 项；此前网页确认 ${job.confirmed}，跳过 ${job.skipped}`);
      for (const id of queue) {
        check(page);
        const known = currentState(id);
        if (known === 'liked' || attempted.has(id) || seen.has(id)) {
          skipped++; log(`${id}：跳过${known === 'liked' ? '已点赞' : seen.has(id) ? '前页已处理' : '本页已尝试，请刷新核对'}`);
        } else {
          if (known !== 'unliked') throw Error(`${id}：${known === 'login' ? '需要登录' : '状态未知'}，已停止，未点击`);
          const item = discover().find(entry => entry.id === id);
          const button = item?.nodes.filter(el => state(el) === 'unliked' && inScope(el)).map(up).find(Boolean);
          if (!button || button.closest('[aria-disabled="true"]')) throw Error(`${id}：按钮不可用，已停止`);
          attempted.add(id);
          $('.status').textContent = `网站第 ${currentPage} 页 · 所选 ${job.done + 1}/${job.targets.length} · 正在点赞 ${completed + 1}/${queue.length}，作品 ${id}`;
          button.click();
          const deadline = Date.now() + 10000;
          while (currentState(id) !== 'liked' && Date.now() < deadline) await pause(150, page);
          if (currentState(id) !== 'liked') throw Error(`${id}：未确认点赞状态，已停止且不会自动重试`);
          await pause(1200, page);
          if (currentState(id) !== 'liked') throw Error(`${id}：点赞状态回退，已停止`);
          confirmed++; log(`${id}：网页显示已点赞`);
          if (completed < queue.length - 1) await pause(delay, page);
        }
        seen.add(id);
        $('progress').value = ++completed;
      }
      job.confirmed += confirmed; job.skipped += skipped;
      job.done++;
      if (job.done < job.targets.length) {
        const target = job.targets[job.done];
        const next = routeTo(target);
        const visited = [...job.visited, safeUrl(page)];
        if (visited.includes(next)) throw Error('分页指向已访问页面，已停止，避免循环');
        $('.status').textContent = `网站第 ${currentPage} 页完成；1.5 秒后前往所选第 ${target} 页，可点击停止`;
        await pause(1500, page);
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...job, seen: [...seen], visited,
          expected: next, expires: Date.now() + 120000 }));
        navigating = true;
        location.assign(next);
      } else $('.status').textContent = `完成：所选 ${job.targets.length} 页（${summarize(job.targets)}），网页确认 ${job.confirmed}，跳过 ${job.skipped}`;
    } catch (error) {
      $('.status').textContent = `${error.message}（本页网页确认 ${confirmed}，跳过 ${skipped}）`;
      log(error.message);
    } finally {
      if (!navigating) clearHandoff();
      running = false;
      for (const el of shadow.querySelectorAll('select,input,.refresh')) el.disabled = false;
      $('.stop').disabled = true;
      refresh();
      if (navigating) { $('.start').disabled = true; $('.status').textContent = '正在进入下一页…'; }
    }
  }
  function open() { $('.panel').hidden = false; $('.launcher').hidden = true; refresh(); }
  $('.launcher').addEventListener('click', open);
  $('.close').addEventListener('click', () => { $('.panel').hidden = true; $('.launcher').hidden = false; });
  $('.scope').addEventListener('change', refresh);
  $('.page-mode').addEventListener('change', refresh);
  $('.pages').addEventListener('input', refresh);
  $('.range').addEventListener('input', refresh);
  $('.parity').addEventListener('change', refresh);
  $('.refresh').addEventListener('click', refresh);
  $('.start').addEventListener('click', () => run());
  $('.stop').addEventListener('click', () => { stopped = true; });
  let refreshTimer;
  new MutationObserver(() => {
    if (running || $('.panel').hidden) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开批量点赞工具', open);
  let continuation;
  try { continuation = readHandoff(); } catch { clearHandoff(); }
  if (continuation) {
    $('.scope').value = 'main'; $('.page-mode').value = 'custom'; $('.range').value = continuation.targets.join(',');
    $('.parity').value = 'all'; $('.delay').value = continuation.delay;
    open();
    run(continuation);
  }
})();
