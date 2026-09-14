(function () {
  'use strict';
  // Site selectors and retry limits adapted from the two standalone userscripts.
  globalThis.LoveAVHomeLoader = function ({ scan, choose, save, isBusy, destination }) {
    const rows = new Map();
    const moreText = /^(?:load\s*more|加载更多|载入更多|載入更多|更多を読み込む|もっと見る)$/iu;
    let container, running = null, stopped = false;
    const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
    const conflict = () => Boolean(document.querySelector('#missav-auto-loader-panel, #missav-auto-loader-launcher, #av123-home-tools-panel, #av123-home-tools-launcher'));
    const unique = (items) => [...new Map(items.map((item) => [item.url.toLowerCase(), item])).values()];

    function discover() {
      const found = [], seen = new Set();
      const add = (section, grid, button) => {
        if (!grid || seen.has(grid)) return;
        seen.add(grid);
        const title = text(section.querySelector('h1,h2,h3,h4,h5,h6')) || text(section.querySelector('.section__head')) || '未命名板块';
        const ordinal = found.filter((item) => item.title === title).length;
        found.push({ key: `${title}::${ordinal}`, title, section, grid, button });
      };
      if (location.hostname.includes('123av')) {
        for (const [index, section] of [...document.querySelectorAll('.featured')].entries()) {
          found.push({ key: `featured::${index}`, title: '顶部推荐轮播', section, grid: section, button: null, featured: true });
        }
        for (const section of document.querySelectorAll('.rec__section')) add(section, section.querySelector('.rec__grid'), section.querySelector('.rec__more-btn'));
      } else {
        // Discover grids even after their Load More button disappears at the last page.
        for (const grid of document.querySelectorAll('.grid, [class*="grid-cols-"]')) {
          let section = grid.parentElement;
          for (let depth = 0; section && depth < 4; depth++, section = section.parentElement) {
            if (!section.querySelector('h1,h2,h3,h4,h5,h6')) continue;
            if (section.querySelectorAll('.grid, [class*="grid-cols-"]').length > 1) break;
            let button = [...section.querySelectorAll('a,button')].find((node) => moreText.test(text(node)));
            const sibling = section.nextElementSibling;
            if (!button && sibling) button = [...sibling.querySelectorAll('a,button')].find((node) => moreText.test(text(node)) || (sibling.classList.contains('absolute') && node.getAttribute('href') === '#'));
            if (button || rows.has(`${text(section.querySelector('h1,h2,h3,h4,h5,h6'))}::0`)) add(section, grid, button);
            break;
          }
        }
      }
      const anchors = scan();
      return found.map((item) => ({ ...item, works: unique(anchors.filter(({ anchor }) => item.grid.contains(anchor) && (!item.featured || anchor.matches('.featured__link[href]'))).map(({ work, anchor }) => item.featured
        ? { ...work, title: text(anchor.querySelector('h1,h2,h3,h4,h5,h6')) || text(anchor) || work.title }
        : work)) }));
    }

    function status(row, message) { row.status.textContent = message; }
    function ready(button) {
      if (!button?.isConnected || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      const style = getComputedStyle(button);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }
    function check() {
      if (stopped) throw Error('已停止；未执行后续选择或收藏');
      if (conflict()) throw Error('检测到旧油猴加载脚本，请先停用对应脚本并刷新网页');
    }
    async function pause(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) { check(); await new Promise((resolve) => setTimeout(resolve, Math.min(150, end - Date.now()))); }
      check();
    }
    function current(key) { return discover().find((item) => item.key === key); }
    async function run(row) {
      if (running || isBusy()) return;
      stopped = false;
      try {
        check();
        const target = Number(row.target.value);
        if (!Number.isInteger(target) || target < 1 || target > 10000) throw Error('目标总数请输入 1–10000 的整数');
        const initial = current(row.key);
        if (!initial) throw Error('板块已变化，请刷新识别');
        const startKeys = new Set(initial.works.map((work) => work.url.toLowerCase()));
        const mode = row.mode.value, scope = row.scope.value;
        const page = location.href;
        running = row;
        refresh();
        let stalled = 0;
        while (true) {
          check();
          if (location.href !== page) throw Error('页面已切换，本次加载结束');
          const item = current(row.key);
          if (!item) throw Error('板块结构已变化，已停止');
          status(row, `正在加载 ${item.works.length} / ${target}`);
          if (item.works.length >= target) break;
          if (!item.button) throw Error(`已无更多内容：${item.works.length}/${target}；可使用下方按钮手动选择当前内容`);
          const readyUntil = Date.now() + 10000;
          let next = item;
          while (!ready(next.button) && Date.now() < readyUntil) {
            await pause(200); next = current(row.key);
            if (!next) throw Error('板块已消失');
          }
          if (!ready(next.button)) throw Error('加载按钮长时间不可用，已停止');
          const before = next.works.length;
          next.button.click();
          const deadline = Date.now() + 20000;
          let after;
          do { await pause(200); after = current(row.key); } while (after && after.works.length <= before && after.button && Date.now() < deadline);
          if (!after) throw Error('板块已消失');
          if (after.works.length > before) stalled = 0;
          else if (++stalled >= 3) throw Error('连续 3 次无新增，已停机');
          refresh();
          await pause(stalled ? 1000 * stalled : 900);
        }
        check();
        const final = current(row.key);
        const works = final.works.filter((work) => scope !== 'new' || !startKeys.has(work.url.toLowerCase()));
        status(row, `加载完成 ${final.works.length} 条；本次范围 ${works.length} 条`);
        if (mode === 'select') choose(works);
        if (mode === 'save' && works.length) {
          row.stop.disabled = true;
          status(row, `加载完成，正在收藏本次范围 ${works.length} 条；结果见处理面板`);
          await save(works);
          status(row, '收藏流程已结束；新增、已存在及失败详情见处理面板');
        }
      } catch (error) { status(row, error.message || String(error)); }
      finally { running = null; refresh(); }
    }

    function makeFeaturedRow(item) {
      const element = document.createElement('div');
      element.className = 'load-row featured-row';
      element.innerHTML = `<strong>顶部推荐轮播</strong><span class="load-count"></span>
        <p class="load-note">包含已在页面中的隐藏轮播项，无需手动翻页。可展开标题列表挑选作品。</p>
        <div class="load-destination"></div>
        <div class="actions"><button class="secondary featured-all">勾选全部推荐</button><button class="secondary featured-pick">勾选列表中所选</button><button class="secondary featured-save">收藏全部推荐</button><button class="secondary featured-copy">提取并复制全部标题</button></div>
        <details><summary>展开全部推荐标题 / 挑选</summary><div class="featured-list"></div></details>
        <div class="load-status" role="status">等待操作</div>`;
      const row = { key: item.key, element, featured: true, picks: new Set(), signature: '' };
      for (const name of ['status','count','destination']) row[name] = element.querySelector(`.load-${name}`);
      const getWorks = () => current(row.key)?.works || [];
      element.querySelector('.featured-all').addEventListener('click', () => { if (!running && !isBusy()) choose(getWorks()); });
      element.querySelector('.featured-pick').addEventListener('click', () => {
        if (running || isBusy()) return;
        const works = getWorks().filter((work) => row.picks.has(work.url.toLowerCase()));
        if (works.length) choose(works); else status(row, '请先展开标题列表勾选作品');
      });
      element.querySelector('.featured-copy').addEventListener('click', async () => {
        try {
          const works = getWorks();
          if (!works.length) throw Error('没有识别到推荐作品');
          await navigator.clipboard.writeText(works.map((work) => work.title).join('\n'));
          status(row, `已复制 ${works.length} 条完整标题（包含番号）`);
        } catch (error) { status(row, `复制失败：${error.message}；可从下方列表查看标题`); }
      });
      element.querySelector('.featured-save').addEventListener('click', async () => {
        if (running || isBusy()) return;
        const works = getWorks();
        if (!works.length) { status(row, '没有识别到推荐作品'); return; }
        running = row; refresh();
        try {
          status(row, `正在收藏 ${works.length} 个推荐作品`);
          await save(works);
          status(row, '收藏流程已结束；结果见处理面板');
        } catch (error) { status(row, error.message || String(error)); }
        finally { running = null; refresh(); }
      });
      return row;
    }

    function renderFeatured(row, works) {
      const signature = JSON.stringify(works.map((work) => [work.url, work.title]));
      if (row.signature === signature) return;
      row.signature = signature;
      const list = row.element.querySelector('.featured-list');
      list.replaceChildren();
      for (const work of works) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = row.picks.has(work.url.toLowerCase());
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) row.picks.add(work.url.toLowerCase()); else row.picks.delete(work.url.toLowerCase());
        });
        label.append(checkbox, document.createTextNode(work.title));
        list.append(label);
      }
    }

    function makeRow(item) {
      const element = document.createElement('div');
      element.className = 'load-row';
      element.innerHTML = `<strong class="load-title"></strong><span class="load-count"></span>
        <label>目标总数 <input class="load-target" type="number" min="1" max="10000" value="100"></label>
        <label>完成后 <select class="load-mode"><option value="load">仅加载</option><option value="select" selected>加载后勾选</option><option value="save">加载后自动收藏</option></select></label>
        <label>作品范围 <select class="load-scope"><option value="all">整个板块</option><option value="new">本次新增</option></select></label>
        <div class="load-destination"></div><div class="actions"><button class="secondary load-start">开始</button><button class="secondary load-stop" disabled>停止加载</button><button class="secondary load-select">勾选当前板块</button></div><div class="load-status" role="status">等待开始</div>`;
      element.querySelector('.load-title').textContent = item.title;
      const row = { key: item.key, element };
      for (const name of ['target','mode','scope','start','stop','status','count','destination']) row[name] = element.querySelector(`.load-${name}`);
      row.start.addEventListener('click', () => run(row));
      row.stop.addEventListener('click', () => { stopped = true; });
      element.querySelector('.load-select').addEventListener('click', () => { if (!running && !isBusy()) choose(current(row.key)?.works || []); });
      return row;
    }
    function refresh() {
      if (!container) return;
      const sections = discover();
      for (const item of sections) {
        if (!rows.has(item.key)) rows.set(item.key, item.featured ? makeFeaturedRow(item) : makeRow(item));
        const row = rows.get(item.key);
        if (row.element.parentElement !== container) container.append(row.element);
        row.count.textContent = ` · 当前 ${item.works.length}`;
        row.destination.textContent = `收藏目标：${destination()}。${item.featured ? '轮播项按作品 URL 去重。' : '按整批加载，最终数量可能略超目标。'}`;
        if (item.featured) renderFeatured(row, item.works);
      }
      for (const [key, row] of rows) {
        const missing = !sections.some((item) => item.key === key);
        row.element.hidden = missing && running !== row;
        for (const control of row.element.querySelectorAll('input,select,button')) control.disabled = Boolean(running) || isBusy() || missing;
        if (row.stop) row.stop.disabled = running !== row || isBusy();
      }
      container.parentElement.querySelector('.load-empty').hidden = sections.length > 0;
      container.parentElement.querySelector('.load-conflict').hidden = !conflict();
    }
    return {
      mount(node) { container = node; refresh(); },
      refresh,
      get active() { return Boolean(running); },
      stop() { stopped = true; },
    };
  };
})();
