(function () {
  'use strict';
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const labels = {
    actresses: /^(?:女优|女優|女演员|女演員|女優名|actress(?:es)?|female cast)\s*[:：]?$/i,
    typeTags: /^(?:类型|類型|类别|類別|分类|分類|genres?|categor(?:y|ies)|types?)\s*[:：]?$/i,
  };
  const excluded = 'nav,header,footer,[role="navigation"],.rec__grid,.featured,.card,.video-item,.thumbnail';
  function extract(doc, pageUrl, site) {
    const base = new URL(pageUrl);
    const allowed = anchor => {
      try { return new URL(anchor.getAttribute('href'), base).origin === base.origin; } catch { return false; }
    };
    const anchorsIn = node => [...node.querySelectorAll('a[href]')].filter(a => !a.closest(excluded) && allowed(a));
    const pathMatches = (a, kind, labeled) => {
      const path = new URL(a.getAttribute('href'), base).pathname;
      if (/\/(?:actors?|makers?|directors?|series)\//i.test(path)) {
        // Some sites use a generic performer route; only a 123AV female field
        // can establish that an actor link is an actress, never the route alone.
        return kind === 'actresses' && site === '123AV' && labeled && /\/actors?\//i.test(path);
      }
      if (labeled) {
        if (globalThis.LoveAVCore.workCodeFromUrl(new URL(a.getAttribute('href'), base).href, site)) return false;
        if (kind === 'actresses' && /\/(?:genres?|categor(?:y|ies))\//i.test(path)) return false;
        if (kind === 'typeTags' && /\/actresses?\//i.test(path)) return false;
        return true;
      }
      return kind === 'actresses' ? /\/actresses?\//i.test(path) : /\/(?:genres?|categor(?:y|ies))\//i.test(path);
    };
    const output = {};
    for (const kind of Object.keys(labels)) {
      const found = [];
      for (const node of doc.querySelectorAll('span,div,p,li,dt,th,strong,b,label')) {
        if (node.closest(excluded)) continue;
        // Match the field label itself, not a whole ancestor's combined text.
        const own = [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        if (!labels[kind].test(text(node)) && !labels[kind].test(own)) continue;
        let row = node;
        for (let depth = 0; row && depth < 3; depth++, row = row.parentElement) {
          if (row.matches('body,html,main') || row.querySelector('h1') || text(row).length > 1500) break;
          let candidates = anchorsIn(row);
          if (node.matches('dt,th') && row === node && node.nextElementSibling?.matches('dd,td')) candidates = anchorsIn(node.nextElementSibling);
          candidates = candidates.filter(a => pathMatches(a, kind, true));
          if (candidates.length) { found.push(...candidates.map(text)); break; }
        }
      }
      // Unlabelled links are only a fallback; discard global navigation and
      // recommendation cards. Never infer actresses from generic actor links.
      if (!found.length) found.push(...anchorsIn(doc).filter(a => !a.closest('.grid') && pathMatches(a, kind, false)).map(text));
      output[kind] = [...new Set(found.filter(value => value && !/排行|ranking|登录|注册|更多|^\d+$/i.test(value)))];
    }
    return output;
  }
  globalThis.LoveAVPageMetadata = { extract };
})();
