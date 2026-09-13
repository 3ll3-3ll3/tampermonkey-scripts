'use strict';

importScripts('loveav-core.js');

const CORE = globalThis.LoveAVCore;
const API_ROOT = 'https://api.raindrop.io/rest/v1';
const TOKEN_URL = 'https://raindrop.io/oauth/access_token';
const DEFAULT_SETTINGS = Object.freeze({
  autoCreateCollections: true,
  collectionNames: {
    [CORE.FOLDERS.reference]: CORE.FOLDERS.reference,
    [CORE.FOLDERS.needCheck]: CORE.FOLDERS.needCheck,
    [CORE.FOLDERS.other]: CORE.FOLDERS.other,
  },
  collectionIds: {},
});

let collectionCache = null;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function launchWebAuthFlow(details) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(details, (redirectedTo) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(redirectedTo);
    });
  });
}

async function exchangeToken(body) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Raindrop OAuth HTTP ${response.status}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || body.refresh_token || '',
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 1209599) * 1000,
    tokenType: data.token_type || 'Bearer',
  };
}

async function authorizeRaindrop(clientId, clientSecret) {
  const safeClientId = String(clientId || '').trim();
  const safeClientSecret = String(clientSecret || '').trim();
  if (!safeClientId || !safeClientSecret) throw new Error('请填写 Raindrop Client ID 和 Client Secret');
  const redirectUri = chrome.identity.getRedirectURL('raindrop');
  const authorizeUrl = new URL('https://raindrop.io/oauth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', safeClientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  const redirectedTo = await launchWebAuthFlow({ url: authorizeUrl.href, interactive: true });
  if (!redirectedTo) throw new Error('Raindrop 没有返回授权结果');
  const redirected = new URL(redirectedTo);
  if (redirected.searchParams.get('error')) throw new Error(`Raindrop 授权失败：${redirected.searchParams.get('error')}`);
  const code = redirected.searchParams.get('code');
  if (!code) throw new Error('Raindrop 授权结果中没有 code');
  const token = await exchangeToken({
    grant_type: 'authorization_code',
    code,
    client_id: safeClientId,
    client_secret: safeClientSecret,
    redirect_uri: redirectUri,
  });
  await storageSet({
    raindropOAuth: {
      clientId: safeClientId,
      clientSecret: safeClientSecret,
      redirectUri,
      ...token,
    },
  });
  collectionCache = null;
  return { redirectUri, expiresAt: token.expiresAt };
}

async function accessToken() {
  const { raindropOAuth } = await storageGet('raindropOAuth');
  if (!raindropOAuth?.accessToken) throw new Error('尚未授权 Raindrop，请先完成扩展设置');
  if (Number(raindropOAuth.expiresAt) > Date.now() + 60_000) return raindropOAuth.accessToken;
  if (!raindropOAuth.refreshToken || !raindropOAuth.clientId || !raindropOAuth.clientSecret) {
    throw new Error('Raindrop 授权已过期，请在设置页重新授权');
  }
  const token = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: raindropOAuth.refreshToken,
    client_id: raindropOAuth.clientId,
    client_secret: raindropOAuth.clientSecret,
  });
  await storageSet({ raindropOAuth: { ...raindropOAuth, ...token } });
  return token.accessToken;
}

async function api(path, options = {}) {
  const token = await accessToken();
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await storageSet({ raindropOAuth: null });
    throw new Error('Raindrop 授权失效，请在设置页重新授权');
  }
  if (!response.ok || data.result === false && data.error) {
    throw new Error(data.errorMessage || data.error || `Raindrop API HTTP ${response.status}`);
  }
  return data;
}

async function allCollections(force = false) {
  if (!force && collectionCache && collectionCache.expiresAt > Date.now()) return collectionCache.items;
  const [root, children] = await Promise.all([
    api('/collections'),
    api('/collections/childrens'),
  ]);
  const byId = new Map();
  for (const item of [...(root.items || []), ...(children.items || [])]) {
    if (item?._id != null) byId.set(Number(item._id), item);
  }
  const items = [...byId.values()];
  collectionCache = { items, expiresAt: Date.now() + 5 * 60_000 };
  return items;
}

function mergedSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    collectionNames: { ...DEFAULT_SETTINGS.collectionNames, ...(settings?.collectionNames || {}) },
    collectionIds: { ...(settings?.collectionIds || {}) },
  };
}

async function resolveCollection(folder, settings) {
  const idOverride = Number(settings.collectionIds?.[folder]);
  if (Number.isInteger(idOverride) && idOverride > 0) return idOverride;
  const title = String(settings.collectionNames?.[folder] || folder).trim();
  let collections = await allCollections();
  let matches = collections.filter((item) => String(item.title || '').trim().toLocaleLowerCase() === title.toLocaleLowerCase());
  if (matches.length > 1) {
    throw new Error(`Raindrop 中有多个同名收藏夹「${title}」，请在设置页填写该收藏夹 ID`);
  }
  if (matches.length === 1) return Number(matches[0]._id);
  if (!settings.autoCreateCollections) throw new Error(`Raindrop 中没有收藏夹「${title}」`);
  const created = await api('/collection', {
    method: 'POST',
    body: JSON.stringify({ title, public: false, view: 'list' }),
  });
  const newId = Number(created.item?._id);
  if (!newId) throw new Error(`创建 Raindrop 收藏夹「${title}」失败`);
  collectionCache = null;
  return newId;
}

async function urlExists(url) {
  const result = await api('/import/url/exists', {
    method: 'POST',
    body: JSON.stringify({ urls: [url] }),
  });
  return Array.isArray(result.ids) && result.ids.length > 0;
}

function chunks(items, size = 100) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function splitNewAndExisting(items) {
  if (!items.length) return { fresh: [], existing: [] };
  const result = await api('/import/url/exists', {
    method: 'POST',
    body: JSON.stringify({ urls: items.map((item) => item.url) }),
  });
  const count = Array.isArray(result.ids) ? result.ids.length : 0;
  if (!count) return { fresh: items, existing: [] };
  if (items.length === 1 || count >= items.length) return { fresh: [], existing: items };
  const middle = Math.ceil(items.length / 2);
  const [left, right] = await Promise.all([
    splitNewAndExisting(items.slice(0, middle)),
    splitNewAndExisting(items.slice(middle)),
  ]);
  return {
    fresh: [...left.fresh, ...right.fresh],
    existing: [...left.existing, ...right.existing],
  };
}

async function batchNewAndExisting(items) {
  const output = { fresh: [], existing: [] };
  for (const group of chunks(items, 100)) {
    const result = await splitNewAndExisting(group);
    output.fresh.push(...result.fresh);
    output.existing.push(...result.existing);
  }
  return output;
}

function raindropPayload(work, collectionId) {
  const excerpt = work.title && work.title !== work.code
    ? `${work.site || 'LoveAV'}：${work.title}`.slice(0, 1000)
    : `由 LoveAV 一键收藏（${work.site || '网页'}）`;
  return {
    link: work.url,
    title: work.code,
    excerpt,
    tags: work.tags,
    collection: { $id: collectionId },
    ...(work.cover ? { cover: work.cover } : {}),
  };
}

async function saveWork(rawWork) {
  const [{ loveavRules, loveavSettings }, token] = await Promise.all([
    storageGet(['loveavRules', 'loveavSettings']),
    accessToken(),
  ]);
  void token;
  if (!loveavRules?.referenceTags?.length) throw new Error('尚未导入 LoveAV 规则，请先完成扩展设置');
  const work = CORE.classifyWork(rawWork, loveavRules);
  if (work.excluded) {
    return { ok: true, status: 'excluded', matches: work.exportBlacklistMatches, folder: '' };
  }
  if (await urlExists(work.url)) return { ok: true, status: 'exists', folder: work.folder };
  const settings = mergedSettings(loveavSettings);
  const collectionId = await resolveCollection(work.folder, settings);
  const result = await api('/raindrop', {
    method: 'POST',
    body: JSON.stringify(raindropPayload(work, collectionId)),
  });
  if (!result.result || !result.item?._id) throw new Error('Raindrop 没有确认保存成功');
  return { ok: true, status: 'created', folder: work.folder, id: result.item._id };
}

async function saveWorks(rawWorks) {
  const [{ loveavRules, loveavSettings }, token] = await Promise.all([
    storageGet(['loveavRules', 'loveavSettings']),
    accessToken(),
  ]);
  void token;
  if (!loveavRules?.referenceTags?.length) throw new Error('尚未导入 LoveAV 规则，请先完成扩展设置');
  const unique = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawWorks) ? rawWorks : []) {
    if (!raw?.url || !raw?.code) continue;
    const key = String(raw.url).toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(CORE.classifyWork(raw, loveavRules));
  }
  if (!unique.length) throw new Error('没有收到可保存的作品');
  const excludedWorks = unique.filter((item) => item.excluded);
  const candidates = unique.filter((item) => !item.excluded);
  const { fresh, existing } = await batchNewAndExisting(candidates);
  const settings = mergedSettings(loveavSettings);
  const byFolder = new Map();
  for (const work of fresh) {
    if (!byFolder.has(work.folder)) byFolder.set(work.folder, []);
    byFolder.get(work.folder).push(work);
  }
  let created = 0;
  const folderCounts = {};
  const errors = [];
  for (const [folder, works] of byFolder) {
    try {
      const collectionId = await resolveCollection(folder, settings);
      for (const group of chunks(works, 100)) {
        const result = await api('/raindrops', {
          method: 'POST',
          body: JSON.stringify({ items: group.map((work) => raindropPayload(work, collectionId)) }),
        });
        const count = Array.isArray(result.items) ? result.items.length : result.result ? group.length : 0;
        created += count;
        folderCounts[folder] = (folderCounts[folder] || 0) + count;
      }
    } catch (error) {
      errors.push(`${folder}：${error.message || String(error)}`);
    }
  }
  return {
    ok: true,
    status: 'batch',
    total: unique.length,
    created,
    existing: existing.length,
    excluded: excludedWorks.length,
    failed: fresh.length - created,
    folderCounts,
    errors,
  };
}

async function connectionStatus() {
  const { raindropOAuth, loveavRules, loveavSettings } = await storageGet([
    'raindropOAuth', 'loveavRules', 'loveavSettings',
  ]);
  return {
    authorized: Boolean(raindropOAuth?.accessToken),
    expiresAt: Number(raindropOAuth?.expiresAt) || 0,
    rulesReady: Boolean(loveavRules?.referenceTags?.length),
    ruleStats: loveavRules?.stats || null,
    settings: mergedSettings(loveavSettings),
    redirectUri: chrome.identity.getRedirectURL('raindrop'),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case 'loveav-save-work': return saveWork(message.work);
      case 'loveav-save-works': return saveWorks(message.works);
      case 'loveav-oauth-authorize': return { ok: true, ...(await authorizeRaindrop(message.clientId, message.clientSecret)) };
      case 'loveav-status': return { ok: true, ...(await connectionStatus()) };
      case 'loveav-list-collections': return { ok: true, items: await allCollections(true) };
      case 'loveav-clear-oauth':
        await storageSet({ raindropOAuth: null });
        collectionCache = null;
        return { ok: true };
      default: return { ok: false, error: '未知消息' };
    }
  };
  run().then(sendResponse).catch(async (error) => {
    const text = error.message || String(error);
    if (message?.type?.startsWith('loveav-save-') && /尚未|授权.*失效|重新授权/.test(text)) {
      await chrome.runtime.openOptionsPage();
    }
    sendResponse({ ok: false, error: text });
  });
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id) throw new Error('没有活动标签页');
    await chrome.tabs.sendMessage(tab.id, { type: 'loveav-save-current' });
  } catch {
    await chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
