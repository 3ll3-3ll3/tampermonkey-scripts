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
// @version      1.1.0
// @description  可在任意网页手动打开的全局番号过滤器，兼容 MissAV Manager v0.5.13，支持任意长度粘贴、多文件、复制与 TXT 下载。
// @match        http://*/*
// @match        https://*/*
// @match        file:///*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + core.replace(/^\uFEFF/, '') + '\n' + ui.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
