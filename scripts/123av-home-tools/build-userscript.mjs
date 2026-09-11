import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, '123av-home-tools.js');
const outputPath = path.join(root, '123av-home-tools.user.js');
const source = await readFile(sourcePath, 'utf8');

const header = `// ==UserScript==
// @name         123AV 首页 Load More 与推荐提取
// @namespace    wjl.local
// @version      1.2.0
// @description  自动加载 123AV 首页多个板块，并提取、复制已加载卡片标题。
// @match        https://123av.com/*
// @match        https://www.123av.com/*
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/123av-home-tools/123av-home-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/123av-home-tools/123av-home-tools.user.js
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + source.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
