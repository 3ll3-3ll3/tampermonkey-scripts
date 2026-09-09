'use strict';

const core = globalThis.MissAVCodeFilterCore;
if (!core) throw new Error('过滤核心加载失败');

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
  if (!result.value) {
    setStatus('没有可复制的番号', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(result.value);
    setStatus(`已复制 ${entries.length.toLocaleString()} 条`, 'done');
  } catch (error) {
    setStatus(`复制失败：${error.message || error}`, 'error');
  }
}

function downloadResults() {
  filterNow('已识别');
  if (!result.value) {
    setStatus('没有可下载的番号', 'error');
    return;
  }
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
  source.value = '';
  result.value = '';
  entries = [];
  updateSourceCount();
  resultCount.textContent = '0';
  trustedCount.textContent = '0';
  formatNote.textContent = '普通文本';
  setStatus('已清空');
  source.focus();
}

source.addEventListener('input', scheduleFilter);
files.addEventListener('change', () => importFiles(files.files));
document.querySelector('#run').addEventListener('click', () => filterNow('已识别'));
document.querySelector('#copy').addEventListener('click', copyResults);
document.querySelector('#download').addEventListener('click', downloadResults);
document.querySelector('#clear').addEventListener('click', clearAll);
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    filterNow('已识别');
  }
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
}
dropZone.addEventListener('drop', (event) => importFiles(event.dataTransfer.files));

source.focus();
