(() => {
  'use strict';
  // MAIN world: isolated-world window.open overrides do not affect page scripts.
  // This is nuisance prevention, not an adversarial security boundary.
  let enabled = true, external = true, count = 0;
  const originalOpen = window.open;
  const originalSubmit = HTMLFormElement.prototype.submit;
  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  const post = window.postMessage.bind(window);
  function notify() { post({ type: 'loveav-popup-stats', count }, '*'); }
  function block() { count++; notify(); }
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
    if (enabled || (external && outside(args[0] || 'about:blank'))) { block(); return null; }
    return Reflect.apply(originalOpen, this, args);
  };
  // Prevent form.submit() from bypassing the submit event.
  HTMLFormElement.prototype.submit = function (...args) {
    if (blockedForm(this)) { block(); return; }
    return Reflect.apply(originalSubmit, this, args);
  };
  if (originalRequestSubmit) HTMLFormElement.prototype.requestSubmit = function (submitter) {
    if (blockedForm(this, submitter)) { block(); return; }
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
    const isOutside = outside(href);
    const scripted = !event.isTrusted;
    const opensWindow = newContext(targetOf(link)) || event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1;
    // Genuine same-site navigation, including Ctrl-click, is left to the browser.
    if ((external && isOutside) || (enabled && opensWindow && (isOutside || scripted))) {
      event.preventDefault(); event.stopImmediatePropagation(); block();
    }
  }
  window.addEventListener('click', interceptLink, true);
  window.addEventListener('auxclick', interceptLink, true);
  window.addEventListener('submit', event => {
    if (event.target instanceof HTMLFormElement && blockedForm(event.target, event.submitter)) {
      event.preventDefault(); event.stopImmediatePropagation(); block();
    }
  }, true);
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type === 'loveav-popup-config') {
      enabled = event.data.popups !== false;
      external = event.data.external !== false;
    } else if (event.data?.type === 'loveav-popup-query') notify();
  });
  post({ type: 'loveav-popup-ready' }, '*');
})();
