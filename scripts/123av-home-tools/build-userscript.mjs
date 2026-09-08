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
// @version      1.1.0
// @description  自动加载 123AV 首页多个板块，并一键提取顶部轮播的全部标题。
// @match        https://123av.com/*
// @match        https://www.123av.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + source.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
