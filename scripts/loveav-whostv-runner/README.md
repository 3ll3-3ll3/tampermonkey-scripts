# LoveAV Whos.tv 最新脚本启动器

本油猴脚本用于替代“每次把完整 Whos.tv 抓取脚本复制到 Console”的操作。LoveAV 仍负责读取动态截止点并生成脚本；启动器只扫描、校验并在用户点击后运行最新脚本。

## 使用体验

1. 安装 `loveav-whostv-runner.user.js`。
2. 打开 Whos.tv 求助社区页面，点击右下角“运行 Whos.tv”。
3. 首次选择并授权：

   `E:\Desktop\codex项目\whostv-current\脚本归档\generated`

4. 启动器扫描最新的增量或第 1-n 页脚本，展示模式、截止帖或页数、输出 JSON、修改时间和 SHA-256。
5. 点击“运行最新脚本”。抓取进度仍会在开发者工具 Console 中逐条更新；需要停止时可点击“取消抓取”。
6. 下载 JSON 后交给 LoveAV 校验和整理。只有整理成功才会更新下一次截止点。

目录句柄保存在当前 Whos.tv 域名的 IndexedDB。Chrome 清理站点数据、使用隐私模式、更换域名或撤销权限后，需要重新授权。

## 安全边界

- 只匹配 `whos.tv` 及其子域。
- 只扫描符合 LoveAV 命名规则的 `whostv_*.js`。
- 运行前验证脚本模式、输出文件名、增量截止点、超时、页间延时和关键安全标记。
- 启动器不生成脚本、不修改 `.loveav\whostv-state.json`，也不接触 Whos.tv JSON 或最终 Markdown。
- 抓取失败或取消时沿用原脚本规则，不下载不完整 JSON。
- 油猴入口不可用时，仍可回退为在 Console 手动运行 LoveAV 生成的完整脚本。

## 构建与检查

```powershell
node build-userscript.mjs
node --check loveav-whostv-runner.js
node --check loveav-whostv-runner.user.js
node --test loveav-whostv-runner.test.cjs
```
