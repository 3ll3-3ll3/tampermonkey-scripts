// ==UserScript==
// @name         LoveAV Whos.tv 最新脚本启动器
// @namespace    wjl.local
// @version      1.0.0
// @description  从已授权目录扫描、校验并运行最新 LoveAV Whos.tv 抓取脚本。
// @match        https://whos.tv/*
// @match        https://*.whos.tv/*
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-whostv-runner/loveav-whostv-runner.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-whostv-runner/loveav-whostv-runner.user.js
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME_RE = /^whostv_(?:incremental|pages_[0-9]+_[0-9]+)_[0-9]{8}-[0-9]{6}\.js$/i;
  const REQUIRED_MARKERS = [
    "const runtimeKey = '__whosTvScrapeRuntime'",
    "pageUrl.searchParams.set('tab', 'solved')",
    "credentials: 'include'",
    "cache: 'no-store'",
    'runtimeScope.cancelWhosTvScrape = () =>',
  ];

  function inspectScript(source, entryPath = '') {
    if (!SCRIPT_NAME_RE.test(entryPath.split('/').at(-1) || '')) {
      throw new Error(`文件名不符合 LoveAV Whos.tv 生成规则：${entryPath}`);
    }
    if (!/^\s*\(async\s*\(\)\s*=>/.test(source) || REQUIRED_MARKERS.some((value) => !source.includes(value))) {
      throw new Error(`文件不是经过校验的 LoveAV Whos.tv 抓取脚本：${entryPath}`);
    }
    const configMatch = source.match(/const\s+CONFIG\s*=\s*(\{[\s\S]*?\});\s*const\s+runtimeScope/);
    if (!configMatch) throw new Error('脚本缺少可校验的 CONFIG。');
    let config;
    try {
      config = JSON.parse(configMatch[1]);
    } catch (error) {
      throw new Error(`脚本 CONFIG 不是有效 JSON：${error?.message || error}`);
    }
    if (!['incremental', 'pages'].includes(config.mode)) throw new Error(`不支持的脚本模式：${config.mode}`);
    if (!/^whos_tv_solved_answers_[a-z0-9_-]+\.json$/i.test(String(config.outputFile || ''))) {
      throw new Error('输出 JSON 文件名不符合 Whos.tv 规则。');
    }
    if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 120000) {
      throw new Error('请求超时参数超出安全范围。');
    }
    if (!Number.isInteger(config.delayMs) || config.delayMs < 200 || config.delayMs > 10000) {
      throw new Error('页间延时参数超出安全范围。');
    }
    if (config.mode === 'incremental') {
      if (!/^\/helps\/\d+$/.test(String(config.cutoffPath || ''))) throw new Error('增量截止帖无效。');
      if (!/^whostv_incremental_/i.test(entryPath.split('/').at(-1) || '')) throw new Error('脚本模式与文件名不一致。');
    } else {
      if (!Number.isInteger(config.fromPage) || config.fromPage !== 1 || !Number.isInteger(config.toPage) || config.toPage < 1) {
        throw new Error('指定页模式只允许第 1-n 页。');
      }
      if (!/^whostv_pages_/i.test(entryPath.split('/').at(-1) || '')) throw new Error('脚本模式与文件名不一致。');
    }
    return { config };
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { inspectScript, SCRIPT_NAME_RE };
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const existing = window.__loveavWhosTvRunner;
  if (existing?.show) {
    existing.show();
    return;
  }

  const HOST_ID = 'loveav-whostv-runner-host';
  const DB_NAME = 'loveav-whostv-runner-v1';
  const STORE_NAME = 'directory-handles';
  const DIRECTORY_KEY = 'generated-directory';
  const PICKER_ID = 'loveav-whostv-generated';
  const PATH_HINT = 'E:\\Desktop\\codex项目\\whostv-current\\脚本归档\\generated';
  const MAX_DEPTH = 2;
  const state = { handle: null, latest: null, busy: false };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开 Whos.tv 脚本目录配置。'));
    });
  }

  async function readRememberedHandle() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DIRECTORY_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('无法读取已保存目录。'));
      });
    } finally {
      db.close();
    }
  }

  async function rememberHandle(handle) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(handle, DIRECTORY_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法保存目录授权。'));
        transaction.onabort = () => reject(transaction.error || new Error('保存目录授权已取消。'));
      });
    } finally {
      db.close();
    }
  }

  async function findLatestScript(directoryHandle) {
    const candidates = [];
    async function walk(handle, relativePath = '', depth = 0) {
      for await (const entry of handle.values()) {
        const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.kind === 'file' && SCRIPT_NAME_RE.test(entry.name)) {
          const file = await entry.getFile();
          candidates.push({ file, entryPath });
        } else if (entry.kind === 'directory' && depth < MAX_DEPTH) {
          await walk(entry, entryPath, depth + 1);
        }
      }
    }
    await walk(directoryHandle);
    candidates.sort((left, right) => {
      const time = Number(right.file.lastModified || 0) - Number(left.file.lastModified || 0);
      return time || right.entryPath.localeCompare(left.entryPath, 'zh-Hans-CN');
    });
    if (!candidates.length) throw new Error('授权目录中没有找到 LoveAV 生成的 Whos.tv 脚本。');
    return candidates[0];
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #launcher { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; padding: 9px 13px; border: 1px solid #38bdf8; border-radius: 10px; color: #fff; background: #0369a1; box-shadow: 0 8px 28px rgba(0,0,0,.4); cursor: pointer; font: 600 13px/1.2 system-ui, "Segoe UI", sans-serif; }
      #panel { position: fixed; right: 16px; bottom: 60px; z-index: 2147483647; width: min(440px, calc(100vw - 32px)); padding: 14px; border: 1px solid #475569; border-radius: 12px; color: #e5e7eb; background: rgba(15,23,42,.98); box-shadow: 0 16px 50px rgba(0,0,0,.5); font: 13px/1.45 system-ui, "Segoe UI", sans-serif; }
      #panel[hidden] { display: none; }
      h2 { margin: 0 0 10px; font-size: 15px; color: #fff; }
      #details { padding: 9px; border-radius: 8px; background: #111827; overflow-wrap: anywhere; white-space: pre-wrap; }
      #status { margin: 9px 0; color: #93c5fd; }
      #status[data-kind="error"] { color: #fca5a5; }
      #status[data-kind="done"] { color: #86efac; }
      .actions { display: flex; flex-wrap: wrap; gap: 7px; }
      button { padding: 6px 10px; border: 0; border-radius: 7px; color: #fff; background: #2563eb; cursor: pointer; font: inherit; }
      button.secondary { background: #475569; }
      button.run { background: #16a34a; }
      button.cancel { background: #b91c1c; }
      button:disabled { cursor: default; opacity: .45; }
      .hint { margin-top: 9px; color: #94a3b8; font-size: 12px; }
    </style>
    <button id="launcher" type="button">运行 Whos.tv</button>
    <section id="panel" hidden>
      <h2>LoveAV Whos.tv 最新脚本</h2>
      <div id="details">尚未扫描。</div>
      <div id="status">首次使用请选择 generated 目录。</div>
      <div class="actions">
        <button id="scan" type="button">扫描最新脚本</button>
        <button id="run" class="run" type="button" disabled>运行最新脚本</button>
        <button id="cancel" class="cancel" type="button">取消抓取</button>
        <button id="change" class="secondary" type="button">更换目录</button>
        <button id="close" class="secondary" type="button">收起</button>
      </div>
      <div class="hint">默认目录：${PATH_HINT}<br>脚本由 LoveAV 生成；运行进度仍逐条显示在开发者工具 Console 中。</div>
    </section>
  `;

  const panel = shadow.querySelector('#panel');
  const details = shadow.querySelector('#details');
  const status = shadow.querySelector('#status');
  const scanButton = shadow.querySelector('#scan');
  const runButton = shadow.querySelector('#run');
  const cancelButton = shadow.querySelector('#cancel');
  const changeButton = shadow.querySelector('#change');

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setBusy(value) {
    state.busy = value;
    scanButton.disabled = value;
    changeButton.disabled = value;
    runButton.disabled = value || !state.latest;
  }

  function show() { panel.hidden = false; }
  function hide() { panel.hidden = true; }

  async function scanWithHandle(handle) {
    setBusy(true);
    state.latest = null;
    setStatus('正在扫描最新脚本……');
    details.textContent = '扫描中……';
    try {
      const latest = await findLatestScript(handle);
      const source = await latest.file.text();
      const inspection = inspectScript(source, latest.entryPath);
      const hash = await sha256(source);
      state.latest = { ...latest, source, inspection, hash };
      const config = inspection.config;
      const range = config.mode === 'incremental'
        ? `增量；遇到 ${config.cutoffPath} 停止且不收录`
        : `指定页；第 ${config.fromPage}-${config.toPage} 页`;
      details.textContent = [
        `文件：${latest.entryPath}`,
        `修改时间：${new Date(latest.file.lastModified).toLocaleString('zh-CN')}`,
        `模式：${range}`,
        `输出：${config.outputFile}`,
        `SHA-256：${hash}`,
      ].join('\n');
      setStatus('已找到并校验最新脚本，可以运行。', 'done');
    } catch (error) {
      details.textContent = '没有可运行的脚本。';
      setStatus(`扫描失败：${error?.message || error}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function chooseDirectory() {
    if (!window.showDirectoryPicker) {
      setStatus('当前浏览器不支持目录授权，请使用最新版 Chrome。', 'error');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' });
      state.handle = handle;
      await rememberHandle(handle);
      await scanWithHandle(handle);
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus(`目录授权失败：${error?.message || error}`, 'error');
    }
  }

  async function scan() {
    show();
    if (!state.handle) {
      await chooseDirectory();
      return;
    }
    try {
      const permission = await state.handle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') {
        setStatus('目录权限未授予，请点击“更换目录”。', 'error');
        return;
      }
      await scanWithHandle(state.handle);
    } catch (error) {
      setStatus(`目录权限检查失败：${error?.message || error}`, 'error');
    }
  }

  async function runLatest() {
    if (!state.latest || state.busy) return;
    if (window.__whosTvScrapeRuntime?.active) {
      setStatus('已有抓取正在运行；可点击“取消抓取”。', 'error');
      return;
    }
    setBusy(true);
    setStatus('抓取运行中；逐条进度请查看 Console，可随时点击“取消抓取”。');
    try {
      const safeName = state.latest.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const execute = new Function(`return ${state.latest.source}\n//# sourceURL=${safeName}`);
      await Promise.resolve(execute());
      setStatus(`运行完成，浏览器应已下载 ${state.latest.inspection.config.outputFile}。`, 'done');
    } catch (error) {
      console.error('[LoveAV Whos.tv Runner]', error);
      const cancelled = /取消/.test(String(error?.message || error));
      setStatus(cancelled ? '抓取已取消，没有下载部分 JSON。' : `运行失败：${error?.message || error}`, cancelled ? '' : 'error');
    } finally {
      setBusy(false);
    }
  }

  function cancelRun() {
    const cancel = window.cancelWhosTvScrape;
    if (typeof cancel !== 'function' || !window.__whosTvScrapeRuntime?.active) {
      setStatus('当前没有正在运行的 Whos.tv 抓取。');
      return;
    }
    cancel();
    setStatus('已请求安全取消；脚本会停止且不下载部分 JSON。');
  }

  function ensureAttached() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  shadow.querySelector('#launcher').addEventListener('click', () => {
    show();
    if (!state.latest) scan();
  });
  scanButton.addEventListener('click', scan);
  runButton.addEventListener('click', runLatest);
  cancelButton.addEventListener('click', cancelRun);
  changeButton.addEventListener('click', chooseDirectory);
  shadow.querySelector('#close').addEventListener('click', hide);

  const observer = new MutationObserver(ensureAttached);
  observer.observe(document.documentElement, { childList: true });
  ensureAttached();

  window.__loveavWhosTvRunner = {
    show,
    hide,
    scan,
    cancel: cancelRun,
    status: () => ({
      directory: state.handle?.name || null,
      latest: state.latest?.entryPath || null,
      mode: state.latest?.inspection?.config?.mode || null,
      output: state.latest?.inspection?.config?.outputFile || null,
      busy: state.busy,
    }),
  };

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开 LoveAV Whos.tv 最新脚本启动器', show);
  }

  readRememberedHandle()
    .then((handle) => {
      state.handle = handle;
      setStatus(handle ? `已记住目录：${handle.name}` : '首次使用请选择 generated 目录。');
    })
    .catch((error) => setStatus(`读取目录配置失败：${error?.message || error}`, 'error'));
})();
