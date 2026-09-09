// ==UserScript==
// @name         MissAV 自动 Load More
// @namespace    wjl.local
// @version      1.6.0
// @description  自动识别 MissAV 的多个 Load More 板块，并分别加载到指定总数（兼容新版非 grid 页面结构）。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @match        https://missav.ws/*
// @match        https://*.missav.ws/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  console.info('[MissAV Auto Loader] v1.6.0 starting', location.href);

  const EXISTING = window.__missavAutoLoader;
  if (EXISTING?.show) {
    EXISTING.refresh();
    return;
  }

  const LOAD_MORE_TEXT = /^(?:load\s*more|加载更多|载入更多|載入更多|更多を読み込む|もっと見る)$/iu;
  const PLACEHOLDER_TITLE = /^(?:loading|loading\.\.\.|载入中|载入中…|加载中|加载中…)$/iu;
  const PANEL_ID = 'missav-auto-loader-panel';
  const STYLE_ID = 'missav-auto-loader-style';
  const MAX_TARGET = 10000;
  const DEFAULT_INTERVAL_MS = 900;
  const GROWTH_TIMEOUT_MS = 20000;
  const MAX_STALL_RETRIES = 3;
  const HAS_MENU_COMMAND = typeof GM_registerMenuCommand === 'function';

  let destroyed = false;
  let queue = Promise.resolve();
  let rows = new Map();
  let intervalInput;
  let listElement;
  let summaryElement;
  let syncTimer;
  const sectionKeys = new WeakMap();
  let nextSectionKey = 1;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizedText(element) {
    return (element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function loadMoreButtons() {
    return [...document.querySelectorAll('a, button, [role="button"]')].filter((element) => {
      const label = normalizedText(element)
        || element.getAttribute('aria-label')
        || element.getAttribute('title')
        || '';
      if (LOAD_MORE_TEXT.test(label.trim())) return true;

      // MissAV occasionally changes the translated label. Its load control is
      // still a # link inside an absolutely positioned control immediately
      // after a titled card grid, so keep a structure-based fallback.
      const control = element.parentElement;
      const section = control?.previousElementSibling || control?.parentElement;
      return element.getAttribute('href') === '#'
        && Boolean(control?.classList.contains('absolute') || control?.querySelector?.('svg'))
        && Boolean(section?.querySelector('h1, h2, h3, h4, h5, h6'))
        && Boolean(section?.querySelector('.grid, [class*="grid-cols-"]'));
    });
  }

  function comesBefore(element, reference) {
    return Boolean(element.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function linkKey(link) {
    const rawHref = (link?.getAttribute('href') || '').trim();
    if (!rawHref || rawHref === '#' || rawHref.toLowerCase().startsWith('javascript:')) return null;
    try {
      const url = new URL(rawHref, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return null;
      return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    } catch {
      return null;
    }
  }

  function looksLikeVideoPath(key) {
    const slug = key.split('/').filter(Boolean).pop() || '';
    return /(?:[a-z0-9]{2,18}(?:[-_][a-z0-9]{1,18})*[-_]\d{2,10}(?:[-_][a-z0-9]+)*|[a-z]{2,12}\d{3,9})$/iu.test(slug);
  }

  function linksBetween(root, heading, button) {
    return [...root.querySelectorAll('a[href]')].filter((link) => (
      link !== button
      && comesBefore(heading, link)
      && comesBefore(link, button)
    ));
  }

  function cardKeys(section) {
    if (!section?.section?.isConnected || !section.heading) return [];
    const links = section.button?.isConnected
      ? linksBetween(section.section, section.heading, section.button)
      : [...section.section.querySelectorAll('a[href]')]
        .filter((link) => comesBefore(section.heading, link));
    const keys = links
      .map(linkKey)
      .filter(Boolean);
    const videoKeys = keys.filter(looksLikeVideoPath);
    return [...new Set(videoKeys.length ? videoKeys : keys)];
  }

  function countCards(section) {
    return cardKeys(section).length;
  }

  function precedingHeading(button) {
    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    return headings.filter((heading) => comesBefore(heading, button)).pop() || null;
  }

  function findSection(button) {
    const heading = precedingHeading(button);
    if (!heading) return null;

    let candidate = button.parentElement;
    for (let depth = 0; candidate && candidate !== document.documentElement && depth < 16; depth++) {
      const found = { section: candidate, heading, button };
      if (candidate.contains(heading) && countCards(found) > 0) return found;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function sectionKey(root) {
    if (!sectionKeys.has(root)) sectionKeys.set(root, `section::${nextSectionKey++}`);
    return sectionKeys.get(root);
  }

  function discoverSections() {
    const titleCounts = new Map();
    return loadMoreButtons()
      .map((button) => {
        const found = findSection(button);
        const section = found?.section || null;
        const heading = found?.heading || null;
        const title = normalizedText(heading) || '未命名板块';
        if (!section) return null;

        const ordinal = (titleCounts.get(title) || 0) + 1;
        titleCounts.set(title, ordinal);
        return {
          key: sectionKey(section),
          title: ordinal === 1 ? title : `${title} (${ordinal})`,
          rawTitle: title,
          ordinal,
          section,
          heading,
          button,
          count: countCards(found),
        };
      })
      .filter(Boolean);
  }

  function rediscover(state) {
    const sections = discoverSections();
    return sections.find((section) => section.section === state.section)
      || sections.find((section) => section.key === state.key)
      || sections.find((section) => section.rawTitle === state.rawTitle && section.ordinal === state.ordinal)
      || null;
  }

  function buttonReady(button) {
    if (!button?.isConnected) return false;
    if (button.getAttribute('aria-disabled') === 'true') return false;
    if ('disabled' in button && button.disabled) return false;
    const style = getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function currentSection(state) {
    const found = rediscover(state);
    if (found) {
      state.section = found.section;
      state.rawTitle = found.rawTitle;
      state.ordinal = found.ordinal;
      state.lastHeading = found.heading;
      state.lastButton = found.button;
      if (state.titleElement && !PLACEHOLDER_TITLE.test(found.title) && state.title !== found.title) {
        state.title = found.title;
        state.titleElement.textContent = found.title;
      }
      return found;
    }
    if (state.section?.isConnected && state.lastHeading?.isConnected) {
      const button = state.lastButton?.isConnected ? state.lastButton : null;
      if (!button) return { section: state.section, heading: state.lastHeading, button: null, count: 0 };
      return { section: state.section, heading: state.lastHeading, button };
    }
    return null;
  }

  function waitForGrowth(state, previousCount) {
    return new Promise((resolve) => {
      let finished = false;
      let observer = null;

      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);
        observer?.disconnect();
        resolve(result);
      };

      const check = () => {
        const current = currentSection(state);
        if (!current) return;
        const count = countCards(current);
        if (count > previousCount) finish({ grew: true, count, current });
      };

      const first = currentSection(state);
      if (first?.section) {
        observer = new MutationObserver(check);
        observer.observe(first.section, { childList: true, subtree: true });
      }
      const pollTimer = setInterval(check, 250);
      const timeoutTimer = setTimeout(() => {
        const current = currentSection(state);
        finish({
          grew: false,
          count: current ? countCards(current) : previousCount,
          current,
        });
      }, GROWTH_TIMEOUT_MS);
      check();
    });
  }

  function setRowStatus(state, message, kind = '') {
    if (!state.statusElement) return;
    state.statusElement.textContent = message;
    state.statusElement.dataset.kind = kind;
  }

  function updateSummary() {
    const active = [...rows.values()].filter((state) => state.running || state.queued).length;
    summaryElement.textContent = active ? `${active} 个板块正在处理` : '空闲';
  }

  async function waitUntilReady(state, maxWaitMs = 10000) {
    const deadline = Date.now() + maxWaitMs;
    while (!state.cancelRequested && Date.now() < deadline) {
      const current = rediscover(state);
      if (!current) return null;
      state.section = current.section;
      state.lastHeading = current.heading;
      state.lastButton = current.button;
      if (buttonReady(current.button)) return current;
      await sleep(250);
    }
    return null;
  }

  async function runSection(state) {
    state.queued = false;
    if (destroyed || state.cancelRequested) {
      setRowStatus(state, '已停止');
      updateSummary();
      return;
    }

    state.running = true;
    state.startButton.disabled = true;
    state.stopButton.disabled = false;
    updateSummary();

    try {
      const target = Math.min(MAX_TARGET, Math.max(0, Number.parseInt(state.targetInput.value, 10) || 0));
      state.targetInput.value = String(target);
      let stalled = 0;

      while (!destroyed && !state.cancelRequested) {
        const current = currentSection(state);
        if (!current) {
          setRowStatus(state, '板块或按钮已消失', 'error');
          break;
        }

        const count = countCards(current);
        state.countElement.textContent = String(count);
        if (count >= target) {
          const extra = count - target;
          setRowStatus(state, extra ? `完成：${count}（多 ${extra}）` : `完成：${count}`, 'done');
          break;
        }
        if (!current.button) {
          setRowStatus(state, `已经没有更多内容：${count}`, 'done');
          break;
        }

        const ready = await waitUntilReady(state);
        if (!ready) {
          setRowStatus(state, state.cancelRequested ? '已停止' : '按钮长时间不可用', 'error');
          break;
        }

        const before = countCards(ready);
        setRowStatus(state, `加载中：${before} / ${target}`);
        ready.button.click();
        const result = await waitForGrowth(state, before);

        if (result.grew) {
          stalled = 0;
          state.countElement.textContent = String(result.count);
          setRowStatus(state, `已加载：${result.count} / ${target}`);
          const interval = Math.max(300, Number.parseInt(intervalInput.value, 10) || DEFAULT_INTERVAL_MS);
          await sleep(interval);
          continue;
        }

        stalled += 1;
        if (!result.current?.button) {
          setRowStatus(state, '已经没有更多内容', 'done');
          break;
        }
        if (stalled >= MAX_STALL_RETRIES) {
          setRowStatus(state, `连续 ${stalled} 次无新增，已停机`, 'error');
          break;
        }
        setRowStatus(state, `无新增，准备重试 ${stalled}/${MAX_STALL_RETRIES}`);
        await sleep(1000 * stalled);
      }

      if (state.cancelRequested) setRowStatus(state, '已停止');
    } catch (error) {
      console.error('[MissAV Auto Loader]', error);
      setRowStatus(state, `错误：${error?.message || error}`, 'error');
    } finally {
      state.running = false;
      state.startButton.disabled = false;
      state.stopButton.disabled = true;
      updateSummary();
    }
  }

  function enqueue(state) {
    if (destroyed || state.running || state.queued) return;
    state.cancelRequested = false;
    state.queued = true;
    setRowStatus(state, '已排队');
    updateSummary();
    queue = queue.then(() => runSection(state));
  }

  function stop(state) {
    state.cancelRequested = true;
    state.queued = false;
    if (!state.running) setRowStatus(state, '已停止');
    updateSummary();
  }

  function stopAll() {
    rows.forEach(stop);
  }

  function createRow(section, savedTarget) {
    const row = document.createElement('div');
    row.className = 'mal-row';
    row.innerHTML = `
      <div class="mal-row-head">
        <strong class="mal-title"></strong>
        <span>当前 <b class="mal-count"></b></span>
      </div>
      <div class="mal-controls">
        <label>目标总数 <input class="mal-target" type="number" min="0" max="${MAX_TARGET}" step="1"></label>
        <button class="mal-start" type="button">开始</button>
        <button class="mal-stop" type="button" disabled>停止</button>
      </div>
      <div class="mal-status">等待设置</div>
    `;

    const titleElement = row.querySelector('.mal-title');
    titleElement.textContent = section.title;
    const countElement = row.querySelector('.mal-count');
    countElement.textContent = String(section.count);
    const targetInput = row.querySelector('.mal-target');
    targetInput.value = String(Math.max(section.count, savedTarget || section.count));

    const state = {
      key: section.key,
      title: section.title,
      rawTitle: section.rawTitle,
      ordinal: section.ordinal,
      section: section.section,
      titleElement,
      running: false,
      queued: false,
      cancelRequested: false,
      lastHeading: section.heading,
      lastButton: section.button,
      countElement,
      targetInput,
      statusElement: row.querySelector('.mal-status'),
      startButton: row.querySelector('.mal-start'),
      stopButton: row.querySelector('.mal-stop'),
    };
    state.startButton.addEventListener('click', () => enqueue(state));
    state.stopButton.addEventListener('click', () => stop(state));
    return { row, state };
  }

  function refresh() {
    stopAll();
    const savedTargets = new Map([...rows].map(([key, state]) => [key, Number(state.targetInput.value)]));
    rows = new Map();
    listElement.replaceChildren();

    const sections = discoverSections();
    sections.forEach((section) => {
      const { row, state } = createRow(section, savedTargets.get(section.key));
      rows.set(section.key, state);
      listElement.appendChild(row);
    });

    if (!sections.length) {
      const empty = document.createElement('div');
      empty.className = 'mal-empty';
      empty.textContent = '没有识别到 Load More 板块。请确认页面已经加载完成。';
      listElement.appendChild(empty);
    }
    updateSummary();
  }

  function destroy() {
    stopAll();
    destroyed = true;
    clearInterval(syncTimer);
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    delete window.__missavAutoLoader;
  }

  function showPanel() {
    panel.style.display = 'block';
    refresh();
  }

  function hidePanel() {
    stopAll();
    panel.style.display = 'none';
  }

  function togglePanel() {
    if (panel.style.display === 'none') showPanel();
    else hidePanel();
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: min(370px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: 0; color: #e5e7eb; background: rgba(17,24,39,.97); border: 1px solid #475569; border-radius: 12px; box-shadow: 0 16px 50px rgba(0,0,0,.45); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${PANEL_ID} .mal-header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 12px; background: #111827; border-bottom: 1px solid #334155; }
    #${PANEL_ID} .mal-header strong { font-size: 14px; }
    #${PANEL_ID} .mal-summary { color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} .mal-body { padding: 10px; }
    #${PANEL_ID} .mal-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 9px; }
    #${PANEL_ID} button { padding: 5px 9px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; cursor: pointer; font: inherit; }
    #${PANEL_ID} button:hover:not(:disabled) { filter: brightness(1.12); }
    #${PANEL_ID} button:disabled { cursor: default; opacity: .45; }
    #${PANEL_ID} .mal-stop, #${PANEL_ID} .mal-stop-all { background: #b91c1c; }
    #${PANEL_ID} .mal-refresh { background: #475569; }
    #${PANEL_ID} .mal-close { padding: 2px 7px; background: transparent; color: #cbd5e1; font-size: 18px; }
    #${PANEL_ID} input { width: 86px; padding: 5px 6px; color: #f8fafc; background: #0f172a; border: 1px solid #475569; border-radius: 6px; }
    #${PANEL_ID} .mal-interval { margin-left: auto; color: #cbd5e1; white-space: nowrap; }
    #${PANEL_ID} .mal-interval input { width: 74px; }
    #${PANEL_ID} .mal-row { padding: 9px; margin-top: 8px; background: #1f2937; border: 1px solid #374151; border-radius: 9px; }
    #${PANEL_ID} .mal-row-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
    #${PANEL_ID} .mal-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${PANEL_ID} .mal-row-head span { flex: none; color: #cbd5e1; }
    #${PANEL_ID} .mal-controls { display: flex; align-items: center; gap: 6px; }
    #${PANEL_ID} .mal-controls label { display: flex; align-items: center; gap: 5px; color: #cbd5e1; }
    #${PANEL_ID} .mal-status { margin-top: 7px; color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} .mal-status[data-kind="done"] { color: #86efac; }
    #${PANEL_ID} .mal-status[data-kind="error"] { color: #fca5a5; }
    #${PANEL_ID} .mal-note, #${PANEL_ID} .mal-empty { margin-top: 9px; color: #94a3b8; font-size: 12px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.style.display = HAS_MENU_COMMAND ? 'none' : 'block';
  panel.innerHTML = `
    <div class="mal-header">
      <div><strong>MissAV 自动 Load More</strong><div class="mal-summary">空闲</div></div>
      <button class="mal-close" type="button" title="关闭并停止">×</button>
    </div>
    <div class="mal-body">
      <div class="mal-toolbar">
        <button class="mal-start-all" type="button">全部开始</button>
        <button class="mal-stop-all" type="button">全部停止</button>
        <button class="mal-refresh" type="button">刷新识别</button>
        <label class="mal-interval">间隔 <input type="number" min="300" max="10000" step="100" value="${DEFAULT_INTERVAL_MS}"> ms</label>
      </div>
      <div class="mal-list"></div>
      <div class="mal-note">按卡片总数停止；每次通常增加 12 条，所以可能略微超过目标。多个板块会串行加载，降低限流风险。</div>
    </div>
  `;
  (document.body || document.documentElement).appendChild(panel);

  intervalInput = panel.querySelector('.mal-interval input');
  listElement = panel.querySelector('.mal-list');
  summaryElement = panel.querySelector('.mal-summary');
  panel.querySelector('.mal-start-all').addEventListener('click', () => rows.forEach(enqueue));
  panel.querySelector('.mal-stop-all').addEventListener('click', stopAll);
  panel.querySelector('.mal-refresh').addEventListener('click', refresh);
  panel.querySelector('.mal-close').addEventListener('click', hidePanel);

  window.__missavAutoLoader = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    refresh,
    stopAll,
    destroy,
    status() {
      return [...rows.values()].map((state) => ({
        section: state.title,
        current: Number(state.countElement.textContent),
        target: Number(state.targetInput.value),
        running: state.running,
        queued: state.queued,
        status: state.statusElement.textContent,
      }));
    },
  };

  if (HAS_MENU_COMMAND) {
    GM_registerMenuCommand('打开/隐藏 MissAV Load More 面板', togglePanel);
  }

  refresh();
  syncTimer = setInterval(() => {
    if (![...rows.values()].some((state) => state.running || state.queued)) {
      const discovered = discoverSections();
      const knownRoots = new Set([...rows.values()].map((state) => state.section));
      if ((rows.size === 0 && discovered.length > 0)
        || discovered.some((section) => !knownRoots.has(section.section))) {
        refresh();
        return;
      }
    }
    rows.forEach((state) => {
      const current = currentSection(state);
      if (current && !state.running) state.countElement.textContent = String(countCards(current));
    });
  }, 1000);
  console.info('[MissAV Auto Loader] ready', {
    sections: rows.size,
    labels: [...rows.values()].map((state) => state.title),
  });
})();
