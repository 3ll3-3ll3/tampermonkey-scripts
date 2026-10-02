(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab'));
  const view = params.get('view');
  const root = document.querySelector('#surface').attachShadow({ mode: 'open' });
  const status = document.querySelector('#connection');
  let session = '', previous = '', refreshing = false, actionChain = Promise.resolve(), busy = 0;
  let editingUntil = 0;
  const override = `.panel{position:static!important;width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;max-height:none!important;min-height:0!important;resize:none!important;border:0;border-radius:0;box-shadow:none}.panel .body{max-height:none;overflow:visible}.panel .drag,.panel .minimize,.panel .close{display:none}.panel .title{font-size:14px}.logs{height:190px}.layout-bar select{max-width:100%}button,input,select{touch-action:manipulation}`;
  async function forward(command) {
    const result = await chrome.runtime.sendMessage({ type: 'loveav-layout-forward', tabId, command });
    if (!result?.ok) throw new Error(result?.error || '无法连接来源页；请刷新网页后重新打开工具');
    return result;
  }
  async function refresh() {
    if (refreshing || busy || (document.hasFocus() && Date.now() < editingUntil)) return;
    if (!tabId) { status.textContent = '请在 MissAV / 123AV 网页中点击 LoveAV 工具，再选择原生侧边栏。'; return; }
    refreshing = true;
    try {
      const data = await forward({ type: 'loveav-layout-snapshot' });
      session = data.session;
      status.textContent = `已连接来源标签页 · ${data.saving ? '处理中，可继续在网页点击 ♥' : '就绪'} · 关闭此界面不会停止任务`;
      const signature = JSON.stringify([data.html, data.css]);
      if (signature !== previous) {
        const scroll = window.scrollY;
        const focused = root.activeElement;
        const focusId = focused?.dataset.control;
        const selection = focused?.matches('textarea,input[type="text"]') ? [focused.selectionStart, focused.selectionEnd] : null;
        // Snapshot is produced only from extension-owned UI; never from the site's HTML.
        root.innerHTML = `<style>${data.css}\n${override}</style>${data.html}`;
        root.querySelector('.featured-copy')?.setAttribute('data-local-copy', 'true');
        previous = signature;
        const replacement = focusId ? root.querySelector(`[data-control="${focusId}"]`) : null;
        replacement?.focus({ preventScroll: true });
        if (selection && replacement) replacement.setSelectionRange(...selection);
        window.scrollTo(0, scroll);
      }
    } catch (error) {
      status.textContent = `已断开：${error.message}。待处理队列不会在刷新后自动恢复。`;
      root.replaceChildren(); previous = '';
    } finally { refreshing = false; }
  }
  function dispatch(element, event) {
    const command = { type: 'loveav-layout-act', session, id: element.dataset.control, event,
      value: element.value, checked: element.checked, open: element.open };
    busy++;
    actionChain = actionChain.then(() => forward(command)).catch(error => { status.textContent = error.message; }).finally(() => { busy--; refresh(); });
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-control]');
    if (!button || button.disabled) return;
    if (button.matches('.featured-copy')) {
      const titles = [...button.closest('.featured-row').querySelectorAll('.featured-list label')].map(node => node.textContent.trim());
      navigator.clipboard.writeText(titles.join('\n')).then(() => { status.textContent = `已复制 ${titles.length} 条标题`; }).catch(error => { status.textContent = `复制失败：${error.message}`; });
      return;
    }
    dispatch(button, 'click');
  });
  root.addEventListener('input', event => {
    editingUntil = Date.now() + 1000;
    if (event.target.matches('input[data-control],textarea[data-control]')) dispatch(event.target, 'input');
  });
  root.addEventListener('change', async event => {
    editingUntil = 0;
    const element = event.target;
    if (!element.matches('[data-control]')) return;
    if (element.matches('.layout-mode')) {
      const mode = element.value;
      busy++;
      try {
        // User gesture is still active here: open native UI before awaiting anything else.
        if (mode === 'sidebar' || mode === 'window') {
          const response = await chrome.runtime.sendMessage({ type: 'loveav-layout-open', tabId, mode });
          if (!response?.ok) throw new Error(response?.error || '无法打开布局');
        }
        await actionChain;
        await forward({ type: 'loveav-layout-set', mode });
        if (view === 'window' && mode !== 'window') window.close();
        if (view === 'sidebar' && mode !== 'sidebar') {
          await chrome.runtime.sendMessage({ type: 'loveav-layout-close-side', tabId });
          status.textContent = '已切换布局；若侧栏仍打开，请点击浏览器的关闭按钮。';
        }
      } catch (error) { status.textContent = error.message; }
      finally { busy--; refresh(); }
      return;
    }
    dispatch(element, 'change');
  });
  root.addEventListener('toggle', event => {
    if (event.target.matches('details[data-control]')) dispatch(event.target, 'toggle');
  }, true);
  root.addEventListener('pointerdown', event => { if (event.target.matches('select')) editingUntil = Date.now() + 15000; });
  root.addEventListener('focusout', () => { editingUntil = 0; });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') editingUntil = 0; });
  document.querySelector('#reconnect').onclick = refresh;
  document.querySelector('#focus-source').onclick = async () => {
    try { const tab = await chrome.tabs.update(tabId, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
    catch { status.textContent = '来源网页已关闭，请从作品网页重新打开工具'; }
  };
  refresh(); setInterval(refresh, 800);
})();
