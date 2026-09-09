# Tampermonkey Scripts

这是我的个人油猴（Tampermonkey）脚本库，用于长期保存、版本化和维护自己设计的浏览器用户脚本。

## 脚本目录

| 脚本 | 当前版本 | 用途 | 安装文件 |
| --- | --- | --- | --- |
| MissAV Auto Load More | 1.5.0 | 分别识别多个 Load More 板块，并自动加载到指定数量 | [`missav-auto-loader.user.js`](scripts/missav-auto-loader/missav-auto-loader.user.js) |
| 123AV 首页工具 | 1.1.0 | 自动 Load More，并一键提取顶部轮播全部标题 | [`123av-home-tools.user.js`](scripts/123av-home-tools/123av-home-tools.user.js) |
| 全局番号过滤器 | 1.1.0 | 可在任意普通网页手动打开；兼容 MissAV Manager v0.5.13 的番号规范化、噪声过滤、去重、复制与 TXT 下载 | [`missav-code-filter.user.js`](scripts/missav-code-filter/missav-code-filter.user.js) |

## 目录约定

每个脚本单独放在 `scripts/<script-name>/` 中，通常包含：

- `*.user.js`：可直接安装到 Tampermonkey 的完整包。
- 源码和构建脚本：便于修改、检查和生成新版本。
- `README.md`：功能、安装和使用说明。

## 维护流程

1. 修改脚本源码。
2. 更新 userscript 元数据中的版本号。
3. 运行该脚本目录里的构建命令。
4. 用 `node --check` 检查 JavaScript 语法。
5. 提交并推送到 GitHub。

脚本仅用于个人浏览器自动化；使用时请遵守目标站点的规则。
