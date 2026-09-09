import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const core = await readFile(path.join(root, 'missav-code-filter-core.js'), 'utf8');
const ui = await readFile(path.join(root, 'missav-code-filter.js'), 'utf8');
const outputPath = path.join(root, 'missav-code-filter.user.js');

const header = `// ==UserScript==
// @name         MissAV 番号过滤器（v0.5.13 兼容）
// @namespace    wjl.local
// @version      1.0.0
// @description  复刻 MissAV Manager v0.5.13 的番号过滤器，支持粘贴、多文件、Raindrop CSV、复制与 TXT 下载。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @match        https://missav.ws/*
// @match        https://*.missav.ws/*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + core.replace(/^\uFEFF/, '') + '\n' + ui.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
