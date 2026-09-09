(() => {
  'use strict';

  const core = globalThis.MissAVCodeFilterCore;
  if (!core) throw new Error('[Global Code Filter] core is missing');

  const HOST_ID = 'wjl-global-code-filter-host';
  const HAS_MENU_COMMAND = typeof GM_registerMenuCommand === 'function';
  const existing = globalThis.__wjlGlobalCodeFilter;
  if (existing && typeof existing.toggle === 'function') return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483647;pointer-events:none;all:initial;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      * { box-sizing: border-box; }
      .mcf-panel { pointer-events: auto; position: fixed; top: 14px; right: 14px; width: min(720px, calc(100vw - 28px)); max-height: calc(100vh - 28px); overflow: auto; color: #e5e7eb; background: rgba(15,23,42,.985); border: 1px solid #475569; border-radius: 14px; box-shadow: 0 18px 55px rgba(0,0,0,.5); font: 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
      .mcf-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #111827; border-bottom: 1px solid #334155; }
      .mcf-title strong { display: block; font-size: 15px; }
      .mcf-title small { color: #93c5fd; }
      .mcf-close { padding: 1px 8px; color: #cbd5e1; background: transparent; border: 0; font-size: 20px; cursor: pointer; }
      .mcf-body { padding: 12px; }
      .mcf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      label { display: block; min-width: 0; }
      .mcf-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; color: #cbd5e1; }
      textarea { display: block; width: 100%; min-height: 330px; padding: 9px; resize: vertical; color: #f8fafc; background: #0b1220; border: 1px solid #475569; border-radius: 8px; font: 12px/1.5 ui-monospace,Consolas,monospace; }
      textarea[readonly] { background: #101827; }
      .mcf-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
      button, .mcf-file-label { padding: 6px 10px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; cursor: pointer; font: inherit; }
      button:hover, .mcf-file-label:hover { filter: brightness(1.12); }
      .mcf-secondary { background: #475569; }
      .mcf-danger { background: #991b1b; }
      .mcf-file-label input { display: none; }
      .mcf-status { flex: 1; min-width: 180px; color: #93c5fd; text-align: right; }
      .mcf-status[data-kind="done"] { color: #86efac; }
      .mcf-status[data-kind="error"] { color: #fca5a5; }
      .mcf-note { margin-top: 9px; color: #94a3b8; font-size: 12px; }
      @media (max-width: 760px) { .mcf-grid { grid-template-columns: 1fr; } textarea { min-height: 210px; } }
    </style>
    <section class="mcf-panel" role="dialog" aria-label="全局番号过滤器">
      <div class="mcf-head">
        <div class="mcf-title"><strong>全局番号过滤器</strong><small>MissAV Manager v0.5.13 规则兼容</small></div>
        <button class="mcf-close" type="button" title="隐藏面板">×</button>
      </div>
      <div class="mcf-body">
        <div class="mcf-grid">
          <label><span class="mcf-label"><strong>原始文字</strong><small class="mcf-input-count">0 字符</small></span><textarea class="mcf-input" placeholder="在任何网页粘贴任意长度文字，或导入多个文件" spellcheck="false"></textarea></label>
          <label><span class="mcf-label"><strong>过滤后的番号</strong><small class="mcf-count">0 条 · 一行一个</small></span><textarea class="mcf-output" placeholder="识别结果会显示在这里" spellcheck="false" readonly></textarea></label>
        </div>
        <div class="mcf-actions">
          <label class="mcf-file-label">导入文件<input class="mcf-files" type="file" multiple accept=".txt,.html,.htm,.md,.json,.csv,.log,text/plain,text/html,text/csv,application/json"></label>
          <button class="mcf-run" type="button">执行过滤</button>
          <button class="mcf-copy mcf-secondary" type="button">复制结果</button>
          <button class="mcf-save mcf-secondary" type="button">下载 TXT</button>
          <button class="mcf-clear mcf-danger" type="button">清空</button>
          <span class="mcf-status">就绪</span>
        </div>
        <div class="mcf-note">独立于当前网站运行。输入只在当前标签页内存中处理；不读取网页正文，不联网，不保存历史。</div>
      </div>
    </section>
  `;
  (document.documentElement || document).appendChild(host);

  const input = shadow.querySelector('.mcf-input');
  const output = shadow.querySelector('.mcf-output');
  const count = shadow.querySelector('.mcf-count');
  const inputCount = shadow.querySelector('.mcf-input-count');
  const status = shadow.querySelector('.mcf-status');
  const files = shadow.querySelector('.mcf-files');
  let entries = [];
  let debounceTimer = null;

  function setStatus(text, kind) {
    status.textContent = text;
    status.dataset.kind = kind || '';
  }

  function updateInputCount() {
    inputCount.textContent = `${input.value.length.toLocaleString()} 字符`;
  }

  function filterNow(label) {
    clearTimeout(debounceTimer);
    updateInputCount();
    setStatus('正在过滤…');
    try {
      entries = core.parseInputEntries(input.value);
      output.value = entries.map(entry => entry.code).join('\n');
      const urlCount = entries.filter(entry => entry.sourceUrl).length;
      const firstLine = input.value.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
      let structured = false;
      if (firstLine.includes('title') && firstLine.includes('url') && firstLine.includes('folder') && firstLine.includes('cover')) {
        try { structured = core.isRaindropCsv(core.parseCSV(input.value)); } catch {}
      }
      count.textContent = `${entries.length.toLocaleString()} 条 · 一行一个${structured ? ' · Raindrop 结构化过滤' : ''}`;
      setStatus(`${label || '已识别'}：${entries.length.toLocaleString()} 条${urlCount ? ` · ${urlCount.toLocaleString()} 条保留可信 MissAV 链接` : ''}`, entries.length ? 'done' : '');
      return entries;
    } catch (error) {
      entries = [];
      output.value = '';
      count.textContent = '0 条 · 一行一个';
      setStatus(`过滤失败：${error.message || error}`, 'error');
      return [];
    }
  }

  function scheduleFilter() {
    clearTimeout(debounceTimer);
    updateInputCount();
    setStatus('等待输入完成…');
    debounceTimer = setTimeout(() => filterNow('手动输入'), input.value.length > 500000 ? 650 : 180);
  }

  async function importFiles(fileList) {
    const selected = [...fileList];
    if (!selected.length) return;
    setStatus(`正在读取 ${selected.length} 个文件…`);
    const results = await Promise.allSettled(selected.map(file => file.text()));
    const successful = [];
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') successful.push({ name: selected[index].name, text: result.value });
      else failed++;
    });
    if (!successful.length) {
      setStatus(`所选 ${selected.length} 个文件均读取失败`, 'error');
      files.value = '';
      return;
    }
    const merged = successful.map(item => item.text).join('\n\n');
    input.value = input.value.trimEnd() ? `${input.value.trimEnd()}\n\n${merged}` : merged;
    filterNow(successful.length === 1 ? successful[0].name : `${successful.length} 个文件${failed ? `（${failed} 个失败）` : ''}`);
    files.value = '';
  }

  async function copyResults() {
    filterNow('已识别');
    if (!output.value) { setStatus('没有可复制的番号', 'error'); return; }
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(output.value, 'text');
      else await navigator.clipboard.writeText(output.value);
      setStatus(`已复制 ${entries.length.toLocaleString()} 条`, 'done');
    } catch (error) { setStatus(`复制失败：${error.message || error}`, 'error'); }
  }

  function downloadResults() {
    filterNow('已识别');
    if (!output.value) { setStatus('没有可下载的番号', 'error'); return; }
    const now = new Date();
    const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), '_', String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')].join('');
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${stamp}_parsed_codes.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`已下载 ${entries.length.toLocaleString()} 条`, 'done');
  }

  function clearAll() {
    clearTimeout(debounceTimer);
    input.value = '';
    output.value = '';
    entries = [];
    updateInputCount();
    count.textContent = '0 条 · 一行一个';
    setStatus('已清空', '');
  }

  function showPanel() { host.style.display = 'block'; input.focus(); }
  function hidePanel() { host.style.display = 'none'; }
  function togglePanel() { if (host.style.display === 'none') showPanel(); else hidePanel(); }

  input.addEventListener('input', scheduleFilter);
  files.addEventListener('change', () => importFiles(files.files));
  shadow.querySelector('.mcf-run').addEventListener('click', () => filterNow('已识别'));
  shadow.querySelector('.mcf-copy').addEventListener('click', copyResults);
  shadow.querySelector('.mcf-save').addEventListener('click', downloadResults);
  shadow.querySelector('.mcf-clear').addEventListener('click', clearAll);
  shadow.querySelector('.mcf-close').addEventListener('click', hidePanel);

  globalThis.__wjlGlobalCodeFilter = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    filterText(text) {
      input.value = String(text || '');
      return filterNow('API 输入');
    },
    getEntries() { return entries.map(entry => ({ ...entry })); },
  };

  if (HAS_MENU_COMMAND) GM_registerMenuCommand('打开/隐藏 全局番号过滤器', togglePanel);
  if (!HAS_MENU_COMMAND) showPanel();
  console.info('[Global Code Filter] ready', core.version, location.href);
})();
