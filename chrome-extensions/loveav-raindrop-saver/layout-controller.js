(function () {
  'use strict';
  // All four views operate the original content UI: no second save/queue implementation.
  globalThis.LoveAVLayoutController = function ({ ui, compact, sync, pending, saving, removePending }) {
    const modes = { floating: '悬浮收起', sidebar: '原生侧边栏', window: '独立窗口', bottom: '底部停靠' };
    let mode = 'floating', visible = false, userClosed = false, timer, serial = 0;
    const ids = new WeakMap(), controls = new Map();
    const session = `${Date.now()}-${Math.random()}`;
    const style = document.createElement('style');
    style.textContent = `
      .layout-bar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
      .layout-bar select{background:#1e293b;color:#fff;padding:7px;border:1px solid #64748b;border-radius:6px}
      .layout-note{font-size:12px;color:#94a3b8;margin:8px 0}.queue-list{max-height:150px;overflow:auto}
      .queue-item{display:flex;align-items:center;gap:8px;padding:5px 0}.queue-item span{flex:1;overflow-wrap:anywhere}
      .panel.docked{display:flex;flex-direction:column;left:0!important;right:0!important;bottom:0!important;top:auto!important;width:100vw!important;max-width:none;height:var(--dock-height)!important;min-height:0;max-height:none;resize:none;border-radius:12px 12px 0 0}
      .panel.docked .head{flex-shrink:0}.panel.docked .body{max-height:none;min-height:0;flex:1}
      .panel.docked .drag{display:none}.panel.docked:not(.compact) .body{display:grid;grid-template-columns:minmax(260px,1fr) minmax(240px,1fr);grid-template-areas:'layout actions' 'phase progress' 'queue stats' 'loader logs' 'note note';gap:6px 18px;align-content:start}
      .panel.docked .layout-bar{grid-area:layout;margin:0}.panel.docked .body>.actions{grid-area:actions;margin:0}
      .panel.docked .phase{grid-area:phase;margin:0}.panel.docked .barrow{grid-area:progress;margin:0}
      .panel.docked .pending-queue{grid-area:queue}.panel.docked .stats{grid-area:stats;margin:0;grid-template-columns:repeat(6,1fr)}
      .panel.docked .home-load{grid-area:loader}.panel.docked .logs-details{grid-area:logs}
      .panel.docked .layout-note{grid-area:note;margin:0}.panel.docked .ready{display:none}
      @media(max-width:700px){.panel.docked:not(.compact) .body{display:block}.panel.docked .stats{grid-template-columns:repeat(3,1fr)}}
    `;
    ui.shadow.append(style);
    const bar = document.createElement('div');
    bar.className = 'layout-bar';
    bar.innerHTML = '<label>布局 <select class="layout-mode" aria-label="布局模式"></select></label><label class="dock-size" hidden>高度 <input aria-label="底栏高度" type="range" min="180" max="460" step="20" value="300"></label>';
    const select = bar.querySelector('select');
    for (const [value, label] of Object.entries(modes)) select.add(new Option(label, value));
    const note = document.createElement('p');
    note.className = 'layout-note';
    note.textContent = '切换布局、关闭面板不会停止任务。队列属于此作品标签页；处理期间请勿刷新、关闭或跳转该网页。';
    const queue = document.createElement('details');
    queue.className = 'pending-queue';
    queue.innerHTML = '<summary>待处理队列 <span class="queue-count">0</span></summary><div class="queue-list"></div>';
    ui.shadow.querySelector('.body').prepend(bar, note, queue);
    const logs = document.createElement('details');
    logs.className = 'logs-details';
    logs.innerHTML = '<summary>详细处理日志</summary>';
    ui.logs.before(logs); logs.append(ui.logs);
    let dockHeight = 300, docked = false;
    const pageStyle = document.createElement('style');
    pageStyle.id = 'loveav-dock-page-layout';
    // Constrain the site's scroll viewport, rather than just adding padding behind an overlay.
    function apply() {
      select.value = mode;
      const bottom = mode === 'bottom' && visible;
      const height = ui.panel.classList.contains('compact') ? 64 : Math.min(dockHeight, Math.floor(innerHeight * .55));
      ui.panel.classList.toggle('docked', bottom);
      ui.panel.style.setProperty('--dock-height', `${height}px`);
      bar.querySelector('.dock-size').hidden = mode !== 'bottom';
      if (bottom) {
        const scroll = window.scrollY;
        const css = `html{height:100%!important;overflow:hidden!important}body{height:calc(100dvh - ${height}px)!important;overflow:auto!important;box-sizing:border-box!important;min-height:0!important;margin-top:0!important;margin-bottom:0!important}html{scroll-padding-bottom:${height}px}`;
        if (pageStyle.textContent !== css) pageStyle.textContent = css;
        if (!pageStyle.isConnected) document.documentElement.append(pageStyle);
        if (!docked) document.body.scrollTop = scroll;
      } else if (docked) {
        const scroll = document.body.scrollTop;
        pageStyle.remove(); window.scrollTo(0, scroll);
      }
      docked = bottom;
      ui.panel.hidden = !visible || mode === 'sidebar' || mode === 'window';
      ui.launcher.hidden = visible && (mode === 'bottom' || mode === 'floating');
      ui.quickSave.style.bottom = bottom ? `${height + 12}px` : '';
      ui.launcher.style.bottom = '';
    }
    async function external() {
      const result = await chrome.runtime.sendMessage({ type: 'loveav-layout-open', mode });
      if (!result?.ok) throw new Error(result?.error || '无法打开外部面板');
    }
    async function change(value, launch = true) {
      if (!modes[value]) return;
      const previous = mode;
      mode = value;
      visible = true;
      userClosed = false;
      compact(false);
      apply();
      try {
        // Send immediately from the user gesture; sidePanel.open must not wait on storage.
        if (launch && (mode === 'sidebar' || mode === 'window')) await external();
        await chrome.storage.local.set({ loveavLayoutMode: mode });
        if (previous === 'sidebar' && mode !== previous) chrome.runtime.sendMessage({ type: 'loveav-layout-close-side' }).catch(() => {});
      } catch (error) {
        mode = 'floating'; apply();
        ui.phase.textContent = `${error.message}；已返回悬浮模式，可重新选择布局。`;
      }
      sync();
    }
    select.addEventListener('change', () => change(select.value));
    bar.querySelector('input').addEventListener('input', event => { dockHeight = Number(event.target.value); apply(); });
    ui.panel.addEventListener('mouseenter', () => clearTimeout(timer));
    ui.panel.addEventListener('mouseleave', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (mode === 'floating' && visible && !ui.shadow.activeElement?.matches('input,select,textarea')) compact(true);
      }, 1600);
    });
    window.addEventListener('resize', apply);
    function renderQueue() {
      queue.querySelector('.queue-count').textContent = String(pending().size);
      const list = queue.querySelector('.queue-list');
      const signature = JSON.stringify([...pending().keys()]);
      if (list.dataset.signature === signature) return;
      list.dataset.signature = signature; list.replaceChildren();
      for (const [key, work] of pending()) {
        const row = document.createElement('div'); row.className = 'queue-item';
        const title = document.createElement('span'); title.textContent = work.title || work.code;
        const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = '移除';
        remove.addEventListener('click', () => { removePending(key); renderQueue(); sync(); });
        row.append(title, remove); list.append(row);
      }
    }
    function snapshot() {
      renderQueue(); controls.clear();
      const clone = ui.panel.cloneNode(true);
      const original = [ui.panel, ...ui.panel.querySelectorAll('*')];
      const copies = [clone, ...clone.querySelectorAll('*')];
      original.forEach((element, index) => {
        if (!element.matches('button,input,select,textarea,details')) return;
        if (!ids.has(element)) ids.set(element, String(++serial));
        const id = ids.get(element); controls.set(id, element); copies[index].dataset.control = id;
        if (element.matches('input')) { copies[index].setAttribute('value', element.value); copies[index].toggleAttribute('checked', element.checked); }
        if (element.matches('textarea')) copies[index].textContent = element.value;
        if (element.matches('select')) [...copies[index].options].forEach(option => option.toggleAttribute('selected', option.value === element.value));
      });
      clone.hidden = false; clone.classList.remove('compact', 'docked'); clone.removeAttribute('style');
      return { ok: true, session, mode, saving: saving(), html: clone.outerHTML, css: [...ui.shadow.querySelectorAll('style')].map(node => node.textContent).join('\n') };
    }
    function act(message) {
      if (message.session !== session) return { ok: false, error: '网页已经刷新，请等面板重新连接后再操作' };
      const element = controls.get(message.id);
      if (!element?.isConnected || element.disabled) return { ok: false, error: '该控件已更新或暂不可用，请稍后重试' };
      if (message.event === 'click' && element.matches('button')) element.click();
      else if (message.event === 'toggle' && element.matches('details')) element.open = Boolean(message.open);
      else if (['input', 'change'].includes(message.event) && element.matches('input,select,textarea')) {
        element.value = String(message.value ?? '');
        if (element.type === 'checkbox') element.checked = Boolean(message.checked);
        element.dispatchEvent(new Event(message.event, { bubbles: true }));
      }
      return { ok: true };
    }
    chrome.storage.local.get('loveavLayoutMode', data => {
      if (modes[data.loveavLayoutMode]) mode = data.loveavLayoutMode;
      apply();
    });
    chrome.runtime.sendMessage({ type: 'loveav-layout-register' }).catch(() => {});
    return {
      change, snapshot, act,
      refresh() { renderQueue(); apply(); },
      show(isCompact, userGesture = false) {
        const wasVisible = visible;
        // Queue updates never reopen a closed view or steal focus from the website.
        if (!userGesture && !visible && (mode !== 'floating' || userClosed)) { apply(); return; }
        if (userGesture) userClosed = false;
        visible = true;
        if (!isCompact) compact(false); else if (!wasVisible) compact(true);
        apply();
        if (userGesture && (mode === 'sidebar' || mode === 'window')) external().catch(error => {
          mode = 'floating'; apply(); ui.phase.textContent = error.message;
        });
      },
      hide() { visible = false; userClosed = true; apply(); },
      get mode() { return mode; },
    };
  };
})();
