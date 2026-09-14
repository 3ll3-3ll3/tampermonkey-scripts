(function () {
  'use strict';

  // Selection is keyed by URL; DOM nodes are only the current display of a work.
  globalThis.LoveAVPageSelection = function createSelection({ scan, save, onChange }) {
    const selected = new Map();
    let active = false;
    let busy = false;
    let route = location.pathname + location.search;
    let host, shadow, toolbar, count, groups, keyword, layer;
    let cards = [];
    let frame = 0;
    let groupSignature = '';
    let toolbarPosition = null;
    let drag = null;
    const keyOf = (work) => work.url.toLowerCase();

    function cardFor(anchor) {
      const grid = anchor.closest('.grid, .rec__grid, [class*="grid-cols-"]');
      if (grid) {
        let child = anchor;
        while (child.parentElement && child.parentElement !== grid) child = child.parentElement;
        if (child.parentElement === grid) return child;
      }
      return anchor.closest('article, .card, .thumbnail, .video-item, li') || anchor;
    }

    function groupFor(card) {
      for (let parent = card.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const heading = parent.querySelector('h2, h3, [class*="section-title"], .rec__title');
        if (heading && !card.contains(heading)) {
          return { node: parent, title: heading.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名板块' };
        }
      }
      return { node: document.body, title: '其他作品' };
    }

    function visibleRect(element) {
      let rect = element.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      if (rect.width < 1 || rect.height < 1) return null;
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
        if (node !== element && /(hidden|clip|auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
          rect = node.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
        }
      }
      return right - left > 30 && bottom - top > 25 ? { left, top, width: right - left, height: bottom - top } : null;
    }

    function ensureHost() {
      if (host?.isConnected) return;
      if (host) { document.documentElement.append(host); raiseHost(); return; }
      host = document.createElement('div');
      host.id = 'loveav-page-selection';
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
      // The browser top layer keeps site navigation from intercepting toolbar clicks.
      if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          *{box-sizing:border-box} [hidden]{display:none!important}
          :host::backdrop{background:transparent;pointer-events:none}
          .toolbar{position:fixed;bottom:16px;left:12px;width:min(860px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:12px;pointer-events:auto;background:#0f172af5;color:#e2e8f0;border:1px solid #64748b;border-radius:12px;box-shadow:0 8px 28px #0007;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;z-index:2}
          .handle{cursor:grab;touch-action:none;user-select:none;color:#c7d2fe}.handle:active{cursor:grabbing}.toolbar.compact .extras{display:none}.toolbar .header{position:sticky;top:-12px;background:#0f172a;padding:5px 0;z-index:1}.header button{flex-shrink:0}.count{min-width:0;overflow-wrap:anywhere}
          .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.row+.row{margin-top:8px}.count{margin-right:auto;font-weight:700}.note{color:#a5b4fc;font-size:12px}
          button,select,textarea{font:inherit;color:inherit;background:#334155;border:1px solid #64748b;border-radius:7px;padding:6px 9px}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}.save{background:#4f46e5}textarea{flex:1;min-width:150px;height:36px;resize:vertical}select{max-width:230px}
          .card{position:fixed;border-radius:8px;pointer-events:none;border:2px solid transparent}.card.selected{border-color:#818cf8;box-shadow:inset 0 0 0 3px #6366f140;background:#6366f11a}
          .pick{position:absolute;left:5px;top:5px;display:flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid #94a3b8;border-radius:7px;background:#0f172af0;color:white;font:700 12px/1.3 system-ui;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px #0006}
          input{width:18px;height:18px;margin:0;accent-color:#6366f1}
        </style>
        <div class="layer"></div>
        <section class="toolbar" aria-label="选择作品收藏">
          <div class="row header"><span class="handle" title="拖动移动选择栏">⠿ 拖动</span><span class="count"></span><button class="save" type="button">收藏已选</button><button class="collapse" type="button" aria-expanded="true">收起</button><button class="reset" type="button">重置位置</button><button class="close" type="button">退出选择</button></div>
          <div class="row extras"><select class="groups" aria-label="选择板块"></select><button data-select="all">全选</button><button data-select="invert">反选</button><button data-select="visible">选择可见区域</button><button data-select="clear">清空全部</button></div>
          <div class="row extras"><textarea class="keyword" aria-label="标题关键词或多行番号" placeholder="标题关键词或多行番号（每行一个，匹配任意一行）"></textarea><button data-select="match">勾选匹配</button></div>
          <div class="note extras">全选、反选、可见区域与关键词选择作用于所选板块。新加载作品默认不勾选。</div>
        </section>`;
      layer = shadow.querySelector('.layer');
      toolbar = shadow.querySelector('.toolbar');
      count = shadow.querySelector('.count');
      groups = shadow.querySelector('.groups');
      keyword = shadow.querySelector('.keyword');
      const handle = toolbar.querySelector('.handle');
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const rect = toolbar.getBoundingClientRect();
        drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      handle.addEventListener('pointermove', (event) => {
        if (!drag) return;
        toolbarPosition = { x: event.clientX - drag.x, y: event.clientY - drag.y };
        placeToolbar();
      });
      handle.addEventListener('pointerup', () => { drag = null; });
      handle.addEventListener('lostpointercapture', () => { drag = null; });
      toolbar.querySelector('.reset').addEventListener('click', () => { toolbarPosition = null; placeToolbar(); });
      toolbar.querySelector('.collapse').addEventListener('click', (event) => {
        const compact = toolbar.classList.toggle('compact');
        event.currentTarget.textContent = compact ? '展开' : '收起';
        event.currentTarget.setAttribute('aria-expanded', String(!compact));
        placeToolbar();
      });
      new ResizeObserver(() => { if (active) placeToolbar(); }).observe(toolbar);
      toolbar.querySelector('.close').addEventListener('click', () => setActive(false));
      toolbar.querySelector('.save').addEventListener('click', () => {
        if (!busy && selected.size) save([...selected.values()].map((work) => ({ ...work })));
      });
      toolbar.addEventListener('click', (event) => {
        const mode = event.target.dataset.select;
        if (mode && !busy) selectBy(mode);
      });
      document.documentElement.append(host);
      raiseHost();
    }

    function raiseHost() {
      if (active && host.hasAttribute('popover') && !host.matches(':popover-open')) host.showPopover();
    }

    function placeToolbar() {
      const rect = toolbar.getBoundingClientRect();
      const maxX = Math.max(12, innerWidth - rect.width - 12);
      const maxY = Math.max(12, innerHeight - rect.height - 12);
      const x = Math.min(maxX, Math.max(12, toolbarPosition?.x ?? (innerWidth - rect.width) / 2));
      const y = Math.min(maxY, Math.max(12, toolbarPosition?.y ?? maxY));
      toolbar.style.left = `${x}px`;
      toolbar.style.top = `${y}px`;
      toolbar.style.bottom = 'auto';
    }

    function selectBy(mode) {
      if (mode === 'clear') selected.clear();
      else {
        const terms = keyword.value.toLocaleLowerCase().split(/[\n,，]+/).map((term) => term.trim()).filter(Boolean);
        const handled = new Set();
        for (const item of cards) {
          if (groups.value !== 'all' && item.groupId !== groups.value) continue;
          if (mode === 'visible' && !visibleRect(item.card)) continue;
          if (mode === 'match') {
            const text = `${item.work.title} ${item.work.code}`.toLocaleLowerCase();
            if (!terms.some((term) => text.includes(term))) continue;
          }
          const key = keyOf(item.work);
          if (handled.has(key)) continue;
          handled.add(key);
          if (mode === 'invert' && selected.has(key)) selected.delete(key);
          else selected.set(key, { ...item.work });
        }
      }
      render();
      onChange?.(selected.size);
    }

    function render() {
      if (!active) return;
      ensureHost();
      const currentKeys = new Set(cards.map((item) => keyOf(item.work)));
      const missing = [...selected.keys()].filter((key) => !currentKeys.has(key)).length;
      count.textContent = `已选 ${selected.size} / 本页 ${currentKeys.size} 个作品${missing ? `（含已移出页面 ${missing} 个）` : ''}`;
      toolbar.querySelector('.save').textContent = `收藏已选 ${selected.size} 项`;
      for (const control of toolbar.querySelectorAll('button,select,textarea')) control.disabled = busy;
      toolbar.querySelector('.close').disabled = false;
      toolbar.querySelector('.save').disabled = busy || !selected.size;
      placeToolbar();
      // Only create overlays for cards visible in the viewport; large loaded lists remain cheap to display.
      layer.replaceChildren();
      for (const item of cards) {
        const rect = visibleRect(item.card);
        if (!rect) continue;
        const key = keyOf(item.work);
        const box = document.createElement('div');
        box.className = `card${selected.has(key) ? ' selected' : ''}`;
        box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
        const label = document.createElement('label');
        label.className = 'pick';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(key);
        checkbox.disabled = busy;
        checkbox.setAttribute('aria-label', `选择 ${item.work.code}`);
        label.append(checkbox, document.createTextNode(item.work.code));
        checkbox.addEventListener('change', () => {
          if (busy) return;
          if (checkbox.checked) selected.set(key, { ...item.work });
          else selected.delete(key);
          render();
          onChange?.(selected.size);
        });
        box.append(label);
        layer.append(box);
      }
    }

    function refresh() {
      const nextRoute = location.pathname + location.search;
      if (route !== nextRoute) { route = nextRoute; selected.clear(); }
      if (!active) return;
      ensureHost();
      const groupNodes = new Map();
      const seenCards = new Set();
      cards = [];
      for (const { work, anchor } of scan()) {
        const card = cardFor(anchor);
        if (seenCards.has(card)) continue;
        seenCards.add(card);
        const group = groupFor(card);
        if (!groupNodes.has(group.node)) groupNodes.set(group.node, { id: String(groupNodes.size), title: group.title });
        cards.push({ work, card, groupId: groupNodes.get(group.node).id });
        if (selected.has(keyOf(work))) selected.set(keyOf(work), { ...work });
      }
      const signature = JSON.stringify([...groupNodes.values()]);
      if (signature !== groupSignature) {
        const previous = groups.value;
        groups.replaceChildren(new Option('全部板块', 'all'));
        for (const group of groupNodes.values()) groups.append(new Option(group.title, group.id));
        groups.value = [...groups.options].some((option) => option.value === previous) ? previous : 'all';
        groupSignature = signature;
      }
      render();
      onChange?.(selected.size);
    }

    function setActive(value) {
      active = value;
      if (active) { ensureHost(); host.style.setProperty('display', 'block', 'important'); raiseHost(); refresh(); }
      else if (host) {
        if (host.hasAttribute('popover') && host.matches(':popover-open')) host.hidePopover();
        host.style.setProperty('display', 'none', 'important');
      }
      onChange?.(selected.size);
    }

    const schedule = () => {
      if (!active || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; render(); });
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('load', schedule, true);
    return {
      refresh,
      setActive,
      setBusy(value) { busy = value; render(); },
      get active() { return active; },
      get count() { return selected.size; },
    };
  };
})();
