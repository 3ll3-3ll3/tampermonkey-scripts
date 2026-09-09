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
// @version      1.4.3
// @description  自动识别 MissAV 的多个 Load More 板块，并分别加载到指定总数。
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/missav-auto-loader/missav-auto-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/missav-auto-loader/missav-auto-loader.user.js
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @match        https://missav.ws/*
// @match        https://*.missav.ws/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + source.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
