(function (root) {
  'use strict';
  function articleUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['51cg1.com', 'www.51cg1.com'].includes(url.hostname) || url.username || url.password) return '';
      const match = url.pathname.match(/^\/archives\/(\d+)\/?$/);
      return match ? `${url.origin}/archives/${match[1]}/` : '';
    } catch { return ''; }
  }
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const unique = values => [...new Set(values.map(clean).filter(Boolean))];
  function extract(doc, location) {
    const url = articleUrl(location);
    if (!url) throw Error('请在 51cg1.com 的文章详情页使用');
    const title = clean(doc.querySelector('h1')?.textContent || doc.querySelector('meta[property="og:title"]')?.content || doc.title);
    if (!title || /^(?:just a moment|access denied|checking your browser)/i.test(title)) throw Error('文章尚未加载或页面要求访问验证');
    // The live site renders article tags as `.tags > .keywords > a[href="/tag/…"]`
    // without rel=tag. Limit candidates to explicit tag containers and same-site /tag/
    // links so navigation, advertisements, related posts and comments cannot leak in.
    const pageOrigin = new URL(url).origin;
    const nodes = [...doc.querySelectorAll([
      'a[rel~="tag"]',
      '.tags a[href*="/tag/"]',
      '.keywords a[href*="/tag/"]',
      '.post-tags a[href*="/tag/"]',
      '.article-tags a[href*="/tag/"]',
      '.entry-tags a[href*="/tag/"]',
      '.tags-list a[href*="/tag/"]',
    ].join(','))].filter((node) => {
      if (node.closest('nav,header,aside,.sidebar,.related-posts,.related,[role="navigation"]')) return false;
      try {
        const tagUrl = new URL(node.getAttribute('href') || '', url);
        return tagUrl.origin === pageOrigin && tagUrl.pathname.startsWith('/tag/');
      } catch { return false; }
    });
    let tags = unique(nodes.map(node => node.textContent));
    let source = '文章标签';
    if (!tags.length) {
      tags = unique([...doc.querySelectorAll('meta[property="article:tag"]')].map(node => node.content));
      source = '文章标签元数据';
    }
    if (!tags.length) {
      tags = unique((doc.querySelector('meta[name="keywords"]')?.content || '').split(/[,，;；]/));
      source = '网页关键词（请检查是否包含站点通用词）';
    }
    return { site: '51cg', url, title, tags, source };
  }
  function validate(raw, senderUrl) {
    const url = articleUrl(raw?.url);
    if (!url || articleUrl(senderUrl) !== url) throw Error('只能收藏当前 51cg 文章，来源网址不匹配');
    const title = clean(raw.title);
    const tags = unique(Array.isArray(raw.tags) ? raw.tags : []);
    if (!title || title.length > 1000) throw Error('请填写有效文章标题（最多 1000 字）');
    if (!tags.length) throw Error('未识别到标签，请在预览中检查或手动补充');
    if (tags.length > 100 || tags.some(tag => tag.length > 100)) throw Error('标签过多或过长，请检查预览（最多 100 个，每个最多 100 字）');
    return { site: '51cg', url, title, tags };
  }
  const api = { articleUrl, extract, validate };
  root.LoveAVCGArticle = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
