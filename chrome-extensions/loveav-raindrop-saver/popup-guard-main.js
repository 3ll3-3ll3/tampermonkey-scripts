(() => {
  'use strict';
  // MAIN world: isolated-world window.open overrides do not affect page scripts.
  // This is nuisance prevention, not an adversarial security boundary.
  let enabled = true, external = true, count = 0;
  const originalOpen = window.open;
  const originalSubmit = HTMLFormElement.prototype.submit;
  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  const post = window.postMessage.bind(window);
  const entries = [];
  let permit = null;
  function address(value) {
    try { const url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) ? url : null; } catch { return null; }
  }
  function notify() {
    post({ type: 'loveav-popup-stats', count, entries: entries.map(({ id, reason, domain, allowable }) => ({ id, reason, domain, allowable })) }, '*');
  }
  function block(reason, value, link = null) {
    const url = address(value);
    count++;
    entries.push({ id: count, reason, domain: url?.hostname || '空白地址或非网页协议', allowable: !!(link && url), href: url?.href, link: link ? new WeakRef(link) : null });
    if (entries.length > 30) entries.shift();
    notify();
  }
  function outside(value) {
    try {
      const base = location.href === 'about:blank' ? document.baseURI : location.href;
      const target = new URL(value, base);
      const here = new URL(base);
      return !['http:', 'https:'].includes(target.protocol) || target.origin !== here.origin;
    } catch { return true; }
  }
  function targetOf(node) {
    return (node.getAttribute('target') || document.querySelector('base[target]')?.getAttribute('target') || '_self').toLowerCase();
  }
  function newContext(target) { return !['_self', '_top', '_parent'].includes(target); }
  function blockedForm(form, submitter) {
    const target = (submitter?.getAttribute('formtarget') || targetOf(form)).toLowerCase();
    const action = submitter?.getAttribute('formaction') || form.getAttribute('action') || location.href;
    return (enabled && newContext(target)) || (external && outside(action));
  }
  window.open = function (...args) {
    if (enabled || (external && outside(args[0] || 'about:blank'))) { block('脚本打开窗口', args[0]); return null; }
    return Reflect.apply(originalOpen, this, args);
  };
  // Prevent form.submit() from bypassing the submit event.
  HTMLFormElement.prototype.submit = function (...args) {
    if (blockedForm(this)) { block('表单跳转', this.action); return; }
    return Reflect.apply(originalSubmit, this, args);
  };
  if (originalRequestSubmit) HTMLFormElement.prototype.requestSubmit = function (submitter) {
    if (blockedForm(this, submitter)) { block('表单跳转', submitter?.formAction || this.action); return; }
    return Reflect.apply(originalRequestSubmit, this, arguments);
  };
  function interceptLink(event) {
    // The isolated-world picker cancels this click itself and needs to see it.
    if (document.documentElement?.hasAttribute('data-loveav-guard-picking')) return;
    const path = event.composedPath();
    if (path.some(node => node?.id === 'loveav-reading-guard')) return;
    const link = path.find(node => node instanceof Element && node.matches('a[href],area[href]'));
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (permit && Date.now() > permit.expires) permit = null;
    if (event.isTrusted && permit?.link.deref() === link && permit.href === address(href)?.href) {
      permit = null; return;
    }
    const isOutside = outside(href);
    const scripted = !event.isTrusted;
    const opensWindow = newContext(targetOf(link)) || event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1;
    // Genuine same-site navigation, including Ctrl-click, is left to the browser.
    if ((external && isOutside) || (enabled && opensWindow && (isOutside || scripted))) {
      event.preventDefault(); event.stopImmediatePropagation(); block(isOutside ? '外站或非网页链接' : '脚本触发新标签页', href, link);
    }
  }
  window.addEventListener('click', interceptLink, true);
  window.addEventListener('auxclick', interceptLink, true);
  window.addEventListener('submit', event => {
    if (event.target instanceof HTMLFormElement && blockedForm(event.target, event.submitter)) {
      event.preventDefault(); event.stopImmediatePropagation(); block('表单跳转', event.target.action);
    }
  }, true);
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type === 'loveav-popup-config') {
      enabled = event.data.popups !== false;
      external = event.data.external !== false;
      permit = null;
    } else if (event.data?.type === 'loveav-popup-query') notify();
    else if (event.data?.type === 'loveav-popup-allow-once') {
      const entry = entries.find(item => item.id === event.data.id && item.allowable && item.link?.deref()?.isConnected);
      if (entry) permit = { href: entry.href, link: entry.link, expires: Date.now() + 30000 };
      post({ type: 'loveav-popup-permit-result', allowed: !!entry }, '*');
    }
  });
  post({ type: 'loveav-popup-ready' }, '*');
})();
