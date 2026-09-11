# Browser Tools

这是我的个人浏览器工具库，用于长期保存、版本化和维护 Chrome 扩展与 Tampermonkey 用户脚本。

## Chrome 扩展

| 工具 | 当前版本 | 用途 | 目录 |
| --- | --- | --- | --- |
| 全局番号过滤器 | 1.0.1 | 独立于任何网站，手动输入任意长度文字；兼容 MissAV Manager v0.5.13 | [`global-code-filter`](chrome-extensions/global-code-filter/README.md) |

## Tampermonkey 脚本

| 脚本 | 当前版本 | 用途 | 安装文件 |
| --- | --- | --- | --- |
| MissAV Auto Load More | 1.5.1 | 加载到指定数量后复制含番号的完整作品标题；支持单板块与全部板块汇总 | [`missav-auto-loader.user.js`](scripts/missav-auto-loader/missav-auto-loader.user.js) |
| LoveAV MissAV 最新脚本启动器 | 1.0.0 | 自动读取已授权 results 目录中的最新 LoveAV 脚本，校验后直接运行 | [`loveav-missav-runner.user.js`](scripts/loveav-missav-runner/loveav-missav-runner.user.js) |
| LoveAV Whos.tv 最新脚本启动器 | 1.0.0 | 自动读取已授权 generated 目录中的最新 Whos.tv 抓取脚本，校验后由用户一键运行 | [`loveav-whostv-runner.user.js`](scripts/loveav-whostv-runner/loveav-whostv-runner.user.js) |
| 123AV 首页工具 | 1.2.1 | 自动 Load More，复制各板块含番号的完整作品标题，并提取顶部轮播标题 | [`123av-home-tools.user.js`](scripts/123av-home-tools/123av-home-tools.user.js) |

## 目录约定

Chrome 扩展放在 `chrome-extensions/<extension-name>/`；油猴脚本放在 `scripts/<script-name>/`。脚本目录通常包含：

- `*.user.js`：可直接安装到 Tampermonkey 的完整包。
- 源码和构建脚本：便于修改、检查和生成新版本。
- `README.md`：功能、安装和使用说明。

## 维护流程

1. 修改源码并更新版本号。
2. 油猴脚本运行各自目录中的构建命令。
3. 用 `node --check` 检查 JavaScript 语法，并运行对应测试。
4. 提交并推送到 GitHub。

脚本仅用于个人浏览器自动化；使用时请遵守目标站点的规则。
