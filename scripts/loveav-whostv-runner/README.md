# LoveAV Whos.tv 最新脚本启动器

本油猴脚本用于替代“每次把完整 Whos.tv 抓取脚本复制到 Console”的操作。LoveAV 仍负责读取动态截止点并生成脚本；启动器只扫描、校验并在用户点击后运行最新脚本。

## 使用体验

1. 安装 `loveav-whostv-runner.user.js`。
2. 打开 Whos.tv 求助社区页面，点击右下角“运行 Whos.tv”。
3. 首次选择并授权：

   `E:\Desktop\codex项目\whostv-current\脚本归档\generated`

4. 首次点击“授权 / 更换 JSON 保存目录”，选择 `E:\Desktop\codex项目\whostv-current\.loveav\imports`。如果直接点击运行，也会先提示授权这个目录。
5. 启动器扫描最新的增量或第 1-n 页脚本，展示模式、截止帖或页数、输出 JSON、修改时间和 SHA-256。旧版普通下载脚本会提示重新生成。
6. 点击“运行最新脚本”。授权恢复成功后开始抓取，进度在 Console 中逐条更新；需要停止时可点击“取消抓取”。全部完成后自动保存 JSON，回读核验后显示实际文件名。同名文件另存新副本，已有文件保留。
7. 告诉 LoveAV“整理最新 Whos.tv JSON”，它会从固定 imports 目录读取本轮文件。只有整理校验成功才更新下一次截止点。

脚本目录与 JSON 保存目录的句柄分别保存在当前 Whos.tv 域名的 IndexedDB。Chrome 清理站点数据、使用隐私模式、更换域名或撤销权限后，可能需要重新授权。浏览器只能识别目录名，首次请核对选中的是上面完整路径下的 imports；脚本不能自行验证绝对路径。

## 安全边界

- 只匹配 `whos.tv` 及其子域。
- 只扫描符合 LoveAV 命名规则的 `whostv_*.js`。
- 运行前验证脚本模式、输出文件名、增量截止点、超时、页间延时和关键安全标记。
- 启动器只把完整抓取 JSON 保存到用户授权目录，不生成脚本、不整理答案，不修改 `.loveav\whostv-state.json` 或最终 Markdown。
- 无写入权限时停止；抓取失败或取消时不保存不完整 JSON，不回退 Downloads。
- 提交或保存后核验失败会明确提示检查文件；不能把不确定结果报告为“未保存”。
- 油猴入口不可用时，新版 Console 脚本也支持首次授权 imports 后自动保存。

## 构建与检查

```powershell
node build-userscript.mjs
node --check loveav-whostv-runner.js
node --check loveav-whostv-runner.user.js
node --test loveav-whostv-runner.test.cjs
```
