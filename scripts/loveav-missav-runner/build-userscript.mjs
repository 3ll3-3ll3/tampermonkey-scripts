import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, 'loveav-missav-runner.js');
const outputPath = path.join(root, 'loveav-missav-runner.user.js');
const source = await readFile(sourcePath, 'utf8');

const header = `// ==UserScript==
// @name         LoveAV MissAV 最新脚本启动器
// @namespace    wjl.local
// @version      1.1.0
// @description  从已授权的 LoveAV results 目录扫描并运行最新的项目目录模式 MissAV 浏览器脚本。
// @match        https://missav.ai/*
// @match        https://*.missav.ai/*
// @match        https://missav.ws/*
// @match        https://*.missav.ws/*
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-missav-runner/loveav-missav-runner.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-missav-runner/loveav-missav-runner.user.js
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + source.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
