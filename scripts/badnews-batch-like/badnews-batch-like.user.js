// ==UserScript==
// @name         Bad.news 批量点赞工具
// @namespace    https://github.com/3ll3-3ll3/tampermonkey-scripts
// @version      1.1.0
// @description  手动批量点赞正文或排行榜，正文支持连续指定页数，跳过已点赞项，支持停止与进度。
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
    label{display:block;margin:10px 0}select{width:100%}input{width:100px}.actions{display:flex;gap:8px;flex-wrap:wrap}
    .start{background:#245cc4}.stop{background:#853333}.note{color:#afc1da;font-size:12px}.log{max-height:180px;overflow:auto;font-size:12px;overflow-wrap:anywhere}
    .log div{padding:4px 0;border-top:1px solid #293b51}progress{width:100%}
  </style><button class="launcher">批量点赞</button><section class="panel" hidden>
    <header><h2>Bad.news 批量点赞</h2><button class="close" aria-label="收起">×</button></header>
    <p class="note">点赞会提交到当前网站账号，可能影响公开评分。不是 Raindrop 收藏。正文可按指定页数连续执行，排行榜仅当前页。</p>
    <label>处理范围<select class="scope"><option value="main">正文作品</option><option value="rank">右侧排行榜</option><option value="all">正文 + 排行榜</option></select></label>
    <label>每次间隔 <input class="delay" type="number" min="250" max="60000" step="50" value="1000"> 毫秒</label>
    <label>正文连续页数 <input class="pages" type="number" min="1" max="1000" step="1" value="1"> 页（含当前页）</label>
    <p class="note">如需第 3–8 页，请先打开第 3 页，再填 6。跨页期间请勿手动切换或刷新；每次翻页前有停止窗口。</p>
    <p class="count"></p><div class="actions"><button class="refresh">刷新识别</button><button class="start">开始点赞</button><button class="stop" disabled>停止</button></div>
    <progress max="1" value="0"></progress><p class="status" role="status">等待手动启动</p><div class="log" role="log"></div>
    <p class="note">跳过已点赞；状态未知时不点击。结果仅按网页按钮状态确认，不代表服务器持久化校验。结果不明后请刷新页面核对，不自动重试。</p>
  </section>`;
  document.documentElement.append(host);
  const $ = s => shadow.querySelector(s);
  let running = false, stopped = false;
  const HANDOFF_KEY = 'badnews-batch-like-handoff-v1';
  const safeUrl = value => { const url = new URL(value, location.href); url.hash = ''; return url.href; };
  function listingKey(value) {
    const url = new URL(value, location.href);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '') || '/';
    for (const key of ['page', 'p']) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  }
  function nextPage() {
    const links = [...document.querySelectorAll('a[href]')].filter(a => {
      const label = [a.textContent, a.getAttribute('aria-label'), a.getAttribute('title')].filter(Boolean).map(s => s.trim());
      return visible(a) && !a.closest('.side,[id^="top-content-"],.disabled,[aria-disabled="true"]') &&
        (a.relList.contains('next') || a.matches('.pagination .next a,.pager .next a,a.next') ||
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
  function clearHandoff() { try { sessionStorage.removeItem(HANDOFF_KEY); } catch {} }
  function readHandoff() {
    let job;
    try { job = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null'); } catch {}
    clearHandoff(); // Consume once: reloading a running page never resumes it.
    if (!job) return null;
    if (job.expected !== safeUrl(location.href) || !Number.isFinite(job.expires) || job.expires < Date.now() || job.expires > Date.now() + 120000 ||
      !Number.isInteger(job.index) || !Number.isInteger(job.total) || job.index < 2 || job.index > job.total || job.total > 1000 ||
      !Number.isFinite(job.delay) || job.delay < 250 || job.delay > 60000 ||
      !Array.isArray(job.seen) || !job.seen.every(id => /^\d+$/.test(id)) ||
      !Array.isArray(job.visited) || job.visited.length !== job.index - 1 ||
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
  function refresh() {
    const items = discover();
    const liked = items.filter(item => currentState(item.id) === 'liked').length;
    const ready = items.filter(item => currentState(item.id) === 'unliked' && !attempted.has(item.id)).length;
    const unknown = items.filter(item => currentState(item.id) === 'unknown').length;
    const pending = items.filter(item => currentState(item.id) !== 'liked' && attempted.has(item.id)).length;
    const reason = !items.length ? '；没有找到当前显示的条目，请等待排行榜加载后刷新识别'
      : !ready ? `；${unknown ? '有未知状态，不能安全点赞' : pending ? '已尝试项需要刷新页面核对' : '当前范围已全部点赞'}` : '';
    $('.count').textContent = `识别 ${items.length} 项 · 已点赞 ${liked} · 可处理 ${ready} · 未知 ${unknown}${reason}`;
    const multi = $('.scope').value === 'main' && Number($('.pages').value) > 1;
    $('.pages').disabled = running || $('.scope').value !== 'main';
    $('.start').disabled = running || (!ready && !(multi && items.length));
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
      const total = $('.scope').value === 'main' ? Number($('.pages').value) : 1;
      if (!Number.isInteger(total) || total < 1 || total > 1000) throw Error('连续页数必须为 1–1000 的整数（包含当前页）');
      const job = continuation || { index: 1, total, delay, seen: [], visited: [], confirmed: 0, skipped: 0 };
      const seen = new Set(job.seen);
      running = true;
      for (const el of shadow.querySelectorAll('select,input,.start,.refresh')) el.disabled = true;
      $('.stop').disabled = false;
      if (continuation) {
        $('.status').textContent = `已进入第 ${job.index}/${job.total} 页，即将继续；可点击停止`;
        await pause(1500, page);
        const deadline = Date.now() + 15000;
        while (!discover().length && Date.now() < deadline) await pause(250, page);
      }
      const queue = discover().map(item => item.id);
      if (!queue.length) throw Error('当前范围没有识别到点赞按钮');
      $('progress').max = queue.length; $('progress').value = 0;
      log(`第 ${job.index}/${job.total} 页：${queue.length} 项；此前网页确认 ${job.confirmed}，跳过 ${job.skipped}`);
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
          $('.status').textContent = `第 ${job.index}/${job.total} 页 · 正在点赞 ${completed + 1}/${queue.length}，作品 ${id}`;
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
      if (job.index < job.total) {
        const next = nextPage();
        if (!next) throw Error(`已完成 ${job.index}/${job.total} 页；未找到可安全识别的下一页，已停止（可能已到末页）`);
        const visited = [...job.visited, safeUrl(page)];
        if (visited.includes(next)) throw Error('下一页指向已处理页面，已停止，避免循环');
        $('.status').textContent = `第 ${job.index}/${job.total} 页完成；1.5 秒后进入下一页，可点击停止`;
        await pause(1500, page);
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...job, index: job.index + 1, seen: [...seen], visited,
          expected: next, expires: Date.now() + 120000 }));
        navigating = true;
        location.assign(next);
      } else $('.status').textContent = `完成：${job.total} 页，网页确认 ${job.confirmed}，跳过 ${job.skipped}`;
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
  $('.pages').addEventListener('input', refresh);
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
    $('.scope').value = 'main'; $('.pages').value = continuation.total; $('.delay').value = continuation.delay;
    open();
    run(continuation);
  }
})();
