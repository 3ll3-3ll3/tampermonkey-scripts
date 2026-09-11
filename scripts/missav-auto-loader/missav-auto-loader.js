(() => {
  'use strict';

  console.info('[MissAV Auto Loader] v1.5.0 starting', location.href);

  const EXISTING = window.__missavAutoLoader;
  if (EXISTING?.show) {
    EXISTING.show();
    EXISTING.refresh();
    return;
  }

  const LOAD_MORE_TEXT = /^(?:load\s*more|加载更多|载入更多|載入更多|更多を読み込む|もっと見る)$/iu;
  const PLACEHOLDER_TITLE = /^(?:loading|loading\.\.\.|载入中|载入中…|加载中|加载中…)$/iu;
  const PANEL_ID = 'missav-auto-loader-panel';
  const LAUNCHER_ID = 'missav-auto-loader-launcher';
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
  let allTitlesStatus;
  let allTitlesOutput;
  let syncTimer;
  let uiObserver;
  let observedRoot;
  let panelVisible = !HAS_MENU_COMMAND;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizedText(element) {
    return (element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function loadMoreButtons() {
    return [...document.querySelectorAll('a, button')].filter((element) => {
      const label = normalizedText(element)
        || element.getAttribute('aria-label')
        || element.getAttribute('title')
        || '';
      if (LOAD_MORE_TEXT.test(label.trim())) return true;

      // MissAV occasionally changes the translated label. Its load control is
      // still a # link inside an absolutely positioned control immediately
      // after a titled card grid, so keep a structure-based fallback.
      const control = element.parentElement;
      const section = control?.previousElementSibling;
      return element.getAttribute('href') === '#'
        && Boolean(control?.classList.contains('absolute'))
        && Boolean(section?.querySelector('h1, h2, h3, h4, h5, h6'))
        && Boolean(section?.querySelector('.grid, [class*="grid-cols-"]'));
    });
  }

  function isRealCard(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches('template, script, style')) return false;
    const links = [...element.querySelectorAll('a[href]')];
    return links.some((link) => {
      const href = (link.getAttribute('href') || '').trim();
      return href && href !== '#' && !href.toLowerCase().startsWith('javascript:');
    });
  }

  function cardElements(grid) {
    if (!grid) return [];
    return [...grid.children].filter(isRealCard);
  }

  function countCards(grid) {
    return cardElements(grid).length;
  }

  function titleFromCard(card) {
    const textSelectors = [
      '.card-title', '.video-title', '[class*="title"]',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ];
    for (const selector of textSelectors) {
      const value = normalizedText(card.querySelector(selector));
      if (value) return value;
    }
    for (const link of card.querySelectorAll('a[href]')) {
      const value = normalizedText(link);
      if (value && !LOAD_MORE_TEXT.test(value)) return value;
    }
    for (const element of card.querySelectorAll('[data-title], [title], img[alt]')) {
      const value = element.getAttribute('data-title')
        || element.getAttribute('title')
        || element.getAttribute('alt')
        || '';
      if (value.trim()) return value.replace(/\s+/g, ' ').trim();
    }
    return normalizedText(card);
  }

  function extractTitles(grid) {
    return cardElements(grid).map(titleFromCard).filter(Boolean);
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
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
      console.error('[MissAV Auto Loader] copy failed', error);
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
      console.error('[MissAV Auto Loader] copy all failed', error);
      allTitlesStatus.textContent = `已汇总 ${titles.length} 条标题，但自动复制失败`;
      allTitlesStatus.dataset.kind = 'error';
    }
    return titles;
  }

  function findSectionContainer(button) {
    const control = button.parentElement;
    let candidate = control?.previousElementSibling || null;

    if (candidate?.querySelector('h1, h2, h3, h4, h5, h6')) return candidate;

    let sibling = control?.previousElementSibling || null;
    while (sibling) {
      if (sibling.querySelector?.('h1, h2, h3, h4, h5, h6')) return sibling;
      sibling = sibling.previousElementSibling;
    }
    return null;
  }

  function bestGrid(section) {
    const candidates = [
      ...section.querySelectorAll('.grid, [class*="grid-cols-"]'),
    ];
    if (!candidates.length) return null;
    return candidates.sort((a, b) => countCards(b) - countCards(a))[0];
  }

  function discoverSections() {
    const titleCounts = new Map();
    return loadMoreButtons()
      .map((button, index) => {
        const section = findSectionContainer(button);
        const heading = section?.querySelector('h1, h2, h3, h4, h5, h6');
        const title = normalizedText(heading) || '未命名板块';
        const grid = section ? bestGrid(section) : null;
        if (!section || !grid) return null;

        const ordinal = (titleCounts.get(title) || 0) + 1;
        titleCounts.set(title, ordinal);
        return {
          key: `section::${index + 1}`,
          title: ordinal === 1 ? title : `${title} (${ordinal})`,
          rawTitle: title,
          ordinal,
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
      if (state.titleElement && !PLACEHOLDER_TITLE.test(found.title) && state.title !== found.title) {
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
      console.error('[MissAV Auto Loader]', error);
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
      <div class="mal-result-actions">
        <button class="mal-copy" type="button">提取并复制标题</button>
      </div>
      <div class="mal-result-status">尚未提取标题</div>
      <textarea class="mal-output" readonly hidden></textarea>
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
      titleElement,
      running: false,
      queued: false,
      cancelRequested: false,
      lastGrid: section.grid,
      countElement,
      targetInput,
      statusElement: row.querySelector('.mal-status'),
      resultElement: row.querySelector('.mal-result-status'),
      outputElement: row.querySelector('.mal-output'),
      startButton: row.querySelector('.mal-start'),
      stopButton: row.querySelector('.mal-stop'),
      copyButton: row.querySelector('.mal-copy'),
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
    uiObserver?.disconnect();
    document.removeEventListener('keydown', onWakeHotkey, true);
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(LAUNCHER_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    delete window.__missavAutoLoader;
  }

  function ensureUiAttached() {
    if (destroyed) return;
    const root = document.documentElement;
    if (!root) return;

    if (!style.isConnected) (document.head || root).appendChild(style);
    if (!panel.isConnected) root.appendChild(panel);
    if (!launcher.isConnected) root.appendChild(launcher);
    panel.style.setProperty('display', panelVisible ? 'block' : 'none', 'important');
    launcher.style.setProperty('display', panelVisible ? 'none' : 'block', 'important');

    if (observedRoot !== root) {
      uiObserver?.disconnect();
      observedRoot = root;
      uiObserver = new MutationObserver(() => {
        if (!style.isConnected || !panel.isConnected) queueMicrotask(ensureUiAttached);
      });
      uiObserver.observe(root, { childList: true, subtree: true });
    }
  }

  function showPanel() {
    panelVisible = true;
    ensureUiAttached();
    refresh();
  }

  function hidePanel() {
    stopAll();
    panelVisible = false;
    panel.style.setProperty('display', 'none', 'important');
    launcher.style.setProperty('display', 'block', 'important');
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  function onWakeHotkey(event) {
    if (!event.altKey || !event.shiftKey || event.code !== 'KeyL') return;
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${LAUNCHER_ID} { all: initial; position: fixed; top: 12px; right: 12px; z-index: 2147483647; padding: 7px 11px; color: #fff; background: #2563eb; border: 1px solid #60a5fa; border-radius: 9px; box-shadow: 0 8px 24px rgba(0,0,0,.35); cursor: pointer; font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
    #${LAUNCHER_ID}:hover { filter: brightness(1.12); }
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
    #${PANEL_ID} .mal-result-actions { margin-top: 7px; }
    #${PANEL_ID} .mal-copy, #${PANEL_ID} .mal-copy-all { background: #0f766e; }
    #${PANEL_ID} .mal-result-status, #${PANEL_ID} .mal-all-status { margin-top: 6px; color: #93c5fd; font-size: 12px; }
    #${PANEL_ID} [data-kind="done"] { color: #86efac; }
    #${PANEL_ID} [data-kind="error"] { color: #fca5a5; }
    #${PANEL_ID} .mal-output, #${PANEL_ID} .mal-all-output { width: 100%; min-height: 92px; margin-top: 6px; padding: 7px; resize: vertical; color: #e5e7eb; background: #0f172a; border: 1px solid #475569; border-radius: 6px; font: 12px/1.45 ui-monospace, Consolas, monospace; }
    #${PANEL_ID} .mal-all-results { padding: 9px; margin-top: 9px; background: #172033; border: 1px solid #334155; border-radius: 9px; }
    #${PANEL_ID} .mal-note, #${PANEL_ID} .mal-empty { margin-top: 9px; color: #94a3b8; font-size: 12px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  const launcher = document.createElement('button');
  launcher.id = LAUNCHER_ID;
  launcher.type = 'button';
  launcher.textContent = 'Load More';
  launcher.title = '打开 MissAV Load More 面板（Alt+Shift+L）';
  launcher.style.setProperty('display', panelVisible ? 'none' : 'block', 'important');
  launcher.addEventListener('click', showPanel);

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.style.setProperty('display', panelVisible ? 'block' : 'none', 'important');
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
      <div class="mal-all-results">
        <button class="mal-copy-all" type="button">汇总并复制全部标题</button>
        <div class="mal-all-status">“全部开始”完成后会自动汇总并复制</div>
        <textarea class="mal-all-output" readonly hidden></textarea>
      </div>
      <div class="mal-note">按卡片总数停止；完成后自动提取并复制标题。多个板块串行加载，“全部开始”结束后复制所有板块标题。</div>
    </div>
  `;
  document.documentElement.appendChild(panel);

  intervalInput = panel.querySelector('.mal-interval input');
  listElement = panel.querySelector('.mal-list');
  summaryElement = panel.querySelector('.mal-summary');
  allTitlesStatus = panel.querySelector('.mal-all-status');
  allTitlesOutput = panel.querySelector('.mal-all-output');
  panel.querySelector('.mal-start-all').addEventListener('click', enqueueAll);
  panel.querySelector('.mal-stop-all').addEventListener('click', stopAll);
  panel.querySelector('.mal-refresh').addEventListener('click', refresh);
  panel.querySelector('.mal-copy-all').addEventListener('click', extractAndCopyAllTitles);
  panel.querySelector('.mal-close').addEventListener('click', hidePanel);
  document.addEventListener('keydown', onWakeHotkey, true);

  window.__missavAutoLoader = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    refresh,
    stopAll,
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
    GM_registerMenuCommand('打开/隐藏 MissAV Load More 面板（Alt+Shift+L）', togglePanel);
  }

  ensureUiAttached();
  refresh();
  syncTimer = setInterval(() => {
    ensureUiAttached();
    rows.forEach((state) => {
      const current = currentSection(state);
      if (current && !state.running) state.countElement.textContent = String(countCards(current.grid));
    });
  }, 500);
  console.info('[MissAV Auto Loader] ready', {
    sections: rows.size,
    labels: [...rows.values()].map((state) => state.title),
  });
})();
