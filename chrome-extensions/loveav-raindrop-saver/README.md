# LoveAV 一键收藏到 Raindrop

这是一个独立的 Chrome Manifest V3 扩展。在 MissAV 与 123AV 中，它既能收藏单个作品详情，也能批量收藏当前页面已经加载的全部作品。扩展会识别番号、女优、类型、封面和 URL，并按 LoveAV / MissAV Manager v0.5.13 的规则直接保存到 Raindrop。

## 行为

- Raindrop 标题使用标准化番号，完整网页标题保存在摘要中；
- 分类优先级：`需要查找` → `参考女优Tag命中` → `其他`；
- 命中 `2-Raindrop导出黑名单.txt` 时不保存；
- 保存前使用 Raindrop 官方接口检查 URL，已存在的作品不重复写入；
- 批量查重采用分组定位，新增数据按分类分组并以每批最多 100 条写入；
- OAuth 令牌到期前自动刷新；
- 每个 MissAV / 123AV 页面左下角都会常驻显示 `♥ LoveAV 收藏` 入口，不再因为暂时未识别到作品而消失；
- 点开后可查看识别、详情解析、分类、查重、新增、排除和失败的逐条进度；
- Chrome 工具栏扩展图标也可触发当前页面的收藏；
- 缺少目标收藏夹时，默认自动创建同名的私人收藏夹。

## 安装

1. Chrome 打开 `chrome://extensions/`；
2. 开启“开发者模式”；
3. 选择“加载已解压的扩展程序”；
4. 选择本目录 `chrome-extensions/loveav-raindrop-saver`；
5. 首次安装会自动打开设置页。

## 首次设置

### 1. 导入 LoveAV 规则

在设置页选择包含以下文件的 `LoveAV-Data` 或 `missav` 文件夹：

- `missav-library.csv`
- `1-参考女优Tag库黑名单.txt`
- `2-Raindrop导出黑名单.txt`

扩展只在浏览器本机解析这些文件，然后把派生规则保存到 `chrome.storage.local`。私人主体库、黑名单及派生结果均不在本仓库中。

### 2. OAuth 授权

Raindrop 官方 OAuth 要求应用的 `Client ID` 和 `Client Secret`。在 [Raindrop App Management Console](https://app.raindrop.io/settings/integrations) 创建个人应用，把设置页显示的 redirect URI 填入该应用，再在本机设置页输入两项应用凭据并授权。

Client Secret、access token 与 refresh token 只保存在本机扩展存储，不会写入源码、日志或 Git。此方式适合个人自用；如果将扩展公开分发，应把 token 交换迁移到受控后端，不能在分发包中内置 Client Secret。

### 3. 收藏夹映射

默认目标收藏夹名称为：

- `参考女优Tag命中`
- `需要查找`
- `其他`

如果 Raindrop 中有重名收藏夹，可在设置页查看收藏夹 ID，并为对应分类填写唯一 ID。

## 大批量性能

列表页会读取当前 DOM 中已经加载的全部作品，以 4 个并发请求补齐作品详情，然后批量查重和分类。新增作品按 Raindrop 官方上限每 100 条调用一次 `POST /rest/v1/raindrops`，不会为每一条新增作品单独发起写入请求。

## 本地验证

```powershell
node --check loveav-core.js
node --check content.js
node --check background.js
node --check options.js
node loveav-core.test.cjs
```
