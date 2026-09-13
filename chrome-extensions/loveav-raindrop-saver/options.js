'use strict';

const CORE = globalThis.LoveAVCore;
const folderSettings = document.getElementById('folder-settings');
const folderInputs = new Map();
const siteFolderSettings = document.getElementById('site-folder-settings');
const siteFolderInputs = new Map();
const SITE_DEFAULTS = Object.freeze({ MissAV: 'MissAV', '123AV': 'javxxx&123av' });

function setStatus(id, message, kind = '') {
  const element = document.getElementById(id);
  element.textContent = message;
  element.dataset.kind = kind;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || '扩展后台没有响应'));
      else resolve(response);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function fileByName(files, name) {
  const lower = name.toLocaleLowerCase();
  return [...files].find((file) => file.name.toLocaleLowerCase() === lower);
}

async function importRuleFiles(library, referenceBlacklist, exportBlacklist) {
  if (!library || !referenceBlacklist || !exportBlacklist) {
    throw new Error('需要同时找到主体库 CSV 和两份黑名单 TXT');
  }
  setStatus('rules-status', '正在本机生成规则索引…');
  const [libraryText, referenceText, exportText] = await Promise.all([
    library.text(), referenceBlacklist.text(), exportBlacklist.text(),
  ]);
  const rules = CORE.deriveRules(libraryText, referenceText, exportText);
  await storageSet({ loveavRules: rules });
  const stats = rules.stats;
  setStatus(
    'rules-status',
    `规则已就绪：主体库 ${stats.libraryRows} 行，参考女优 Tag ${stats.referenceTagsStored} 个，导出黑名单 ${stats.exportBlacklistTagsStored} 个。`,
    'success',
  );
}

document.getElementById('rules-directory').addEventListener('change', async (event) => {
  try {
    const files = event.target.files;
    await importRuleFiles(
      fileByName(files, 'missav-library.csv'),
      fileByName(files, '1-参考女优Tag库黑名单.txt'),
      fileByName(files, '2-Raindrop导出黑名单.txt'),
    );
  } catch (error) {
    setStatus('rules-status', error.message, 'error');
  }
});

document.getElementById('import-individual').addEventListener('click', async () => {
  try {
    await importRuleFiles(
      document.getElementById('library-file').files[0],
      document.getElementById('reference-blacklist-file').files[0],
      document.getElementById('export-blacklist-file').files[0],
    );
  } catch (error) {
    setStatus('rules-status', error.message, 'error');
  }
});

document.getElementById('copy-redirect').addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.getElementById('redirect-uri').textContent);
  setStatus('oauth-status', 'Redirect URI 已复制', 'success');
});

document.getElementById('authorize').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus('oauth-status', '正在打开 Raindrop 授权页…');
  try {
    const response = await send({
      type: 'loveav-oauth-authorize',
      clientId: document.getElementById('client-id').value,
      clientSecret: document.getElementById('client-secret').value,
    });
    document.getElementById('client-secret').value = '';
    setStatus('oauth-status', `Raindrop 已授权，有效期至 ${new Date(response.expiresAt).toLocaleString()}（到期会自动刷新）`, 'success');
  } catch (error) {
    setStatus('oauth-status', error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('disconnect').addEventListener('click', async () => {
  try {
    await send({ type: 'loveav-clear-oauth' });
    setStatus('oauth-status', '已从本机扩展存储删除 Raindrop 授权', 'success');
  } catch (error) {
    setStatus('oauth-status', error.message, 'error');
  }
});

function renderFolderSettings(settings) {
  folderSettings.replaceChildren();
  folderInputs.clear();
  for (const folder of Object.values(CORE.FOLDERS)) {
    const row = document.createElement('div');
    row.className = 'folder-row';
    const key = document.createElement('div');
    key.className = 'folder-key';
    key.textContent = folder;
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Raindrop 收藏夹名称';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = settings.collectionNames?.[folder] || folder;
    nameLabel.append(name);
    const idLabel = document.createElement('label');
    idLabel.textContent = '收藏夹 ID（可选）';
    const id = document.createElement('input');
    id.type = 'number';
    id.min = '1';
    id.placeholder = '自动查找';
    id.value = settings.collectionIds?.[folder] || '';
    idLabel.append(id);
    row.append(key, nameLabel, idLabel);
    folderSettings.append(row);
    folderInputs.set(folder, { name, id });
  }
  siteFolderSettings.replaceChildren();
  siteFolderInputs.clear();
  for (const [site, defaultName] of Object.entries(SITE_DEFAULTS)) {
    const row = document.createElement('div');
    row.className = 'folder-row';
    const key = document.createElement('div');
    key.className = 'folder-key';
    key.textContent = site;
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Raindrop 收藏夹名称';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = settings.siteCollectionNames?.[site] || defaultName;
    nameLabel.append(name);
    const idLabel = document.createElement('label');
    idLabel.textContent = '收藏夹 ID（可选）';
    const id = document.createElement('input');
    id.type = 'number';
    id.min = '1';
    id.placeholder = '按名称自动查找';
    id.value = settings.siteCollectionIds?.[site] || '';
    idLabel.append(id);
    row.append(key, nameLabel, idLabel);
    siteFolderSettings.append(row);
    siteFolderInputs.set(site, { name, id });
  }
  const mode = settings.destinationMode === 'classification' ? 'classification' : 'site';
  document.querySelector(`input[name="destination-mode"][value="${mode}"]`).checked = true;
  document.getElementById('classification-settings').open = mode === 'classification';
  document.getElementById('auto-create').checked = settings.autoCreateCollections !== false;
  const workflow = settings.workflow || {};
  document.getElementById('action-behavior').value = ['workbench', 'save', 'settings'].includes(workflow.actionBehavior)
    ? workflow.actionBehavior : 'workbench';
  document.getElementById('page-primary-action').value = workflow.pagePrimaryAction === 'filter' ? 'filter' : 'save';
  document.getElementById('auto-filter-setting').checked = workflow.autoFilter !== false;
}

document.getElementById('save-settings').addEventListener('click', async () => {
  const collectionNames = {};
  const collectionIds = {};
  const siteCollectionNames = {};
  const siteCollectionIds = {};
  for (const [folder, inputs] of folderInputs) {
    collectionNames[folder] = inputs.name.value.trim() || folder;
    if (Number(inputs.id.value) > 0) collectionIds[folder] = Number(inputs.id.value);
  }
  for (const [site, inputs] of siteFolderInputs) {
    siteCollectionNames[site] = inputs.name.value.trim() || SITE_DEFAULTS[site];
    if (Number(inputs.id.value) > 0) siteCollectionIds[site] = Number(inputs.id.value);
  }
  await storageSet({
    loveavSettings: {
      autoCreateCollections: document.getElementById('auto-create').checked,
      destinationMode: document.querySelector('input[name="destination-mode"]:checked')?.value || 'site',
      workflow: {
        actionBehavior: document.getElementById('action-behavior').value,
        pagePrimaryAction: document.getElementById('page-primary-action').value,
        autoFilter: document.getElementById('auto-filter-setting').checked,
      },
      siteCollectionNames,
      siteCollectionIds,
      collectionNames,
      collectionIds,
    },
  });
  setStatus('settings-status', '收藏夹设置已保存：MissAV → MissAV；123AV → javxxx&123av', 'success');
});

document.getElementById('list-collections').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await send({ type: 'loveav-list-collections' });
    const output = document.getElementById('collections');
    output.textContent = response.items
      .sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'))
      .map((item) => `${item._id}\t${item.title}`)
      .join('\n') || '没有收藏夹';
    output.hidden = false;
  } catch (error) {
    setStatus('settings-status', error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

async function init() {
  try {
    const status = await send({ type: 'loveav-status' });
    document.getElementById('redirect-uri').textContent = status.redirectUri;
    if (status.rulesReady) {
      const stats = status.ruleStats;
      setStatus('rules-status', `规则已就绪：主体库 ${stats.libraryRows} 行，参考女优 Tag ${stats.referenceTagsStored} 个，导出黑名单 ${stats.exportBlacklistTagsStored} 个。`, 'success');
    } else setStatus('rules-status', '尚未导入规则', 'error');
    if (status.authorized) {
      setStatus('oauth-status', `Raindrop 已授权，有效期至 ${new Date(status.expiresAt).toLocaleString()}（到期会自动刷新）`, 'success');
    } else setStatus('oauth-status', '尚未授权 Raindrop', 'error');
    renderFolderSettings(status.settings);
  } catch (error) {
    setStatus('rules-status', error.message, 'error');
    renderFolderSettings({
      destinationMode: 'site',
      siteCollectionNames: SITE_DEFAULTS,
      siteCollectionIds: {},
      collectionNames: {},
      collectionIds: {},
      workflow: { actionBehavior: 'workbench', pagePrimaryAction: 'save', autoFilter: true },
      autoCreateCollections: true,
    });
  }
}

init();
