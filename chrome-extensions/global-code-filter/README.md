# 全局番号过滤器 Chrome 扩展

这是一个独立的 Chrome Manifest V3 扩展，不向任何网站注入脚本。点击扩展图标会打开专用过滤器页面，适合粘贴任意长度文本或导入多个文件。

## 功能

- 兼容 MissAV Manager `v0.5.13` 的番号规范化、噪声过滤和顺序去重；
- 支持 TXT、HTML、HTM、MD、JSON、CSV、LOG 多文件导入与拖放；
- 支持 Raindrop 官方 CSV 的结构化过滤；
- 支持复制结果和下载 UTF-8 TXT；
- 不读取当前网页、不联网、不保存输入历史。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`chrome-extensions/global-code-filter`。
5. 在 Chrome 扩展菜单中固定“全局番号过滤器”。

安装后点击扩展图标，即可打开完整工具页。旧的“MissAV 番号过滤器”油猴脚本应从 Tampermonkey 中删除，避免重复入口。
