(() => {
  'use strict';
  const KEY = 'loveavReadingGuard';
  let config = { popups: true, external: true };
  const publish = () => window.postMessage({ type: 'loveav-popup-config', ...config }, '*');
  function update(raw) {
    config = { popups: raw?.popups !== false, external: raw?.external !== false };
    publish();
  }
  window.addEventListener('message', event => {
    if (event.source === window && event.data?.type === 'loveav-popup-ready') publish();
  });
  chrome.storage.local.get(KEY).then(data => update(data[KEY])).catch(publish);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) update(changes[KEY].newValue);
  });
})();
