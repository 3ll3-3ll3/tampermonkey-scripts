// ==UserScript==
// @name         LoveAV MissAV 最新脚本启动器
// @namespace    wjl.local
// @version      1.1.0
// @description  从已授权的 LoveAV results 目录扫描并运行最新的项目目录模式 MissAV 浏览器脚本。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @match        https://missav.ws/*
// @match        https://*.missav.ws/*
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-missav-runner/loveav-missav-runner.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-missav-runner/loveav-missav-runner.user.js
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const EXISTING = window.__loveavMissavRunner;
  if (EXISTING?.show) {
    EXISTING.show();
    return;
  }

  const HOST_ID = 'loveav-missav-runner-host';
  const DB_NAME = 'loveav-missav-workspace-v1';
  const STORE_NAME = 'directory-handles';
  const DIRECTORY_KEY = 'results-directory';
  const PICKER_ID = 'loveav-missav-results';
  const PATH_HINT = 'E:\\Desktop\\codex项目\\LoveAV-Data\\missav\\results';
  const SCRIPT_NAME_RE = /_missav-browser-script\.js$/i;
  const MAX_DEPTH = 5;
  const state = {
    handle: null,
    latest: null,
    busy: false,
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开工作目录配置。'));
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
    if (!candidates.length) {
      throw new Error('授权目录中没有找到 *_missav-browser-script.js。');
    }
    return candidates[0];
  }

  function inspectScript(source, entryPath) {
    const codeBlock = source.match(/const\s+CODE_TEXT\s*=\s*`([\s\S]*?)`\.trim\(\);/);
    const required = [
      'REFERENCE_ACTRESS_TAGS',
      'RAINDROP_EXPORT_BLACKLIST_TAGS',
      'MissAV 导入脚本启动面板',
      'LOVEAV_DEFAULT_RESULTS_PATH_HINT',
      '为避免文件落入浏览器 Downloads',
      'await createOutputDirectory(state.baseDirHandle)',
    ];
    const hasOrdinaryDownloadFallback = source.includes('a.download = filename');
    if (!/^\s*\(async\s*\(\)\s*=>/.test(source) || !codeBlock || required.some((value) => !source.includes(value)) || hasOrdinaryDownloadFallback) {
      throw new Error(`文件不是新版项目目录模式的 LoveAV MissAV 浏览器脚本，请用当前 Skill 重新生成：${entryPath}`);
    }
    const codes = codeBlock[1].split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    return { codes: new Set(codes.map((value) => value.toUpperCase())).size };
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #launcher { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; padding: 9px 13px; border: 1px solid #818cf8; border-radius: 10px; color: #fff; background: #4f46e5; box-shadow: 0 8px 28px rgba(0,0,0,.4); cursor: pointer; font: 600 13px/1.2 system-ui, "Segoe UI", sans-serif; }
      #panel { position: fixed; right: 16px; bottom: 60px; z-index: 2147483647; width: min(420px, calc(100vw - 32px)); padding: 14px; border: 1px solid #475569; border-radius: 12px; color: #e5e7eb; background: rgba(15,23,42,.98); box-shadow: 0 16px 50px rgba(0,0,0,.5); font: 13px/1.45 system-ui, "Segoe UI", sans-serif; }
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
      button:disabled { cursor: default; opacity: .45; }
      .hint { margin-top: 9px; color: #94a3b8; font-size: 12px; }
    </style>
    <button id="launcher" type="button">运行 LoveAV</button>
    <section id="panel" hidden>
      <h2>LoveAV MissAV 最新脚本</h2>
      <div id="details">尚未扫描。</div>
      <div id="status">首次使用请选择 results 目录。</div>
      <div class="actions">
        <button id="scan" type="button">扫描最新脚本</button>
        <button id="run" class="run" type="button" disabled>运行最新脚本</button>
        <button id="change" class="secondary" type="button">更换目录</button>
        <button id="close" class="secondary" type="button">收起</button>
      </div>
      <div class="hint">默认目录：${PATH_HINT}<br>只运行新版项目目录模式脚本；不会把结果写入浏览器 Downloads。</div>
    </section>
  `;

  const launcher = shadow.querySelector('#launcher');
  const panel = shadow.querySelector('#panel');
  const details = shadow.querySelector('#details');
  const status = shadow.querySelector('#status');
  const scanButton = shadow.querySelector('#scan');
  const runButton = shadow.querySelector('#run');
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

  function show() {
    panel.hidden = false;
  }

  function hide() {
    panel.hidden = true;
  }

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
      details.textContent = [
        `文件：${latest.entryPath}`,
        `修改时间：${new Date(latest.file.lastModified).toLocaleString('zh-CN')}`,
        `番号：${inspection.codes} 个`,
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
      const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'readwrite' });
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
      const permission = await state.handle.requestPermission({ mode: 'readwrite' });
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
    setBusy(true);
    setStatus('正在启动 LoveAV 脚本……');
    try {
      const safeName = state.latest.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const execute = new Function(`return ${state.latest.source}\n//# sourceURL=${safeName}`);
      await Promise.resolve(execute());
      setStatus('脚本已启动，请在 MissAV 导入面板继续。', 'done');
    } catch (error) {
      console.error('[LoveAV MissAV Runner]', error);
      setStatus(`运行失败：${error?.message || error}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function ensureAttached() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  launcher.addEventListener('click', () => {
    show();
    if (!state.latest) scan();
  });
  scanButton.addEventListener('click', scan);
  runButton.addEventListener('click', runLatest);
  changeButton.addEventListener('click', chooseDirectory);
  shadow.querySelector('#close').addEventListener('click', hide);

  const observer = new MutationObserver(ensureAttached);
  observer.observe(document.documentElement, { childList: true });
  ensureAttached();

  window.__loveavMissavRunner = {
    show,
    hide,
    scan,
    status: () => ({
      directory: state.handle?.name || null,
      latest: state.latest?.entryPath || null,
      codes: state.latest?.inspection?.codes || 0,
      busy: state.busy,
    }),
  };

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开 LoveAV MissAV 最新脚本启动器', show);
  }

  readRememberedHandle()
    .then((handle) => {
      state.handle = handle;
      setStatus(handle ? `已记住目录：${handle.name}` : '首次使用请选择 results 目录。');
    })
    .catch((error) => setStatus(`读取目录配置失败：${error?.message || error}`, 'error'));
})();
