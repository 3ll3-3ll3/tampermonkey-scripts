(() => {
  'use strict';

  const core = globalThis.MissAVCodeFilterCore;
  if (!core) throw new Error('[MissAV Code Filter] core is missing');

  const PANEL_ID = 'missav-code-filter-panel';
  const STYLE_ID = 'missav-code-filter-style';
  const HAS_MENU_COMMAND = typeof GM_registerMenuCommand === 'function';
  const existing = globalThis.__missavCodeFilter;
  if (existing && typeof existing.show === 'function') {
    existing.show();
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} { position: fixed; top: 14px; right: 14px; z-index: 2147483647; width: min(620px, calc(100vw - 28px)); max-height: calc(100vh - 28px); overflow: auto; color: #e5e7eb; background: rgba(15,23,42,.98); border: 1px solid #475569; border-radius: 14px; box-shadow: 0 18px 55px rgba(0,0,0,.5); font: 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${PANEL_ID} .mcf-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #111827; border-bottom: 1px solid #334155; }
    #${PANEL_ID} .mcf-title strong { display: block; font-size: 15px; }
    #${PANEL_ID} .mcf-title small { color: #93c5fd; }
    #${PANEL_ID} .mcf-close { padding: 1px 8px; color: #cbd5e1; background: transparent; border: 0; font-size: 20px; cursor: pointer; }
    #${PANEL_ID} .mcf-body { padding: 12px; }
    #${PANEL_ID} .mcf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    #${PANEL_ID} label { display: block; min-width: 0; }
    #${PANEL_ID} .mcf-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; color: #cbd5e1; }
    #${PANEL_ID} textarea { display: block; width: 100%; min-height: 290px; padding: 9px; resize: vertical; color: #f8fafc; background: #0b1220; border: 1px solid #475569; border-radius: 8px; font: 12px/1.5 ui-monospace,Consolas,monospace; }
    #${PANEL_ID} textarea[readonly] { background: #101827; }
    #${PANEL_ID} .mcf-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
    #${PANEL_ID} button, #${PANEL_ID} .mcf-file-label { padding: 6px 10px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; cursor: pointer; font: inherit; }
    #${PANEL_ID} button:hover, #${PANEL_ID} .mcf-file-label:hover { filter: brightness(1.12); }
    #${PANEL_ID} .mcf-secondary { background: #475569; }
    #${PANEL_ID} .mcf-danger { background: #991b1b; }
    #${PANEL_ID} .mcf-file-label input { display: none; }
    #${PANEL_ID} .mcf-status { flex: 1; min-width: 180px; color: #93c5fd; text-align: right; }
    #${PANEL_ID} .mcf-status[data-kind="done"] { color: #86efac; }
    #${PANEL_ID} .mcf-status[data-kind="error"] { color: #fca5a5; }
    #${PANEL_ID} .mcf-note { margin-top: 9px; color: #94a3b8; font-size: 12px; }
    @media (max-width: 720px) { #${PANEL_ID} .mcf-grid { grid-template-columns: 1fr; } #${PANEL_ID} textarea { min-height: 190px; } }
  `;
  (document.head || document.documentElement).appendChild(style);

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.style.display = HAS_MENU_COMMAND ? 'none' : 'block';
  panel.innerHTML = `
    <div class="mcf-head">
      <div class="mcf-title"><strong>MissAV 番号过滤器</strong><small>v0.5.13 规则兼容</small></div>
      <button class="mcf-close" type="button" title="隐藏面板">×</button>
    </div>
    <div class="mcf-body">
      <div class="mcf-grid">
        <label><span class="mcf-label"><strong>原始文字</strong><small>粘贴或导入多个文件</small></span><textarea class="mcf-input" placeholder="粘贴 TG、网页、HTML、Markdown、MissAV 链接或番号" spellcheck="false"></textarea></label>
        <label><span class="mcf-label"><strong>过滤后的番号</strong><small class="mcf-count">0 条 · 一行一个</small></span><textarea class="mcf-output" placeholder="识别结果会自动显示在这里" spellcheck="false" readonly></textarea></label>
      </div>
      <div class="mcf-actions">
        <label class="mcf-file-label">导入文件<input class="mcf-files" type="file" multiple accept=".txt,.html,.htm,.md,.json,.csv,.log,text/plain,text/html,text/csv,application/json"></label>
        <button class="mcf-run" type="button">执行过滤</button>
        <button class="mcf-copy mcf-secondary" type="button">复制结果</button>
        <button class="mcf-save mcf-secondary" type="button">下载 TXT</button>
        <button class="mcf-clear mcf-danger" type="button">清空</button>
        <span class="mcf-status">就绪</span>
      </div>
      <div class="mcf-note">只在本页本地处理输入，不联网、不保存历史、不读取账号、Cookie 或浏览器存储。</div>
    </div>
  `;
  (document.body || document.documentElement).appendChild(panel);

  const input = panel.querySelector('.mcf-input');
  const output = panel.querySelector('.mcf-output');
  const count = panel.querySelector('.mcf-count');
  const status = panel.querySelector('.mcf-status');
  const files = panel.querySelector('.mcf-files');
  let entries = [];
  let debounceTimer = null;

  function setStatus(text, kind) {
    status.textContent = text;
    status.dataset.kind = kind || '';
  }

  function filterNow(label) {
    try {
      entries = core.parseInputEntries(input.value);
      output.value = entries.map(entry => entry.code).join('\n');
      const urlCount = entries.filter(entry => entry.sourceUrl).length;
      const firstLine = input.value.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
      let structured = false;
      if (firstLine.includes('title') && firstLine.includes('url') && firstLine.includes('folder') && firstLine.includes('cover')) {
        try { structured = core.isRaindropCsv(core.parseCSV(input.value)); } catch {}
      }
      count.textContent = `${entries.length} 条 · 一行一个${structured ? ' · Raindrop 结构化过滤' : ''}`;
      setStatus(`${label || '已识别'}：${entries.length} 条${urlCount ? ` · ${urlCount} 条保留可信 MissAV 链接` : ''}`, entries.length ? 'done' : '');
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
    debounceTimer = setTimeout(() => filterNow('手动输入'), 120);
  }

  async function importFiles(fileList) {
    const selected = [...fileList];
    if (!selected.length) return;
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
      setStatus(`已复制 ${entries.length} 条`, 'done');
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
    setStatus(`已下载 ${entries.length} 条`, 'done');
  }

  function clearAll() {
    clearTimeout(debounceTimer);
    input.value = '';
    output.value = '';
    entries = [];
    count.textContent = '0 条 · 一行一个';
    setStatus('已清空', '');
  }

  function showPanel() { panel.style.display = 'block'; input.focus(); }
  function hidePanel() { panel.style.display = 'none'; }
  function togglePanel() { if (panel.style.display === 'none') showPanel(); else hidePanel(); }

  input.addEventListener('input', scheduleFilter);
  files.addEventListener('change', () => importFiles(files.files));
  panel.querySelector('.mcf-run').addEventListener('click', () => filterNow('已识别'));
  panel.querySelector('.mcf-copy').addEventListener('click', copyResults);
  panel.querySelector('.mcf-save').addEventListener('click', downloadResults);
  panel.querySelector('.mcf-clear').addEventListener('click', clearAll);
  panel.querySelector('.mcf-close').addEventListener('click', hidePanel);

  globalThis.__missavCodeFilter = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    filterText(text) {
      input.value = String(text || '');
      return filterNow('API 输入');
    },
    getEntries() { return entries.map(entry => ({ ...entry })); },
  };

  if (HAS_MENU_COMMAND) GM_registerMenuCommand('打开/隐藏 MissAV 番号过滤器', togglePanel);
  console.info('[MissAV Code Filter] ready', core.version);
})();
