(() => {
  'use strict';
  if (document.getElementById('loveav-reading-guard')) return;
  const KEY = 'loveavReadingGuard';
  const defaults = { media: true, ads: true, popups: true, external: true, reading: false, font: 18, width: 900, keywords: '' };
  const normalize = raw => ({
    media: typeof raw?.media === 'boolean' ? raw.media : defaults.media,
    ads: raw?.ads !== false, popups: raw?.popups !== false, external: raw?.external !== false, reading: raw?.reading === true,
    font: Math.max(14, Math.min(28, Number(raw?.font) || 18)),
    width: Math.max(600, Math.min(1400, Number(raw?.width) || 900)),
    keywords: String(raw?.keywords || '').slice(0, 10000),
  });
  let settings = { ...defaults }, picking = false, timer, previousFocus;
  const manual = [], marked = new Set(), adMarked = new Set();
  const style = document.createElement('style');
  style.id = 'loveav-reading-guard-style';
  const host = document.createElement('div');
  host.id = 'loveav-reading-guard';
  host.style.cssText = 'all:initial!important;position:fixed!important;left:12px!important;bottom:12px!important;z-index:2147483647!important';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{color-scheme:dark}*{box-sizing:border-box}button,input,textarea,section{font:14px/1.5 system-ui,sans-serif}
    button{border:1px solid #617b94;border-radius:8px;padding:8px 12px;background:#183c50;color:#e7f5ff;cursor:pointer}
    button:hover{background:#22566a}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #6de0d5;outline-offset:2px}
    section{width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - 85px);overflow:auto;margin-bottom:8px;background:#101e2d;color:#edf6ff;border:1px solid #4c6c84;border-radius:14px;padding:18px;box-shadow:0 10px 40px #0006}
    header{display:flex;justify-content:space-between;align-items:center}h2{font-size:19px;margin:0}p{color:#afc3d5;font-size:12px}label{display:block;margin:12px 0}input[type=checkbox]{accent-color:#4cccbc;width:17px;height:17px;vertical-align:middle;margin-right:8px}
    input[type=range],textarea{width:100%;accent-color:#4cccbc}textarea{background:#091421;color:#edf6ff;padding:8px;border:1px solid #617b94;border-radius:8px;resize:vertical;min-height:76px}
    .row{display:flex;gap:8px;flex-wrap:wrap}.primary{background:#24675f}.status{min-height:20px;color:#82e0d5;white-space:pre-wrap}[hidden]{display:none!important}
  </style><section hidden aria-label="浏览保护设置">
    <header><h2>浏览保护</h2><button class="close" aria-label="关闭浏览保护面板">×</button></header>
    <p>只在本机调整网页显示。Alt + Shift + P 打开／收起，Esc 关闭或取消点选。</p>
    <label><input type="checkbox" data-key="media">隐藏图片、视频和嵌入预览</label>
    <label><input type="checkbox" data-key="popups">拦截脚本弹窗及偷偷打开的新标签页</label>
    <label><input type="checkbox" data-key="external">拦截外站链接跳转（包括手动点击）</label>
    <p class="popup-count" aria-live="polite">本页已拦截 0 次弹窗／外站跳转</p>
    <label><input type="checkbox" data-key="ads">隐藏广告区域及夹在列表中的外站图文推广</label>
    <p class="ad-count">已隐藏 0 个疑似外站推广区域</p>
    <label><input type="checkbox" data-key="reading">启用阅读排版</label>
    <label>正文字号 <output class="font-value"></output><input aria-label="正文字号" type="range" min="14" max="28" data-key="font"></label>
    <label>阅读宽度 <output class="width-value"></output><input aria-label="阅读宽度" type="range" min="600" max="1400" step="20" data-key="width"></label>
    <label>隐藏含这些关键词的文章卡片<textarea data-key="keywords" placeholder="每行一个词，例如：促销\n按标题匹配，不上传关键词"></textarea></label>
    <div class="row"><button class="apply primary">应用并记住</button><button class="pick">点选隐藏区域</button><button class="undo">撤销上次隐藏</button><button class="reset">恢复原网页</button></div>
    <p class="status" role="status" aria-live="polite"></p>
    <p>外站官网、分享、下载链接也会被拦截，需要时取消对应开关并应用。隐藏不阻止资源下载；跨域播放器、地址栏重定向不保证拦截。</p>
  </section><button class="launcher" aria-expanded="false">◉ 浏览保护</button>`;
  const $ = selector => ui.querySelector(selector);
  const status = text => { $('.status').textContent = text; };
  function setPicking(value) {
    picking = value;
    document.documentElement?.toggleAttribute('data-loveav-guard-picking', value);
    $('.launcher').textContent = value ? '点选要隐藏的区域 · Esc 取消' : '◉ 浏览保护';
  }
  function mount() {
    if (!document.documentElement) return;
    if (!style.isConnected) document.documentElement.append(style);
    if (!host.isConnected) document.documentElement.append(host);
  }
  function display(open) {
    if (open) previousFocus = document.activeElement;
    $('section').hidden = !open;
    $('.launcher').setAttribute('aria-expanded', String(open));
    if (open) $('.close').focus();
    else if (previousFocus?.isConnected) previousFocus.focus();
  }
  function render() {
    for (const node of ui.querySelectorAll('[data-key]')) {
      const value = settings[node.dataset.key];
      if (node.type === 'checkbox') node.checked = value;
      else node.value = value;
    }
    $('.font-value').textContent = `${settings.font}px`;
    $('.width-value').textContent = `${settings.width}px`;
  }
  function scan() {
    for (const node of adMarked) node.removeAttribute('data-loveav-guard-ad');
    adMarked.clear();
    if (settings.ads) {
      for (const link of document.querySelectorAll('a[href]')) {
        if (link.closest('nav,header,footer,[role="navigation"]')) continue;
        let outside = false;
        try { const url = new URL(link.getAttribute('href'), location.href); outside = /^https?:$/.test(url.protocol) && url.origin !== location.origin; } catch { continue; }
        if (!outside) continue;
        // Match image promotions even while media visibility is disabled. Never
        // scan article destinations or load them to make this display decision.
        const media = link.querySelector('img,picture,video') || /background(?:-image)?\s*:.*url\(/i.test(link.getAttribute('style') || '') ||
          [...link.querySelectorAll('[style]')].some(node => /background(?:-image)?\s*:.*url\(/i.test(node.getAttribute('style') || ''));
        if (!media) continue;
        let target = link;
        const card = link.closest('article,.post-card,.post-item,.entry-card,li,.ad-item');
        // Only collapse the wrapper if its sole link is this promotion. Mixed
        // content cards retain their text and their legitimate article links.
        if (card && !card.querySelector('h1') && card.querySelectorAll('a[href]').length === 1) target = card;
        target.setAttribute('data-loveav-guard-ad', ''); adMarked.add(target);
      }
    }
    $('.ad-count').textContent = `已隐藏 ${adMarked.size} 个疑似外站推广区域`;
    for (const node of marked) node.removeAttribute('data-loveav-guard-blocked');
    marked.clear();
    const words = settings.keywords.split(/\r?\n/).map(s => s.trim().toLocaleLowerCase()).filter(Boolean);
    if (!words.length) return;
    for (const node of document.querySelectorAll('article,.post-card,.post-item,.entry-card,.video-card')) {
      if (node.querySelector('h1') || node.querySelectorAll('h2,h3').length > 1) continue;
      const title = node.querySelector('h2,h3,.post-title,.entry-title,[data-title]')?.textContent || '';
      if (words.some(word => title.toLocaleLowerCase().includes(word))) {
        node.setAttribute('data-loveav-guard-blocked', '');
        marked.add(node);
      }
    }
  }
  function pauseMedia(event) {
    if (!settings.media) return;
    if (event?.target instanceof HTMLMediaElement) event.target.pause();
    else document.querySelectorAll('video,audio').forEach(node => node.pause());
  }
  function apply() {
    window.postMessage({ type: 'loveav-popup-config', popups: settings.popups, external: settings.external }, '*');
    style.textContent = `
      [data-loveav-guard-blocked],[data-loveav-guard-manual],[data-loveav-guard-ad]{display:none!important}
      ${settings.media ? 'img,picture,video,canvas,iframe,object,embed{visibility:hidden!important} *{background-image:none!important}' : ''}
      ${settings.ads ? '[data-ad-slot],ins.adsbygoogle,.advertisement,.ad-banner,.ad-container,.ad-overlay,.ad-popup,.popup-ad,.adsbygoogle,[aria-label="Advertisement"]{display:none!important;pointer-events:none!important}' : ''}
      ${settings.reading ? `main,[role="main"],.post-content,.entry-content{max-width:${settings.width}px!important;margin-inline:auto!important} .post-content,.entry-content,article p,main p{font-size:${settings.font}px!important;line-height:1.8!important;overflow-wrap:anywhere!important}` : ''}
    `;
    scan(); pauseMedia();
  }
  async function persist() {
    try { await chrome.storage.local.set({ [KEY]: settings }); status(`已应用并记住 · 隐藏 ${marked.size} 张匹配卡片`); }
    catch { status('已应用到当前页，但设置未能保存；请重新加载扩展后刷新网页。'); }
  }
  $('.launcher').onclick = () => display($('section').hidden);
  $('.close').onclick = () => display(false);
  for (const key of ['font', 'width']) $(`[data-key="${key}"]`).oninput = event => { $(`.${key}-value`).textContent = `${event.target.value}px`; };
  $('.apply').onclick = () => {
    const raw = {};
    for (const node of ui.querySelectorAll('[data-key]')) raw[node.dataset.key] = node.type === 'checkbox' ? node.checked : node.value;
    settings = normalize(raw); apply(); void persist();
  };
  $('.reset').onclick = () => {
    setPicking(false);
    for (const node of manual) node.removeAttribute('data-loveav-guard-manual');
    manual.length = 0;
    settings = { ...defaults, media: false, ads: false, popups: false, external: false, reading: false, keywords: '' };
    render(); apply(); void persist();
  };
  $('.pick').onclick = () => { setPicking(true); status('请点击要隐藏的区域。Esc 取消；撤销按钮可恢复。'); display(false); };
  $('.undo').onclick = () => {
    const node = manual.pop();
    node?.removeAttribute('data-loveav-guard-manual');
    status(node ? '已撤销上次点选隐藏。' : '没有可撤销的点选操作。');
  };
  window.addEventListener('click', event => {
    if (!picking || event.composedPath().includes(host)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const node = event.target;
    if (!(node instanceof Element) || ['HTML','BODY','MAIN'].includes(node.tagName) || node.contains(host)) return;
    node.setAttribute('data-loveav-guard-manual', ''); manual.push(node); setPicking(false); display(true);
    status('已隐藏所点区域，可撤销或恢复原网页。');
  }, true);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (picking || !$('section').hidden)) {
      event.preventDefault(); setPicking(false); display(false);
    } else if (event.altKey && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault(); display($('section').hidden);
    }
  }, true);
  document.addEventListener('play', pauseMedia, true);
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'loveav-popup-stats') return;
    const count = Number(event.data.count);
    if (Number.isSafeInteger(count) && count >= 0) $('.popup-count').textContent = `本页已拦截 ${count} 次弹窗／外站跳转`;
  });
  window.postMessage({ type: 'loveav-popup-query' }, '*');
  new MutationObserver(records => {
    if (!records.some(record => record.target !== style && !host.contains(record.target))) return;
    clearTimeout(timer);
    timer = setTimeout(() => { mount(); scan(); pauseMedia(); }, 180);
  }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'src', 'class'] });
  mount(); render(); apply();
  chrome.storage.local.get(KEY).then(data => {
    settings = normalize(data[KEY]); render(); apply();
  }).catch(() => status('无法读取已保存设置；当前使用默认浏览保护。'));
})();
