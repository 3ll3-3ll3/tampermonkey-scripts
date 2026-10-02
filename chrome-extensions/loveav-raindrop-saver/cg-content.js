(function () {
  'use strict';
  const parser = globalThis.LoveAVCGArticle;
  if (!parser.articleUrl(location.href) || document.getElementById('loveav-cg-host')) return;
  const host = document.createElement('div'); host.id = 'loveav-cg-host';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box}section,button,input,textarea{font:14px/1.5 system-ui,'Microsoft YaHei',sans-serif}
    button{padding:8px 12px;border:0;border-radius:8px;background:#5b4fcf;color:white;cursor:pointer}button:disabled{opacity:.5;cursor:wait}
    section{width:min(400px,calc(100vw - 32px));max-height:80vh;overflow:auto;background:#0f172a;color:#e2e8f0;padding:16px;border:1px solid #64748b;border-radius:12px;box-shadow:0 10px 35px #0007}
    header{display:flex;justify-content:space-between;align-items:center}h2{font-size:16px;margin:0}label{display:block;margin:12px 0}
    input,textarea{display:block;width:100%;padding:8px;border:1px solid #64748b;border-radius:6px;background:#1e293b;color:white}textarea{height:120px;resize:vertical}
    p{overflow-wrap:anywhere}small{color:#94a3b8}.actions,.launchers{display:flex;gap:8px}.preview{background:#475569}[hidden]{display:none!important}.status{white-space:pre-wrap;color:#a5b4fc}
    </style><div class="launchers"><button class="open">♥ 一键收藏到 51cg</button><button class="preview">预览</button></div><section hidden>
    <header><h2>51cg → Raindrop</h2><button class="close" aria-label="关闭">×</button></header>
    <p class="destination">目标文件夹：51cg</p><label>文章标题<input class="title"></label>
    <label>标签（每行一个，可修改）<textarea class="tags"></textarea></label><small class="source"></small>
    <p class="url"></p><div class="actions"><button class="save">收藏到 Raindrop</button><button class="refresh">重新提取</button></div>
    <p class="status" role="status"></p><small>保存文章网址、标题和标签；已有网址不重复保存。</small></section>`;
  document.documentElement.append(host);
  const find = selector => shadow.querySelector(selector);
  let article = null, busy = false;
  function refresh() {
    try {
      article = parser.extract(document, location.href);
      find('.title').value = article.title; find('.tags').value = article.tags.join('\n');
      find('.source').textContent = `来源：${article.source} · ${article.tags.length} 个标签`;
      find('.url').textContent = article.url;
      find('.status').textContent = article.tags.length ? '请检查标题和标签，点击收藏即可提交。' : '没有识别到文章标签；请手动补充，或等待页面加载后重新提取。';
      find('.save').disabled = false;
    } catch (error) { article = null; find('.save').disabled = true; find('.status').textContent = error.message; }
  }
  async function save() {
    if (busy || !article) return;
    try {
      const work = parser.validate({ ...article, title: find('.title').value, tags: find('.tags').value.split('\n') }, location.href);
      busy = true;
      for (const control of shadow.querySelectorAll('.save,.refresh,input,textarea')) control.disabled = true;
      find('.status').textContent = '正在查重并保存…';
      const result = await chrome.runtime.sendMessage({ type: 'loveav-save-cg-article', article: work });
      if (!result?.ok) throw Error(result?.error || '扩展未响应，请重新加载扩展并刷新页面');
      find('.status').textContent = result.status === 'exists' ? '这个网址已经存在于 Raindrop，未重复保存，也未修改原收藏。' : `已保存到「${result.folder}」· ${work.tags.length} 个标签`;
    } catch (error) { find('.status').textContent = `未确认保存：${error.message}`; }
    finally { busy = false; for (const control of shadow.querySelectorAll('.save,.refresh,input,textarea')) control.disabled = false; }
  }
  function open(autoSave = false) {
    find('section').hidden = false;
    find('.launchers').hidden = true;
    if (!busy) {
      refresh();
      if (autoSave && article?.tags.length) void save();
    }
  }
  find('.open').onclick = () => open(true);
  find('.preview').onclick = () => open(false);
  find('.close').onclick = () => { find('section').hidden = true; find('.launchers').hidden = false; };
  find('.refresh').onclick = () => { if (!busy) refresh(); };
  find('.save').onclick = save;
  chrome.storage.local.get('loveavSettings', ({ loveavSettings }) => {
    find('.destination').textContent = `目标文件夹：${loveavSettings?.siteCollectionNames?.['51cg'] || '51cg'}`;
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'loveav-save-current') { open(true); respond({ accepted: true }); }
  });
})();
