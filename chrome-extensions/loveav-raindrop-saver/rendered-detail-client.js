(function () {
  'use strict';
  globalThis.LoveAVRenderedDetailClient = {
    async read(work) {
      const result = await chrome.runtime.sendMessage({ type: 'loveav-read-rendered-detail', work });
      if (!result?.ok || !result.work) {
        const error = new Error(result?.error || '详情读取模块未就绪，请重新加载扩展并刷新网页');
        error.blocked = Boolean(result?.blocked);
        throw error;
      }
      return result.work;
    },
    cancel() { chrome.runtime.sendMessage({ type: 'loveav-cancel-rendered-detail' }).catch(() => {}); },
  };
})();
