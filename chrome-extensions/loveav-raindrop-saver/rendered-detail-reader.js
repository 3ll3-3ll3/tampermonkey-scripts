(function () {
  'use strict';
  // Normal top-level navigation, not a fetch retry, iframe or challenge bypass.
  // Read-only: the source page remains the only place that submits bookmarks.
  globalThis.createLoveAVRenderedReader = function (chrome, core, options = {}) {
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    const jobs = new Set();
    let tail = Promise.resolve();
    const supported = value => {
      try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)missav\.(ai|ws)$/i.test(url.hostname) && !url.username && !url.password; } catch { return false; }
    };
    const matches = (url, code) => supported(url) && core.codeComparableKey(core.workCodeFromUrl(url, 'MissAV')) === core.codeComparableKey(code);
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      for (const job of jobs) if (job.tabId === tabId) job.preserve = true;
    });
    chrome.tabs.onRemoved.addListener(tabId => {
      for (const job of jobs) if (job.sourceId === tabId || job.tabId === tabId) job.cancelled = true;
    });
    async function clean(job) {
      if (!job.tabId || job.preserve) return;
      try {
        const tab = await chrome.tabs.get(job.tabId);
        // Never close a user's existing tab, focused reader, or a reader they navigated elsewhere.
        if (!tab.active && (tab.url === 'about:blank' || matches(tab.url, job.work.code))) await chrome.tabs.remove(job.tabId);
      } catch { /* Already closed. */ }
    }
    async function run(job) {
      try {
        if (job.cancelled) throw Error('读取已停止');
        const source = await chrome.tabs.get(job.sourceId);
        if (!supported(source.url)) throw Error('来源网页已关闭或离开 MissAV，请重新开始');
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false, windowId: source.windowId });
        job.tabId = tab.id;
        await chrome.tabs.update(tab.id, { muted: true });
        if (job.cancelled) throw Error('读取已停止');
        await chrome.tabs.update(tab.id, { url: job.work.url });
        const start = now();
        let signature = '', stableSince = 0, reason = '详情页尚未完成加载';
        while (now() - start < (options.timeoutMs ?? 20000)) {
          if (job.cancelled) throw Error('读取已停止');
          let result;
          try {
            result = await chrome.tabs.sendMessage(tab.id, { type: 'loveav-probe-rendered-detail', code: job.work.code }, { frameId: 0 });
          } catch { /* Content script may not have reached document_idle yet. */ }
          if (result?.blocked) {
            job.preserve = true;
            return { ok: false, blocked: true, error: '详情页要求登录或访问验证；已保留读取标签页，请手动检查后重新收藏' };
          }
          if (result?.work && !result.work.detailError && result.ready && matches(result.url, job.work.code)
              && matches(result.work.url, job.work.code)
              && core.codeComparableKey(result.work.code) === core.codeComparableKey(job.work.code)
              && (result.work.actresses?.length || result.work.typeTags?.length)) {
            const current = JSON.stringify(result.work);
            if (current !== signature) { signature = current; stableSince = now(); }
            // Allow delayed client-side metadata to settle before taking the same DOM snapshot
            // that the detail-page single-save button uses.
            if (now() - stableSince >= (options.settleMs ?? 1200)) return { ok: true, work: result.work };
          } else {
            signature = ''; stableSince = 0;
            reason = result?.error || '详情页尚未完成加载或作品不匹配';
          }
          await sleep(options.pollMs ?? 400);
        }
        return { ok: false, error: `${reason}；已等待详情页加载，未提交空标签。可进入作品页检查后重试` };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      } finally { await clean(job); jobs.delete(job); }
    }
    return {
      read(work, sender) {
        if (!sender.tab?.id || sender.frameId > 0 || !supported(sender.url) || !matches(work?.url, work?.code)) {
          return Promise.resolve({ ok: false, error: '只允许 MissAV 来源页读取匹配番号的 MissAV 详情链接' });
        }
        const job = { sourceId: sender.tab.id, work, tabId: null, preserve: false, cancelled: false };
        jobs.add(job);
        const result = tail.then(() => run(job));
        tail = result.catch(() => {});
        return result;
      },
      cancel(sourceId) { for (const job of jobs) if (job.sourceId === sourceId) job.cancelled = true; },
    };
  };
})();
