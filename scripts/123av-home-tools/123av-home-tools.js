(() => {
  'use strict';

  console.info('[123AV Home Tools] v1.2.1 starting', location.href);

  const EXISTING = window.__av123HomeTools;
  if (EXISTING?.show) {
    EXISTING.show();
    EXISTING.refresh();
    return;
  }

  const PANEL_ID = 'av123-home-tools-panel';
  const STYLE_ID = 'av123-home-tools-style';
  const MAX_TARGET = 10000;
  const DEFAULT_INTERVAL_MS = 900;
  const GROWTH_TIMEOUT_MS = 20000;
  const MAX_STALL_RETRIES = 3;
  const HAS_MENU_COMMAND = typeof GM_registerMenuCommand === 'function';
  const CODE_IN_TITLE = /(?:\bFC2[\s_-]*(?:PPV[\s_-]*)?\d{4,10}\b|\b(?:\d{3})?[A-Z]{2,8}[\s_-]+\d{2,5}V?\b|\b[A-Z]{2,8}\d{2,5}V?\b)/i;

  let destroyed = false;
  let queue = Promise.resolve();
  let rows = new Map();
  let intervalInput;
  let listElement;
  let summaryElement;
  let featuredStatus;
  let featuredOutput;
  let allTitlesStatus;
  let allTitlesOutput;
  let syncTimer;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizedText(element) {
    return (element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function extractFeaturedItems() {
    const seen = new Set();
    return [...document.querySelectorAll('.featured .featured__link[href]')]
      .map((link) => ({
        title: normalizedText(link.querySelector('h1, h2, h3, h4, h5, h6')) || normalizedText(link),
        href: new URL(link.getAttribute('href'), location.href).href,
      }))
      .filter((item) => {
        if (!item.title || seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      });
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  async function extractAndCopyFeatured() {
    const items = extractFeaturedItems();
    if (!items.length) {
      featuredStatus.textContent = '没有识别到顶部轮播内容';
      featuredStatus.dataset.kind = 'error';
      featuredOutput.hidden = true;
      return [];
    }

    const text = items.map((item, index) => `${index + 1}. ${item.title}`).join('\n');
    featuredOutput.value = text;
    featuredOutput.hidden = false;
    try {
      await copyText(text);
      featuredStatus.textContent = `已提取并复制 ${items.length} 个标题`;
      featuredStatus.dataset.kind = 'done';
    } catch (error) {
      console.error('[123AV Home Tools] copy failed', error);
      featuredStatus.textContent = `已提取 ${items.length} 个标题，但自动复制失败`;
      featuredStatus.dataset.kind = 'error';
    }
    return items;
  }

  function cardElements(grid) {
    if (!grid) return [];
    const directCards = [...grid.querySelectorAll(':scope > .card')];
    if (directCards.length) return directCards;
    return [...grid.children].filter((child) => child.querySelector('a[href*="/v/"]'));
  }

  function countCards(grid) {
    return cardElements(grid).length;
  }

  function titleFromCard(card) {
    const candidates = new Map();
    const addCandidate = (value, priority) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      candidates.set(text, Math.max(priority, candidates.get(text) || 0));
    };
    const addElement = (element, priority) => {
      if (!element) return;
      addCandidate(normalizedText(element), priority);
      addCandidate(element.getAttribute?.('data-title'), priority);
      addCandidate(element.getAttribute?.('title'), priority);
      addCandidate(element.getAttribute?.('aria-label'), priority);
      addCandidate(element.getAttribute?.('alt'), priority);
    };

    card.querySelectorAll([
      '.card__title', '.card-title', '.video-title', '[class*="video-title"]',
      '[class*="video_title"]', '[class*="card-title"]',
      '[class*="line-clamp"]', '[class*="truncate"]', '[class*="title"]',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ].join(',')).forEach((element) => addElement(element, 3));
    card.querySelectorAll('a[href]').forEach((element) => addElement(element, 2));
    card.querySelectorAll('[data-title], [title], [aria-label], img[alt]').forEach((element) => addElement(element, 1));

    const values = [...candidates].map(([text, priority]) => ({ text, priority }));
    const containingCode = values.filter((item) => CODE_IN_TITLE.test(item.text));
    const pool = containingCode.length ? containingCode : values;
    pool.sort((left, right) => containingCode.length
      ? right.text.length - left.text.length || right.priority - left.priority
      : right.priority - left.priority || right.text.length - left.text.length);
    return pool[0]?.text || normalizedText(card);
  }

  function extractTitles(grid) {
    return cardElements(grid).map(titleFromCard).filter(Boolean);
  }

  function updateRowTitleResult(state, titles) {
    state.extractedTitles = titles;
    state.outputElement.value = titles.join('\n');
    state.outputElement.hidden = false;
    state.copyButton.disabled = !titles.length;
    state.resultElement.textContent = titles.length
      ? `已提取 ${titles.length} 条标题`
      : '没有识别到可复制的标题';
    state.resultElement.dataset.kind = titles.length ? 'done' : 'error';
  }

  async function extractAndCopySectionTitles(state, shouldCopy = true) {
    const current = currentSection(state);
    const titles = current?.grid ? extractTitles(current.grid) : [];
    updateRowTitleResult(state, titles);
    if (!shouldCopy || !titles.length) return titles;
    try {
      await copyText(titles.join('\n'));
      state.resultElement.textContent = `已提取并复制 ${titles.length} 条标题`;
    } catch (error) {
      console.error('[123AV Home Tools] copy failed', error);
      state.resultElement.textContent = `已提取 ${titles.length} 条标题，但自动复制失败`;
      state.resultElement.dataset.kind = 'error';
    }
    return titles;
  }

  async function extractAndCopyAllTitles() {
    const titles = [];
    for (const state of rows.values()) {
      const current = currentSection(state);
      const sectionTitles = current?.grid ? extractTitles(current.grid) : [];
      updateRowTitleResult(state, sectionTitles);
      titles.push(...sectionTitles);
    }
    allTitlesOutput.value = titles.join('\n');
    allTitlesOutput.hidden = false;
    if (!titles.length) {
      allTitlesStatus.textContent = '没有识别到可复制的标题';
      allTitlesStatus.dataset.kind = 'error';
      return titles;
    }
    try {
      await copyText(allTitlesOutput.value);
      allTitlesStatus.textContent = `已汇总并复制 ${titles.length} 条标题`;
      allTitlesStatus.dataset.kind = 'done';
    } catch (error) {
      console.error('[123AV Home Tools] copy all failed', error);
      allTitlesStatus.textContent = `已汇总 ${titles.length} 条标题，但自动复制失败`;
      allTitlesStatus.dataset.kind = 'error';
    }
    return titles;
  }

  function discoverSections() {
    return [...document.querySelectorAll('.rec__section')]
      .map((section, index) => {
        const grid = section.querySelector('.rec__grid');
        const button = section.querySelector('.rec__more-btn');
        if (!grid || !button) return null;
        const title = normalizedText(section.querySelector('.section__head h1, .section__head h2, .section__head h3'))
          || normalizedText(section.querySelector('.section__head'))
          || `板块 ${index + 1}`;
        return {
          key: `section::${index + 1}`,
          title,
          section,
          grid,
          button,
          count: countCards(grid),
        };
      })
      .filter(Boolean);
  }

  function rediscover(key) {
    return discoverSections().find((section) => section.key === key) || null;
  }

  function buttonReady(button) {
    if (!button?.isConnected) return false;
    if (button.getAttribute('aria-disabled') === 'true') return false;
    if ('disabled' in button && button.disabled) return false;
    const style = getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function currentSection(state) {
    const found = rediscover(state.key);
    if (found) {
      state.lastGrid = found.grid;
      if (state.titleElement && state.title !== found.title) {
        state.title = found.title;
        state.titleElement.textContent = found.title;
      }
      return found;
    }
    if (state.lastGrid?.isConnected) {
      return { grid: state.lastGrid, button: null };
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
        const count = countCards(current.grid);
        if (count > previousCount) finish({ grew: true, count, current });
      };

      const first = currentSection(state);
      if (first?.grid) {
        observer = new MutationObserver(check);
        observer.observe(first.grid, { childList: true, subtree: false });
      }
      const pollTimer = setInterval(check, 250);
      const timeoutTimer = setTimeout(() => {
        const current = currentSection(state);
        finish({
          grew: false,
          count: current ? countCards(current.grid) : previousCount,
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
      const current = rediscover(state.key);
      if (!current) return null;
      state.lastGrid = current.grid;
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

        const count = countCards(current.grid);
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

        const before = countCards(ready.grid);
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
      console.error('[123AV Home Tools]', error);
      setRowStatus(state, `错误：${error?.message || error}`, 'error');
    } finally {
      if (!destroyed && !state.cancelRequested) await extractAndCopySectionTitles(state, true);
      state.running = false;
      state.startButton.disabled = false;
      state.stopButton.disabled = true;
      updateSummary();
    }
  }

  function enqueue(state) {
    if (destroyed || state.running || state.queued) return false;
    state.cancelRequested = false;
    state.queued = true;
    setRowStatus(state, '已排队');
    updateSummary();
    queue = queue.then(() => runSection(state));
    return true;
  }

  function enqueueAll() {
    let queuedAny = false;
    rows.forEach((state) => { queuedAny = enqueue(state) || queuedAny; });
    if (queuedAny) queue = queue.then(extractAndCopyAllTitles);
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
    row.className = 'aht-row';
    row.innerHTML = `
      <div class="aht-row-head">
        <strong class="aht-title"></strong>
        <span>当前 <b class="aht-count"></b></span>
      </div>
      <div class="aht-controls">
        <label>目标总数 <input class="aht-target" type="number" min="0" max="${MAX_TARGET}" step="1"></label>
        <button class="aht-start" type="button">开始</button>
        <button class="aht-stop" type="button" disabled>停止</button>
      </div>
      <div class="aht-status">等待设置</div>
      <div class="aht-result-actions">
        <button class="aht-copy" type="button">提取并复制标题</button>
      </div>
      <div class="aht-result-status">尚未提取标题</div>
      <textarea class="aht-output" readonly hidden></textarea>
    `;

    const titleElement = row.querySelector('.aht-title');
    titleElement.textContent = section.title;
    const countElement = row.querySelector('.aht-count');
    countElement.textContent = String(section.count);
    const targetInput = row.querySelector('.aht-target');
    targetInput.value = String(Math.max(section.count, savedTarget || section.count));

    const state = {
      key: section.key,
      title: section.title,
      titleElement,
      running: false,
      queued: false,
      cancelRequested: false,
      lastGrid: section.grid,
      countElement,
      targetInput,
      statusElement: row.querySelector('.aht-status'),
      resultElement: row.querySelector('.aht-result-status'),
      outputElement: row.querySelector('.aht-output'),
      startButton: row.querySelector('.aht-start'),
      stopButton: row.querySelector('.aht-stop'),
      copyButton: row.querySelector('.aht-copy'),
      extractedTitles: [],
    };
    state.startButton.addEventListener('click', () => enqueue(state));
    state.stopButton.addEventListener('click', () => stop(state));
    state.copyButton.addEventListener('click', () => extractAndCopySectionTitles(state, true));
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
      empty.className = 'aht-empty';
      empty.textContent = '没有识别到 Load More 板块。请确认当前为 123AV 首页并已加载完成。';
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
    delete window.__av123HomeTools;
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
    #${PANEL_ID} { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: min(390px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: 0; color: #e5e7eb; background: rgba(17,24,39,.97); border: 1px solid #475569; border-radius: 12px; box-shadow: 0 16px 50px rgba(0,0,0,.45); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${PANEL_ID} .aht-header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 12px; background: #111827; border-bottom: 1px solid #334155; }
    #${PANEL_ID} .aht-header strong { font-size: 14px; }
    #${PANEL_ID} .aht-summary { color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} .aht-body { padding: 10px; }
    #${PANEL_ID} .aht-featured { padding: 9px; background: #172033; border: 1px solid #334155; border-radius: 9px; }
    #${PANEL_ID} .aht-featured-head { display: flex; align-items: center; gap: 7px; }
    #${PANEL_ID} .aht-featured-head strong { flex: 1; }
    #${PANEL_ID} .aht-featured-status { margin-top: 6px; color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} .aht-featured-output { width: 100%; min-height: 130px; margin-top: 7px; padding: 7px; resize: vertical; color: #e5e7eb; background: #0f172a; border: 1px solid #475569; border-radius: 6px; font: 12px/1.45 ui-monospace, Consolas, monospace; }
    #${PANEL_ID} .aht-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 10px 0 9px; }
    #${PANEL_ID} button { padding: 5px 9px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; cursor: pointer; font: inherit; }
    #${PANEL_ID} button:hover:not(:disabled) { filter: brightness(1.12); }
    #${PANEL_ID} button:disabled { cursor: default; opacity: .45; }
    #${PANEL_ID} .aht-stop, #${PANEL_ID} .aht-stop-all { background: #b91c1c; }
    #${PANEL_ID} .aht-refresh { background: #475569; }
    #${PANEL_ID} .aht-close { padding: 2px 7px; background: transparent; color: #cbd5e1; font-size: 18px; }
    #${PANEL_ID} input { width: 86px; padding: 5px 6px; color: #f8fafc; background: #0f172a; border: 1px solid #475569; border-radius: 6px; }
    #${PANEL_ID} .aht-interval { margin-left: auto; color: #cbd5e1; white-space: nowrap; }
    #${PANEL_ID} .aht-interval input { width: 74px; }
    #${PANEL_ID} .aht-row { padding: 9px; margin-top: 8px; background: #1f2937; border: 1px solid #374151; border-radius: 9px; }
    #${PANEL_ID} .aht-row-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
    #${PANEL_ID} .aht-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${PANEL_ID} .aht-row-head span { flex: none; color: #cbd5e1; }
    #${PANEL_ID} .aht-controls { display: flex; align-items: center; gap: 6px; }
    #${PANEL_ID} .aht-controls label { display: flex; align-items: center; gap: 5px; color: #cbd5e1; }
    #${PANEL_ID} .aht-status { margin-top: 7px; color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} .aht-result-actions { margin-top: 7px; }
    #${PANEL_ID} .aht-copy, #${PANEL_ID} .aht-copy-all { background: #0f766e; }
    #${PANEL_ID} .aht-result-status, #${PANEL_ID} .aht-all-status { margin-top: 6px; color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} .aht-output, #${PANEL_ID} .aht-all-output { width: 100%; min-height: 92px; margin-top: 6px; padding: 7px; resize: vertical; color: #e5e7eb; background: #0f172a; border: 1px solid #475569; border-radius: 6px; font: 12px/1.45 ui-monospace, Consolas, monospace; }
    #${PANEL_ID} .aht-all-results { padding: 9px; margin-top: 9px; background: #172033; border: 1px solid #334155; border-radius: 9px; }
    #${PANEL_ID} [data-kind="done"] { color: #86efac; }
    #${PANEL_ID} [data-kind="error"] { color: #fca5a5; }
    #${PANEL_ID} .aht-note, #${PANEL_ID} .aht-empty { margin-top: 9px; color: #94a3b8; font-size: 12px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.style.display = HAS_MENU_COMMAND ? 'none' : 'block';
  panel.innerHTML = `
    <div class="aht-header">
      <div><strong>123AV 首页工具</strong><div class="aht-summary">空闲</div></div>
      <button class="aht-close" type="button" title="关闭并停止">×</button>
    </div>
    <div class="aht-body">
      <div class="aht-featured">
        <div class="aht-featured-head">
          <strong>顶部轮播推荐</strong>
          <button class="aht-extract" type="button">一键提取并复制</button>
        </div>
        <div class="aht-featured-status">可提取所有隐藏页，无需手动翻页</div>
        <textarea class="aht-featured-output" readonly hidden></textarea>
      </div>
      <div class="aht-toolbar">
        <button class="aht-start-all" type="button">全部开始</button>
        <button class="aht-stop-all" type="button">全部停止</button>
        <button class="aht-refresh" type="button">刷新识别</button>
        <label class="aht-interval">间隔 <input type="number" min="300" max="10000" step="100" value="${DEFAULT_INTERVAL_MS}"> ms</label>
      </div>
      <div class="aht-list"></div>
      <div class="aht-all-results">
        <button class="aht-copy-all" type="button">汇总并复制全部标题</button>
        <div class="aht-all-status">“全部开始”完成后会自动汇总并复制</div>
        <textarea class="aht-all-output" readonly hidden></textarea>
      </div>
      <div class="aht-note">按卡片总数停止；完成后自动提取并复制标题。多个板块串行加载，“全部开始”结束后复制所有板块标题。</div>
    </div>
  `;
  (document.body || document.documentElement).appendChild(panel);

  intervalInput = panel.querySelector('.aht-interval input');
  listElement = panel.querySelector('.aht-list');
  summaryElement = panel.querySelector('.aht-summary');
  featuredStatus = panel.querySelector('.aht-featured-status');
  featuredOutput = panel.querySelector('.aht-featured-output');
  allTitlesStatus = panel.querySelector('.aht-all-status');
  allTitlesOutput = panel.querySelector('.aht-all-output');
  panel.querySelector('.aht-extract').addEventListener('click', extractAndCopyFeatured);
  panel.querySelector('.aht-start-all').addEventListener('click', enqueueAll);
  panel.querySelector('.aht-stop-all').addEventListener('click', stopAll);
  panel.querySelector('.aht-refresh').addEventListener('click', refresh);
  panel.querySelector('.aht-copy-all').addEventListener('click', extractAndCopyAllTitles);
  panel.querySelector('.aht-close').addEventListener('click', hidePanel);

  window.__av123HomeTools = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    refresh,
    stopAll,
    extractFeatured: extractAndCopyFeatured,
    extractAllTitles: extractAndCopyAllTitles,
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
    GM_registerMenuCommand('打开/隐藏 123AV 首页工具', togglePanel);
  }

  refresh();
  syncTimer = setInterval(() => {
    if (!rows.size && discoverSections().length) {
      refresh();
      return;
    }
    rows.forEach((state) => {
      const current = currentSection(state);
      if (current && !state.running) state.countElement.textContent = String(countCards(current.grid));
    });
  }, 1000);
  console.info('[123AV Home Tools] ready', {
    featured: extractFeaturedItems().length,
    sections: rows.size,
    labels: [...rows.values()].map((state) => state.title),
  });
})();
