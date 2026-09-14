'use strict';

const core = globalThis.MissAVCodeFilterCore;
if (!core) throw new Error('过滤核心加载失败');
const resolver = globalThis.LoveAVMissAVResolver;
if (!resolver) throw new Error('MissAV 解析核心加载失败');
const loveavCore = globalThis.LoveAVCore;
if (!loveavCore) throw new Error('LoveAV 分类核心加载失败');

const source = document.querySelector('#source');
const result = document.querySelector('#result');
const files = document.querySelector('#files');
const sourceChars = document.querySelector('#source-chars');
const resultCount = document.querySelector('#result-count');
const trustedCount = document.querySelector('#trusted-count');
const formatNote = document.querySelector('#format-note');
const status = document.querySelector('#status');
const autoFilter = document.querySelector('#auto-filter');
const dropZone = document.querySelector('#drop-zone');
let entries = [];
let filterTimer = null;
const manualMode = document.querySelector('#manual-mode');
const manualRun = document.querySelector('#manual-run');
const manualStop = document.querySelector('#manual-stop');
const manualProgress = document.querySelector('#manual-progress');
const manualProgressText = document.querySelector('#manual-progress-text');
const manualLog = document.querySelector('#manual-log');
const manualStats = Object.fromEntries([...document.querySelectorAll('[data-manual-stat]')].map((element) => [element.dataset.manualStat, element]));
let manualRunning = false;
let manualController = null;

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setLocal(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function getSession(keys) {
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve));
}

function removeSession(keys) {
  return new Promise((resolve) => chrome.storage.session.remove(keys, resolve));
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || '扩展后台没有响应'));
      else resolve(response);
    });
  });
}

function setStatus(text, kind = '') {
  status.textContent = text;
  status.dataset.kind = kind;
}

function updateSourceCount() {
  sourceChars.textContent = source.value.length.toLocaleString();
}

function detectStructuredInput(text) {
  const firstLine = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  if (!firstLine.includes('title') || !firstLine.includes('url') || !firstLine.includes('folder') || !firstLine.includes('cover')) return false;
  try { return core.isRaindropCsv(core.parseCSV(text)); } catch { return false; }
}

function filterNow(label = '已识别') {
  clearTimeout(filterTimer);
  updateSourceCount();
  setStatus('正在过滤…');
  try {
    entries = core.parseInputEntries(source.value);
    result.value = entries.map((entry) => entry.code).join('\n');
    const trusted = entries.filter((entry) => entry.sourceUrl).length;
    resultCount.textContent = entries.length.toLocaleString();
    trustedCount.textContent = trusted.toLocaleString();
    formatNote.textContent = detectStructuredInput(source.value) ? 'Raindrop 结构化过滤' : '普通文本';
    setStatus(`${label}：${entries.length.toLocaleString()} 条`, entries.length ? 'done' : '');
    return entries;
  } catch (error) {
    entries = [];
    result.value = '';
    resultCount.textContent = '0';
    trustedCount.textContent = '0';
    setStatus(`过滤失败：${error.message || error}`, 'error');
    return [];
  }
}

function scheduleFilter() {
  clearTimeout(filterTimer);
  updateSourceCount();
  if (!autoFilter.checked) {
    setStatus('等待手动执行');
    return;
  }
  setStatus('等待输入完成…');
  filterTimer = setTimeout(() => filterNow('自动识别'), source.value.length > 500000 ? 650 : 180);
}

async function importFiles(fileList) {
  const selected = [...fileList];
  if (!selected.length) return;
  setStatus(`正在读取 ${selected.length} 个文件…`);
  const settled = await Promise.allSettled(selected.map((file) => file.text()));
  const successful = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  const failed = settled.length - successful.length;
  if (!successful.length) {
    setStatus('所选文件均读取失败', 'error');
    files.value = '';
    return;
  }
  const merged = successful.join('\n\n');
  source.value = source.value.trimEnd() ? `${source.value.trimEnd()}\n\n${merged}` : merged;
  filterNow(`已导入 ${successful.length} 个文件${failed ? `，${failed} 个失败` : ''}`);
  files.value = '';
}

async function copyResults() {
  filterNow('已识别');
  if (!result.value) return setStatus('没有可复制的番号', 'error');
  try {
    await navigator.clipboard.writeText(result.value);
    setStatus(`已复制 ${entries.length.toLocaleString()} 条`, 'done');
  } catch (error) {
    setStatus(`复制失败：${error.message || error}`, 'error');
  }
}

function downloadResults() {
  filterNow('已识别');
  if (!result.value) return setStatus('没有可下载的番号', 'error');
  const now = new Date();
  const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), '_', String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')].join('');
  const url = URL.createObjectURL(new Blob([result.value], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${stamp}_parsed_codes.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`已下载 ${entries.length.toLocaleString()} 条`, 'done');
}

function clearAll() {
  clearTimeout(filterTimer);
  source.value = result.value = '';
  entries = [];
  updateSourceCount();
  resultCount.textContent = trustedCount.textContent = '0';
  formatNote.textContent = '普通文本';
  setStatus('已清空');
  source.focus();
}

function setManualStats(values = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (manualStats[key]) manualStats[key].textContent = Number(value || 0).toLocaleString();
  }
}

function setManualProgress(done, total, label = '') {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeDone = Math.min(safeTotal, Math.max(0, Number(done) || 0));
  manualProgress.value = safeTotal ? safeDone / safeTotal * 100 : 0;
  manualProgressText.textContent = label || (safeTotal ? `${safeDone}/${safeTotal}` : '尚未开始');
}

function addManualLog(message, kind = '') {
  const row = document.createElement('div');
  row.className = kind;
  row.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`;
  manualLog.append(row);
  while (manualLog.children.length > 400) manualLog.firstElementChild.remove();
  manualLog.scrollTop = manualLog.scrollHeight;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('已停止', 'AbortError'));
    }, { once: true });
  });
}

function updateManualButton() {
  manualRun.textContent = manualMode.value === 'preview' ? '开始解析预览' : '处理并提交 Raindrop';
}

async function runManualWorkflow() {
  if (manualRunning) return;
  const parsedEntries = filterNow('手动处理输入');
  const codes = parsedEntries.map((entry) => entry.code);
  if (!codes.length) {
    addManualLog('没有识别到可处理的番号', 'error');
    setManualProgress(0, 0, '没有有效番号');
    return;
  }

  const mode = manualMode.value;
  const [{ loveavRules, loveavSettings }, extensionStatus] = await Promise.all([
    getLocal(['loveavRules', 'loveavSettings']),
    send({ type: 'loveav-status' }),
  ]);
  if (!loveavRules?.referenceTags?.length) throw new Error('尚未导入 LoveAV 正式主体库和两层黑名单');
  if (mode !== 'preview' && !extensionStatus.authorized) throw new Error('尚未完成 Raindrop 授权');

  const libraryKeys = new Set(Array.isArray(loveavRules.libraryCodeKeys) ? loveavRules.libraryCodeKeys : []);
  const historyCodes = codes.filter((code) => libraryKeys.has(core.codeComparableKey(code)));
  const skipHistory = mode !== 'all';
  const queue = skipHistory ? codes.filter((code) => !libraryKeys.has(core.codeComparableKey(code))) : codes;
  manualLog.textContent = '';
  setManualStats({ input: codes.length, history: historyCodes.length, parsed: 0, created: 0, existing: 0, problem: 0 });
  setManualProgress(0, queue.length, `准备处理 ${queue.length} 条`);
  if (!Array.isArray(loveavRules.libraryCodeKeys) && Number(loveavRules.stats?.libraryRows) > 0) {
    addManualLog('当前是旧版规则索引，缺少主体库番号；请在设置页重新导入三个规则文件以启用主体库查重', 'warn');
  }
  for (const code of historyCodes) addManualLog(`${code}：正式主体库已有${skipHistory ? '，已跳过' : '，全量重查'}`, 'warn');
  if (!queue.length) {
    setManualProgress(0, 0, '全部为主体库已有番号');
    addManualLog('标准处理完成：没有需要重新解析的番号', 'success');
    return;
  }

  manualRunning = true;
  manualController = new AbortController();
  manualRun.disabled = true;
  manualStop.disabled = false;
  manualMode.disabled = true;
  const works = [];
  try {
    addManualLog(`开始串行解析 ${queue.length} 条；番号间隔 ${resolver.DELAY_MS}ms`);
    for (let index = 0; index < queue.length; index += 1) {
      const code = queue[index];
      setManualProgress(index, queue.length, `[${index + 1}/${queue.length}] ${code}`);
      const work = await resolver.resolveWork(code, {
        signal: manualController.signal,
        onAttempt: ({ url, index: candidateIndex, total }) => addManualLog(`${code}：尝试候选 ${candidateIndex}/${total} · ${url}`),
      });
      works.push(work);
      setManualStats({ parsed: works.length });
      const kind = work.status === 'ok' || work.status === 'page_ok_play_unknown' ? 'success' : 'warn';
      const classified = loveavCore.classifyWork(work, loveavRules);
      const target = loveavCore.destinationForWork(classified, loveavSettings || {});
      addManualLog(`${code}：${work.status}；分类：${classified.folder}；标签：${classified.tags.join('，')}；目标文件夹：${target.name}${work.error ? `；原因：${work.error}` : ''}`, kind);
      setManualProgress(index + 1, queue.length);
      const blockedReason = resolver.submissionBlockReason(works);
      if (blockedReason) {
        setManualStats({ problem: works.filter((item) => item.needsLookup).length });
        throw new Error(blockedReason);
      }
      if (index < queue.length - 1) await abortableDelay(resolver.DELAY_MS, manualController.signal);
    }

    if (mode === 'preview') {
      const problems = works.filter((work) => work.needsLookup || work.status === 'not_found').length;
      setManualStats({ problem: problems });
      setManualProgress(queue.length, queue.length, `预览完成：${works.length} 条，未写入 Raindrop`);
      addManualLog(`只解析预览完成：${works.length} 条；未执行任何 Raindrop 写入`, 'success');
      return;
    }

    manualStop.disabled = true;
    setManualProgress(queue.length, queue.length, `正在分类、查重并提交 ${works.length} 条…`);
    addManualLog('页面解析全部完成，开始应用 LoveAV 分类、双层黑名单及 Raindrop URL 查重');
    const response = await send({ type: 'loveav-save-works', works });
    setManualStats({
      created: response.created,
      existing: response.existing,
      problem: Number(response.excluded || 0) + Number(response.failed || 0),
    });
    for (const item of response.details || []) {
      const labels = { created: '已新增', exists: 'Raindrop 已存在', excluded: '黑名单排除', failed: '提交失败' };
      const suffix = item.folder ? ` → ${item.folder}（LoveAV 分类：${item.ruleFolder}）` : '';
      addManualLog(`${item.code}：${labels[item.status] || item.status}${suffix}${item.error ? `；${item.error}` : ''}`,
        item.status === 'created' || item.status === 'exists' ? 'success' : item.status === 'failed' ? 'error' : 'warn');
    }
    setManualProgress(queue.length, queue.length, `完成：新增 ${response.created}，已存在 ${response.existing}，排除 ${response.excluded}，失败 ${response.failed}`);
  } catch (error) {
    if (error?.name === 'AbortError') {
      setManualProgress(works.length, queue.length, `已停止：已解析 ${works.length}/${queue.length}，未提交`);
      addManualLog('已停止；因为尚未进入整批提交阶段，所以没有产生部分 Raindrop 写入', 'warn');
    } else {
      setManualProgress(works.length, queue.length, `处理失败：${error.message || error}`);
      addManualLog(error.message || String(error), 'error');
    }
  } finally {
    manualRunning = false;
    manualController = null;
    manualRun.disabled = false;
    manualStop.disabled = true;
    manualMode.disabled = false;
  }
}

async function init() {
  const [{ loveavSettings }, { loveavPendingFilter }] = await Promise.all([
    getLocal('loveavSettings'),
    getSession('loveavPendingFilter'),
  ]);
  const workflow = loveavSettings?.workflow || {};
  autoFilter.checked = workflow.autoFilter !== false;
  manualMode.value = ['standard', 'all', 'preview'].includes(workflow.manualMode) ? workflow.manualMode : 'standard';
  updateManualButton();
  document.querySelector('#workflow-summary').textContent = [
    `网站面板默认：${workflow.pagePrimaryAction === 'filter' ? '提取并过滤' : '收藏到 Raindrop'}`,
    `扩展图标：${workflow.actionBehavior === 'save' ? '收藏当前页' : workflow.actionBehavior === 'settings' ? '打开设置' : '打开工作台'}`,
  ].join(' · ');
  if (loveavPendingFilter?.text && Date.now() - Number(loveavPendingFilter.createdAt || 0) < 10 * 60_000) {
    source.value = loveavPendingFilter.text;
    await removeSession('loveavPendingFilter');
    filterNow(`已接收${loveavPendingFilter.sourceLabel ? ` ${loveavPendingFilter.sourceLabel}` : '网页内容'}`);
  } else updateSourceCount();
  source.focus();
}

source.addEventListener('input', scheduleFilter);
autoFilter.addEventListener('change', async () => {
  const { loveavSettings = {} } = await getLocal('loveavSettings');
  await setLocal({ loveavSettings: { ...loveavSettings, workflow: { ...(loveavSettings.workflow || {}), autoFilter: autoFilter.checked } } });
  scheduleFilter();
});
files.addEventListener('change', () => importFiles(files.files));
document.querySelector('#run').addEventListener('click', () => filterNow('已识别'));
document.querySelector('#copy').addEventListener('click', copyResults);
document.querySelector('#download').addEventListener('click', downloadResults);
document.querySelector('#clear').addEventListener('click', clearAll);
document.querySelector('#open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
manualRun.addEventListener('click', () => runManualWorkflow().catch((error) => {
  setManualProgress(0, 0, `无法开始：${error.message || error}`);
  addManualLog(error.message || String(error), 'error');
}));
manualStop.addEventListener('click', () => {
  if (!manualRunning || !manualController) return;
  manualStop.disabled = true;
  manualController.abort();
});
manualMode.addEventListener('change', async () => {
  updateManualButton();
  const { loveavSettings = {} } = await getLocal('loveavSettings');
  await setLocal({ loveavSettings: { ...loveavSettings, workflow: { ...(loveavSettings.workflow || {}), manualMode: manualMode.value } } });
});
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    filterNow('已识别');
  }
});
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('is-dragging'); });
dropZone.addEventListener('drop', (event) => importFiles(event.dataTransfer.files));
init().catch((error) => setStatus(`初始化失败：${error.message || error}`, 'error'));
