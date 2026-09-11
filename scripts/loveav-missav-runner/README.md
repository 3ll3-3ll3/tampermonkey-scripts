# LoveAV MissAV 最新脚本启动器

本油猴脚本用于替代“每批把整份 LoveAV 浏览器脚本复制到 Console”的操作。它不会自行生成番号、修改主体库或访问 Telegram。

## 使用体验

1. 安装 `loveav-missav-runner.user.js`。
2. 打开 MissAV 页面，点击右下角“运行 LoveAV”。
3. 首次选择并授权：

   `E:\Desktop\codex项目\LoveAV-Data\missav\results`

4. 启动器递归扫描最新的 `*_missav-browser-script.js`，展示文件、修改时间、番号数量和 SHA-256。
5. 点击“运行最新脚本”，随后在原有“MissAV 导入脚本启动面板”继续处理。

目录授权与 LoveAV 生成脚本使用同一 IndexedDB 配置，因此只需授权一次。Chrome 清理站点数据、使用隐私模式、更换 MissAV 域名或撤销目录权限后，需要重新授权。

## 安全边界

- 只匹配 `missav.ai` 与 `missav.ws` 页面。
- 只扫描文件名以 `_missav-browser-script.js` 结尾的文件。
- 运行前必须同时验证 `CODE_TEXT`、参考女优 Tag、Raindrop 黑名单和启动面板标记。
- 不使用 `javascript:`、远程脚本加载、Chrome 调试协议或剪贴板注入。
- 文件仍由 LoveAV 在本地生成；油猴脚本只读取用户明确授权的目录。

## 构建与检查

```powershell
node build-userscript.mjs
node --check loveav-missav-runner.js
node --check loveav-missav-runner.user.js
```
