import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, 'missav-auto-loader.js');
const outputPath = path.join(root, 'missav-auto-loader.user.js');
const source = await readFile(sourcePath, 'utf8');

const header = `// ==UserScript==
// @name         MissAV 自动 Load More
// @namespace    wjl.local
// @version      1.5.1
// @description  自动加载 MissAV 多个板块到指定总数，并提取、复制已加载卡片标题。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/missav-auto-loader/missav-auto-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/missav-auto-loader/missav-auto-loader.user.js
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + source.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
