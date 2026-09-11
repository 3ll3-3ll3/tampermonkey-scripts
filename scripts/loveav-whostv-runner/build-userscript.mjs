import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, 'loveav-whostv-runner.js');
const outputPath = path.join(root, 'loveav-whostv-runner.user.js');
const source = await readFile(sourcePath, 'utf8');

const header = `// ==UserScript==
// @name         LoveAV Whos.tv 最新脚本启动器
// @namespace    wjl.local
// @version      1.0.0
// @description  从已授权目录扫描、校验并运行最新 LoveAV Whos.tv 抓取脚本。
// @match        https://whos.tv/*
// @match        https://*.whos.tv/*
// @updateURL    https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-whostv-runner/loveav-whostv-runner.user.js
// @downloadURL  https://raw.githubusercontent.com/3ll3-3ll3/tampermonkey-scripts/main/scripts/loveav-whostv-runner/loveav-whostv-runner.user.js
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

`;

await writeFile(outputPath, header + source.replace(/^\uFEFF/, ''), 'utf8');
console.log(`Built ${outputPath}`);
