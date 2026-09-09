# MissAV 番号过滤器

这是从 MissAV Manager `v0.5.13` 独立出来的全局番号过滤器油猴脚本。它不针对 MissAV 或任何特定网站；安装后可以在任意普通 HTTP/HTTPS 网页中通过 Tampermonkey 菜单手动打开。过滤核心保持原版确定性语义，不进行网页查询，也不读写 LoveAV 主体库。

## 功能

- 在任意普通网页中粘贴任意长度文字并自动过滤；
- 同时导入多个 TXT、HTML、HTM、MD、JSON、CSV 或 LOG 文件；
- 规范普通番号与 FC2 番号；
- 从可信 AV 详情链接提取番号，并保留可信 MissAV 来源链接；
- 排除 HTML 标签、普通网址、图片路径、日期、时间、年龄、文件尺寸、文件大小、软件版本和其他已知噪声；
- 对 Raindrop 官方 CSV 只读取有意义的标题、URL 与文件夹上下文；
- 按原始首次出现顺序去重；
- 一键复制结果或下载 UTF-8 TXT。

## 使用

安装 `missav-code-filter.user.js`。脚本在所有网站上都保持静默；点击浏览器工具栏中的 Tampermonkey 图标，再选择“打开/隐藏 全局番号过滤器”。面板使用 Shadow DOM 与当前网站完全隔离，不会读取或改写网页内容。

浏览器自身的内部页面（例如 `chrome://extensions`、Chrome 网上应用店和新标签页）不允许油猴脚本注入，这是浏览器安全限制；在任意普通 `http://` 或 `https://` 页面即可使用。若要在本地 `file://` 页面使用，需要在扩展详情中额外允许访问文件网址。

所有输入仅在当前页面内存中处理：不联网、不保存历史、不读取账号、Cookie、Local Storage 或 Session Storage。

## 构建与测试

```powershell
node .\build-userscript.mjs
node --check .\missav-code-filter.user.js
node --test .\missav-code-filter.test.cjs
```
