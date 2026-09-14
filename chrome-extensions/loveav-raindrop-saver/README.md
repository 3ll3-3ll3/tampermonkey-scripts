# LoveAV 一体化工具

这是一个独立的 Chrome Manifest V3 扩展，把“全局番号过滤器”和“MissAV / 123AV 一键收藏到 Raindrop”放进同一个扩展。两个模块可以分别使用，也可以从网站面板把当前页作品直接送入过滤工作台。

## 一体化工作流

- 默认点击 Chrome 扩展图标打开番号过滤工作台；也可以改为直接收藏当前网页或打开设置；
- 在任意网页打开工作台，粘贴任意长度文字或导入多个文件，按 MissAV Manager v0.5.13 兼容规则过滤、去重、复制或下载番号；
- 可以把过滤结果作为手动番号批次，选择“标准处理、全量重查、只解析预览”后，串行读取 MissAV 候选页面并直接提交 Raindrop；
- MissAV / 123AV 左下角常驻 `♥ LoveAV 工具`，同时保留“收藏到 Raindrop”和“提取并过滤”两个按钮；
- 列表页新增“选择部分收藏”：在作品卡片上勾选，再点击“收藏已选 N 项”；支持全选、反选、按板块选择、选择可见区域、按标题关键词或多行番号勾选；
- 设置页可以选择网站面板的主按钮，并控制工作台是否输入后自动过滤；
- “提取并过滤”只把当前页面已经识别的作品标题和链接传给扩展自己的本地页面，不会写入 Raindrop；
- “收藏到 Raindrop”仍使用 LoveAV 分类、黑名单和查重流程。

## 选择部分作品（0.6.0）

打开 MissAV / 123AV 列表页左下角的 `♥ LoveAV 工具`，点击“选择部分收藏”。页面上方出现选择栏，作品卡片左上角出现复选框。选择栏的板块范围会限制全选、反选、可见区域及关键词操作；“清空全部”清除所有选择。

同一 URL 的重复卡片同步勾选、只提交一次。继续 Load More、替换卡片网格或页面主体时，已选作品保留，新作品默认不勾选。暂时移出页面的已选作品也保留，并显示数量。退出选择后重新打开可继续；刷新或切换到其他页面会清空本页选择。

点击“收藏已选”时固定本次作品清单，只读取这些作品的详情并调用已有分类、查重和 Raindrop 收藏流程。提交进度在原收藏面板显示，目标文件夹沿用已有设置。整页收藏和详情页单个收藏仍可使用。

## 手动番号处理

1. 点击扩展图标打开一体化工作台，把番号或含番号的任意文字粘贴到左侧；
2. 在“手动番号 → MissAV → Raindrop”区域选择模式；
3. 点击“处理并提交 Raindrop”。扩展按 v0.5.13 候选地址顺序逐条验证，番号之间保持 900ms 串行节流；
4. 全部页面解析完成后，统一执行 LoveAV 分类、第二层黑名单、Raindrop URL 查重和批量写入；
5. 处理日志会逐条显示候选地址、解析状态、目标收藏夹及新增/已存在/排除/失败结果。

标准模式会跳过正式主体库已经存在的番号。升级到 0.5.0 后需要在设置页重新导入一次 `missav-library.csv` 和两份黑名单，才能建立本地番号索引。全量重查不跳过主体库，但仍不会重复写入 Raindrop 已有 URL；只解析预览不会写入 Raindrop。

## 行为

- Raindrop 标题使用标准化番号，完整网页标题保存在摘要中；
- 默认按来源网站归档：MissAV → `MissAV`，123AV → `javxxx&123av`；这两个收藏夹可以位于 Raindrop 子目录中；
- LoveAV 分类优先级仍为：`需要查找` → `参考女优Tag命中` → `其他`，分类结果保留为标签判断与处理信息；
- 命中 `2-Raindrop导出黑名单.txt` 时不保存；
- 保存前使用 Raindrop 官方接口检查 URL，已存在的作品不重复写入；
- 批量查重采用分组定位，新增数据按分类分组并以每批最多 100 条写入；
- OAuth 令牌到期前自动刷新；
- 每个 MissAV / 123AV 页面左下角都会常驻显示 `♥ LoveAV 工具` 入口，不再因为暂时未识别到作品而消失；
- 点开后可查看识别、详情解析、分类、查重、新增、排除和失败的逐条进度；
- Chrome 工具栏扩展图标的行为可在设置页切换；
- 缺少目标收藏夹时，默认自动创建同名的私人收藏夹。

## 安装

1. Chrome 打开 `chrome://extensions/`；
2. 开启“开发者模式”；
3. 选择“加载已解压的扩展程序”；
4. 选择本目录 `chrome-extensions/loveav-raindrop-saver`；
5. 首次安装会自动打开设置页。若是从旧版升级，在 `chrome://extensions/` 中点一次“重新加载”即可保留原来的本机 OAuth、规则和收藏夹设置。

升级并确认一体化工具正常后，原来的独立“全局番号过滤器”扩展可以停用，以免工具栏出现两个相似入口；仓库仍保留其源码作为独立版本。

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

默认启用“按网站归档”，目标收藏夹名称为：

- MissAV：`MissAV`
- 123AV：`javxxx&123av`

设置页也可以切换回“按 LoveAV 分类归档”，其三个目标收藏夹为：

- `参考女优Tag命中`
- `需要查找`
- `其他`

如果 Raindrop 中有重名收藏夹，可在设置页查看收藏夹 ID，并为对应分类填写唯一 ID。

## 大批量性能

列表页会读取当前 DOM 中已经加载的全部作品，以 4 个并发请求补齐作品详情，然后批量查重和分类。新增作品按 Raindrop 官方上限每 100 条调用一次 `POST /rest/v1/raindrops`，不会为每一条新增作品单独发起写入请求。

## 本地验证

```powershell
node --check loveav-core.js
node --check filter-core.js
node --check filter-app.js
node --check missav-resolver.js
node --check page-selection.js
node --check content.js
node --check background.js
node --check options.js
node loveav-core.test.cjs
```

页面选择回归测试使用 Playwright（`node page-selection.test.cjs`，可用 `PLAYWRIGHT_CHANNEL=chrome` 指定已安装的 Chrome）。测试在隔离浏览器中拦截所有站点请求，不访问真实网站、不写入 Raindrop。
