# MissAV 番号过滤器

这是从 MissAV Manager `v0.5.13` 独立出来的番号过滤器油猴脚本。过滤核心保持原版确定性语义，不进行网页查询，也不读写 LoveAV 主体库。

## 功能

- 粘贴文本后自动过滤；
- 同时导入多个 TXT、HTML、HTM、MD、JSON、CSV 或 LOG 文件；
- 规范普通番号与 FC2 番号；
- 从可信 AV 详情链接提取番号，并保留可信 MissAV 来源链接；
- 排除 HTML 标签、普通网址、图片路径、日期、时间、年龄、文件尺寸、文件大小、软件版本和其他已知噪声；
- 对 Raindrop 官方 CSV 只读取有意义的标题、URL 与文件夹上下文；
- 按原始首次出现顺序去重；
- 一键复制结果或下载 UTF-8 TXT。

## 使用

安装 `missav-code-filter.user.js`。打开 MissAV 页面后脚本保持静默；点击浏览器工具栏中的 Tampermonkey 图标，再选择“打开/隐藏 MissAV 番号过滤器”。

所有输入仅在当前页面内存中处理：不联网、不保存历史、不读取账号、Cookie、Local Storage 或 Session Storage。

## 构建与测试

```powershell
node .\build-userscript.mjs
node --check .\missav-code-filter.user.js
node --test .\missav-code-filter.test.cjs
```
