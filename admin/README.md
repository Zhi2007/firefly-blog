# 本地管理后台

一个零依赖的图形化管理界面，用来替代敲命令：写文章、传图片/音乐、改配置、一键发布。

## 目录

- [启动](#启动)
- [能做什么](#能做什么)
- [从 Word / txt 导入文章](#从-word--txt-导入文章)
- [文章编辑器：保存时 frontmatter 怎么处理](#文章编辑器保存时-frontmatter-怎么处理)
- [自动同步到 GitHub](#自动同步到-github)
- [拖拽上传](#拖拽上传)
- [从音频自动提取封面与歌词](#从音频自动提取封面与歌词)
- [数据放在哪](#数据放在哪)
- [文件存在哪：路径徽章](#文件存在哪路径徽章)
- [站点设置：改 TS 配置也不会改坏](#站点设置改-ts-配置也不会改坏)
- [站点头像（上传 / 恢复默认）](#站点头像上传--恢复默认)
- [更新公告草稿（从最近改动生成）](#更新公告草稿从最近改动生成)
- [体检（发布前的安全闸）](#体检发布前的安全闸)
- [CI 失败详情（错在哪一步）](#ci-失败详情错在哪一步)
- [备份与恢复](#备份与恢复)
- [认证方式（HttpOnly Cookie）](#认证方式httponly-cookie)
- [导航菜单（隐藏 / 改名 / 排序）](#导航菜单隐藏--改名--排序)
- [友链管理](#友链管理)
- [一键压缩（音乐 / 图片）](#一键压缩音乐--图片)
- [备份导出](#备份导出)
- [安全说明](#安全说明)
- [想从手机/外网编辑？](#想从手机外网编辑)

## 启动

**方式一（Windows 双击）**：双击项目根目录的 `启动管理面板.cmd`

**方式二（命令行）**：

```sh
node admin/server.mjs
# 指定端口 / 不自动开浏览器
node admin/server.mjs --port=8899 --no-open
```

启动后会自动打开浏览器（地址里带一次性访问令牌），黑窗口关掉服务就停了。

## 能做什么

| 标签页 | 功能 |
| --- | --- |
| **概览** | 仓库/分支/未提交改动、最近提交、最近一次 GitHub Actions 部署状态；本地预览、本地构建、类型检查 |
| **文章** | 列表 / 新建 / 编辑 / 删除；标题、日期、摘要、**标签与分类（带候选下拉，可新增）**、封面、草稿、置顶、**密码（加密文章）**；Markdown 正文 + 实时预览 + **实时字数统计**；封面直接上传。每篇显示真实文件路径 `src/content/posts/<文件名>` 与它的 URL；编辑器里显示当前文件、图片目录与正文引用到的图片（见「路径徽章」） |
| **公告** | 增删改公告（标题、日期、类型、正文、按钮链接）；勾选「固定为弹窗公告」的那条会作为首访弹窗内容；改动「弹窗版本号」会让所有访客重新看到一次弹窗；**「从最近改动生成更新公告草稿」**（读 `git log` 把 `feat:` / `fix:` / `perf:` 整理成中文草稿填进表单，**只产草稿、不自动发布**）；显示数据文件 `src/config/announcements.json` |
| **音乐** | 上传音频/封面/歌词并加入歌单，编辑歌曲信息、调整播放顺序、**本地直接试听**；数据写到 `src/config/music-playlist.json`；**一键压缩**（先试算 / 只压封面 / 音频+封面，后者需确认）；每首歌显示音频/封面/歌词的真实文件路径 |
| **友链** | 友链列表（图标缩略图 / 站名 / 简介 / 网址 / 权重 / 显示开关），↑↓ 排序、编辑、删除（二次确认）、启用停用；**「从网址抓取」**自动猜标题、简介与图标（结果只填表单、需人工确认后才保存）；数据写到 `src/config/friends.json`；每个图标显示 `public/friends/<文件名>` |
| **媒体** | 分类查看文章图片、音乐、封面、歌词、头像目录；上传（可多选）、复制路径、删除；**批量转 WebP**（默认先试算，只新增 `.webp`，绝不删原图）。每条显示 `public/assets/...` 下的仓库相对路径 + 体积。注意：这里上传到「头像/站点图片」目录只是把文件放进去，**换站点头像请用「站点设置」页的「站点头像」**（它会同时改写 `profileConfig.avatar`） |
| **配置** | 直接编辑 `src/config/*` 里的常用配置文件（含 `FooterConfig.html`、`announcements.json`、`music-playlist.json`） |
| **站点设置** | **可视化表单**：站点标题/副标题/描述/关键词/主域/建站日期、页面宽度、导航栏标题、主题色相与默认明暗、卡片样式、博主名字/签名/头像（**头像可在这里直接上传更换 / 恢复默认**，见下文「站点头像」）、壁纸模式与暗度、主页横幅标题、**首页横幅副标题（每行一条）**、显示设置面板各项开关 + **页面开关** + **导航菜单（隐藏/改名/排序）**。**每一项都显示它会被写进哪个文件的哪个块/字段**（如 `src/config/siteConfig.ts → navbar.title`，见「路径徽章」）。写入前自动备份，写完回读校验，不一致立即回滚 |
| **体检 / 备份** | 一键体检（10 项：JSON 合法性、内容引用是否丢失、公告完整性、**文章 frontmatter（YAML 速查）**、**文章 schema（跑真实 `astro build`）**、站内链接、疑似密钥、异常大文件、配置矛盾、Git 状态）；写前快照列表 + 一键恢复 + **导出 ZIP**（显示 `admin-backups/<id>/` 与每个文件的真实路径）；**CI 部署状态**（失败时全页红色横幅，直接显示**是哪个 job 的哪个步骤挂了** + 日志片段 + 一键回滚该提交） |
| **发布** | 同步状态（待推送提交数 / 远端新提交数 / 最后提交时间 / 最近一次部署结果）、**自动同步开关**、一键 `commit + push`、从 GitHub 拉取同步、查看部署状态与完整日志；**推送前自动体检，有 error 会拦住**（文章 frontmatter 写错也一样拦，见「体检」一节的「文章 frontmatter：为什么有两条检查」）；「待提交的改动」逐条显示真实路径与状态码，发布后列出本次提交的文件 |

## 从 Word / txt 导入文章

在「文章」页的编辑器上方有一个 **「从 Word / txt 导入」** 按钮（旁边的隐藏 `input` 只接受 `.docx` / `.txt` / `.md` / `.markdown`）。点它选文件，面板会把文档转成 Markdown **填进编辑器**，正文与图片一起准备好，你检查完自己点「保存」。

### 请求 / 响应

前端读文件成 base64（去掉 `data:...;base64,` 前缀）后 POST 到 `/api/import-document`，同时把编辑器里的文件名（slug）传过去，用来给抽出来的图片命名：

```json
{
	"filename": "我的文章.docx",
	"dataBase64": "UEsDBBQABgAIAAAAIQ...",
	"slug": "my-first-post"
}
```

成功（HTTP 200）：

```json
{
	"ok": true,
	"kind": "docx",
	"markdown": "## 第一节\n\n这里是正文。\n\n![my-first-post-img1](./images/my-first-post-img1.png)\n",
	"suggested": {
		"title": "我的文章",
		"description": "这里是正文。"
	},
	"images": [
		{
			"name": "my-first-post-img1.png",
			"repoPath": "src/content/posts/images/my-first-post-img1.png",
			"url": "./images/my-first-post-img1.png"
		}
	],
	"warnings": ["跳过了 2 处不支持的内容（文本框 / 嵌入对象 / 公式等）"]
}
```

失败（HTTP 400，`ok: false`）：

```json
{ "ok": false, "error": "旧版 .doc 是二进制格式无法解析，请在 Word 里另存为 .docx，或直接复制正文粘贴到编辑器" }
```

| 字段 | 含义 |
| --- | --- |
| `kind` | `"docx"` / `"txt"` / `"md"`，来自扩展名判定 |
| `markdown` | 转换后的 Markdown 正文（图片已替换成 `./images/<slug>-imgN.ext` 的引用） |
| `suggested.title` | 建议标题：优先取文档里第一个一级标题（`Title` / `Heading1` 样式），没有就用文件名（`-`/`_` 换成空格、压掉多余空白） |
| `suggested.description` | 建议摘要：正文里第一段纯文本截断到 100 字 |
| `images[]` | 落盘的图片：`name`（实际文件名）、`repoPath`（仓库相对路径）、`url`（正文里用的引用） |
| `warnings[]` | 转换过程中的损失提示，前端会用 ⚠️ 逐条展示 |

接口只支持 `POST`（其它方法返回 405，并提示"请用 POST 调用 /api/import-document"）；认证走面板统一的令牌机制（Cookie / `X-Admin-Token` / `?token=` 任一），未认证返回 403。

### 支持的格式与大小

| 扩展名 | 处理方式 |
| --- | --- |
| `.docx` | 自己读 ZIP（中央目录 → 本地头 → `inflateRawSync`）解析 `word/document.xml`，零第三方依赖 |
| `.txt` / `.text` | 按段落切成 Markdown |
| `.md` / `.markdown` | 作为 Markdown 解析并整理 |
| `.doc`（旧版） | **不支持**，提示另存为 `.docx` 或直接粘贴正文 |
| 其它 / 无扩展名 | 提示"请用 .docx / .txt / .md" |

- 体积上限 **25 MB**：前端先拦一次，后端 `MAX_IMPORT_BYTES` 再拦一次（base64 会先按长度估算，避免解出超大 buffer 才报错）。
- **编码自适应**：先按 UTF-8 严格模式解码；失败或结果里出现替换字符 `\uFFFD` 时改用 **GBK** 解码，并在 `warnings` 里给出提示（记事本另存的 txt 大多是 GBK，不处理会整篇乱码）。文件开头的 BOM 会被去掉，`CRLF` 统一成 `\n`。

### 图片去哪了

`.docx` 里的图片**必须落盘**（否则 Markdown 引用不到），所以它们会被写进：

```
src/content/posts/images/<slug>-img1.png     ← slug 取自编辑器里的文件名，缺省用 "import"
src/content/posts/images/<slug>-img2.jpg
```

- 命名按文档里出现的顺序递增；**同名文件已存在就往后加序号，绝不覆盖**。
- 后端会先校验目标目录必须是 `src/content/posts/images`（解析后的绝对路径比较，挡住 `../` 越界）。
- `.txt` / `.md` 不产生图片（`images` 为空数组）。
- 数据库里找不到对应图片、或形如文本框/图表/公式的图形无法抽取时，会计入 `warnings`。

### 已知取舍

| 取舍 | 说明 |
| --- | --- |
| 列表统一成无序列表 | Word 的列表（`w:numPr` 或 `ListBullet`/`ListNumber`/`ListParagraph` 样式）按 `numId` 分组后**一律渲染成 `- `**，有序列表的编号会丢 |
| 内联样式只保留粗体/斜体 | 下划线、字体颜色、删除线、上下标等不会保留（转换器只处理 bold/italic，也不产生警告） |
| 文本框 / 嵌入对象 / 公式 / 图表 | 跳过，并把跳过数量汇总成一条 `warnings`（"跳过了 N 处不支持的内容"） |
| 表格 | 转成 Markdown 表格，首行当表头、列数按最宽行补齐；单元格里的换行会被压成空格（否则会破格） |
| 加密的 docx | 读不出来，会提示"这个 docx 被加密了，请先在 Word 里去掉密码保护再导入" |
| 损坏的 docx | 提示"文件不是有效的 docx（ZIP 结构损坏）：…" |

### 为什么导入不自动保存

后端只做两件事：**转换成 Markdown** + **把图片落盘**。它不写文章、不建快照（没有旧版本可备份），编辑器里被覆盖的是：

- `fTitle` / `fDescription`：**仅在转换结果非空时**覆盖，避免把已经填好的字段清空；
- `fBody`：直接替换成转换结果，并立刻刷新预览与字数统计；
- 完成后弹提示「已导入，请检查后点保存（**不会自动保存**）」。

理由写在 `admin/index.html` 的注释里：格式转换一定会有误差（列表、颜色、文本框都可能变），必须让人过一眼再点「保存」；真正写文件那一刻仍然走正常的保存流程——**写前快照 → 写入 → 保存后按需自动同步**。

## 文章编辑器：保存时 frontmatter 怎么处理

> **一句话**：保存只动你**真正改过**的字段，日期一律写成**不带引号**的 `YYYY-MM-DD`，其它行（注释、字段顺序、引号风格、块列表、面板不认识的字段）逐字节保留。

### 为什么需要说清这件事（真实事故，发生过两次）

旧的面板保存文章时，会用模板字符串把**整份** frontmatter 重写一遍，其中字符串值**无条件加引号**：

```js
`${k}: ${typeof v === "string" ? `"${v}"` : v}`   // 字符串一律加引号
```

日期在表单里就是一个字符串（`<input type="date">` 给的是 `2026-10-11`），于是写出 `published: "2026-10-11"`。YAML 里**加了引号就是字符串**，而 `src/content.config.ts` 的 `posts.published` 是 `z.date()` → `astro build` 立刻失败：

```text
src/content/posts/xxx.md:0:0
published: Expected type `"date"`, received `"string"`
```

第一次事故只加了「体检 + 发布前拦截」（会发现坏数据，但**坏数据仍然由面板产生**），所以用户在面板里给那篇文章加了一行下载链接再保存，引号就又回来了。现在**写入路径**也修好了。

同一个旧函数还有两个副作用（都已修）：

| 旧行为 | 后果 |
| --- | --- |
| 只把表单里那 9 个字段写回 | 保存一次就**删掉** `lang` / `comment` / `series` / `author` 等面板不管理的字段 |
| 兜底解析只认 `key: value` 一行 | 块列表 `tags:`（`- 测试`）被读成空字符串 → 表单显示为空 → 保存后标签**全没了** |

### 现在的规则（`admin/post-frontmatter.mjs`）

| 项 | 行为 |
| --- | --- |
| **会写哪些字段** | `title`、`published`、`description`、`tags`、`category`、`image`、`password`、`pinned`、`draft`（新建文章时按这个顺序写出，与仓库现有文章一致） |
| **日期怎么写** | `published` / `updated` **必须**是不带引号的 `YYYY-MM-DD`。面板前端提交前先校验一次，后端在写盘前用「正则 + 日历」再校验一次：`published="2026-10-11"`（带引号）、`2026/10/11`、`2026-13-45` 一律 **400 并且不落盘**，不会先写坏再等发布时被拦住 |
| **已经是裸日期** | 那一行**逐字节保留**（连空格都不动）。历史遗留的带引号日期会在你下次保存那一篇时被**顺手规整**成不带引号，并在提示里说明改了哪一行（响应里的 `notes`） |
| **写成时间戳** | `published: 2026-10-10T10:30:00+08:00` 也是合法日期，保存时**不会被降级**成只有日期的写法 |
| **值没变的字段** | 整段原样保留：引号风格、块标量（`\|` / `>`）、块列表、行尾注释、字段顺序都不动 —— **只改正文时 frontmatter 逐字节不变** |
| **面板不认识的字段** | `lang` / `comment` / `series` / `author` / `passwordHint` / 自定义字段**原样保留**，不再被删 |
| **清空字段** | 表单里清空 → 删掉那一行（这是你的操作意图）；文件里本来没有的字段 → 按上表顺序补在**末尾**，不重排已有的行 |
| **什么时候加引号** | 只在「不加引号会被 YAML 读成别的类型 / 会语法出错」时：含 `: `、以 `#` 开头、`123`、`true`、`2026-10-11` 这类值会加引号；普通中文（`技术`、含 `：` / `、`）不加 |
| **同名 key 重复** | 只管理**最后一个**，更早的重复行不替你删；重复键本身会被体检（见下）报 error |
| **编码 / 换行** | 一律 UTF-8 + LF，文件形如 `---\n<frontmatter>\n---\n\n<正文>` |

### 故意没做的部分

- **不会偷偷批量修历史坏数据**：你没打开的文章，面板一行都不改。要逐篇查就用体检的 `content-frontmatter`（它会指出「第几行、哪个字段、怎么改」）。
- **不做完整 YAML 建模**：对象数组（如 `projects` 的 `link:`）不解析；那些字段面板不管理，保存时**原样保留**。
- **读（表单回填）与写（保存）共用同一套行模型**（`admin/post-frontmatter.mjs` 复用 `admin/content-check.mjs` 导出的 `scanMapping()` / `readScalar()`），所以不会出现「体检看得见、保存看不见」的偏差。

**接口返回**：`POST /api/save-post` 仍然只接受 `slug` / `originalSlug` / `frontmatter` / `body` 四个字段（多余字段 → 400），成功返回 `{ ok: true, file, notes }`：`notes` 是这次顺手规整掉的日期写法说明（没规整就是空数组）。

## 自动同步到 GitHub

「发布」页顶部有个 **自动同步** 开关（浏览器记忆选择）：

- **开启后**：每次保存（文章、公告、歌单、配置、上传文件）都会自动 `git add` → `commit` → `push`；
  连续操作（比如一次拖入 10 个文件）会在 2.5 秒内合并成**一次提交**，不会刷出一堆 commit
- **提交说明自动生成**：如 `feat: 更新文章「标题」`、`feat: 更新公告`、`feat: 更新歌单`、`chore: 上传 xxx.mp3`
- **推送前自动对齐远端**：先 `git fetch`，若 GitHub 上有新提交（网页编辑、手机发文等）会先 `git pull --rebase` 再推送，避免被拒
- **推送后自动盯部署**：轮询 GitHub Actions，构建结束会再弹一次提示（✅ 部署完成 / ❌ 部署失败）
- 也可以随时手动点「**立即发布**」，或点「**从 GitHub 同步**」把远端新提交拉到本地

> 顶部标题栏的徽标会实时显示同步状态：`已同步` / `待同步 N` / `落后远端 N`。自动同步本质就是 `git add/commit/push`，走的是你本机的 git 凭据（Clash 之类的代理要保持可用）。

发布后 GitHub Actions 会自动构建并部署到 Cloudflare（约 1 分钟），无需在本地安装 pnpm。

## 拖拽上传

把文件**直接拖到页面任意位置**即可上传，落点按你当前所在的标签页自动判断：

| 当前页面 | 拖入的文件会去 | 额外行为 |
| --- | --- | --- |
| **音乐** | `public/assets/music/` | 音频自动提取封面/歌词（ID3 / FLAC / MP4 标签），并**直接加进歌单**；图片进 `cover/`、`.lrc` 进 `lrc/` |
| **媒体** | 当前下拉框选中的目录 | 支持多选批量上传 |
| 其它页面 | `src/content/posts/images/` | 若文章编辑器正开着，单张图片会顺手填成封面 |

拖动过程中页面中央会显示提示（"上传到：…"）；把文件拖到「上传封面…」按钮上则会强制进文章图片目录。

## 从音频自动提取封面与歌词

上传音频（或点歌曲编辑框里的「从音频重新提取」）时，会读取音频文件自带的标签：

| 格式 | 读取内容 |
| --- | --- |
| MP3 | ID3v2.3/2.4 的 `TIT2`(歌名)、`TPE1`(歌手)、`APIC`(封面)、`USLT`(歌词)、`SYLT`(同步歌词→转 LRC) |
| FLAC | Vorbis Comment（`TITLE`/`ARTIST`/`LYRICS`）+ `PICTURE` 块 |
| M4A/MP4 | `ilst` 的 `©nam`/`©ART`/`©lyr`/`covr` |

- 封面写进 `public/assets/music/cover/`，歌词写进 `lrc/`，歌名/歌手自动回填表单
- 歌词**带时间戳**就直接用（能逐行高亮滚动）；只有**纯文本**时，会读取音频时长后按长度平均铺开成 LRC（提示里会标注"粗略同步"，要精确请用带时间轴的歌词）

## 数据放在哪

为了不让你（或我）去改 TS 源码，公告与歌单的数据被单独抽成了 JSON，管理面板只读写这两个文件：

| 文件 | 内容 | 谁在用 |
| --- | --- | --- |
| `src/config/announcements.json` | 公告列表（含固定公告） | `announcementConfig.ts` 导入 → 首访弹窗 / 公告页 / 侧边栏 |
| `src/config/music-playlist.json` | 歌单 | `musicConfig.ts` 导入 → 悬浮播放器 |
| `src/config/friends.json` | 友链列表 | `friendsConfig.ts` 导入 → 友链页 |

其它配置（站点信息、导航、个人信息…）仍然在 `src/config/*.ts` 里，用「配置」页的编辑器改。

## 站点设置：改 TS 配置也不会改坏

「站点设置」页把常用的 `src/config/*.ts` 字段做成了表单，写入流程是刻意设计过的：

1. **白名单**：只允许 `admin/settings.mjs` 里 `SETTINGS_DEFS` 声明的字段，其它键一律拒绝
2. **类型校验**：字符串长度、数字范围（如主题色相 0-360）、枚举取值、布尔、关键词数组格式
3. **写前快照**：原文件先另存到 `admin-backups/`
4. **结构体检**：改写后花括号/方括号数量必须与原文一致，否则放弃修改
5. **回读校验**：把刚写的值重新解析一遍，与目标不一致 → **立即回滚**并报错

所以即使正则匹配到了意料之外的位置，也不会把仓库留在"构建失败"的状态。`pages.*` 开关是从 `siteConfig.ts` 顶部的 `resolvePageToggles({...})` 里**动态读取**的，主题加了新页面开关，面板会自动出现。

## 站点头像（上传 / 恢复默认）

「站点设置」页最上面有一张**站点头像**卡片：当前头像缩略图 + 路径 + 体积，加「上传新头像…」「恢复默认」两个按钮。

**为什么放在「站点设置」而不是「媒体」页**：换头像不是「往目录里塞一个文件」那么简单，它得**同时改写 `src/config/profileConfig.ts` 的 `avatar` 字段**（首页侧栏资料卡、文章分享海报、OG 图、`Person.image` 结构化数据都读这个字段）；而「站点设置」才是配置的归属地，写入共用同一套「白名单 → 快照 → 回读校验 → 回滚」。「媒体」页继续负责通用文件管理（列表 / 复制路径 / 删除 / 批量转 WebP）。

### 接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/avatar` | GET | 返回当前状态：`{ settingId, url, repoPath, fileExists, size, updatedAt, isDefault, remote, rewritable, default, dir, limits }` |
| `/api/avatar` | POST | `{ filename, dataBase64 }` → 换头像；`{ restore: true }` → 改回默认头像（`restore` 只接受 `true`） |

换头像成功（HTTP 200）：

```json
{
	"ok": true,
	"name": "avatar-9f2c1ab34d5e.png",
	"url": "/assets/images/avatar-9f2c1ab34d5e.png",
	"repoPath": "public/assets/images/avatar-9f2c1ab34d5e.png",
	"bytes": 2049,
	"uploadedBytes": 40960,
	"originalName": "my-avatar.png",
	"resized": true,
	"width": 512,
	"height": 341,
	"note": "已等比缩放到最长边 ≤ 512px（1200×800 → 512×341，40KB → 2KB），并去掉了 EXIF（含 GPS 等元数据）",
	"previous": "/assets/images/avatar-zhi.webp",
	"changed": ["profile.avatar"],
	"avatar": { "…": "和 GET 返回的状态对象一样" },
	"message": "头像已换成 /assets/images/avatar-9f2c1ab34d5e.png（新文件，原头像保留，可随时「恢复默认」）"
}
```

### 规则（不满足一律 400 + 中文提示）

| 规则 | 说明 |
| --- | --- |
| 格式白名单 | `png / jpg / jpeg / webp / avif / gif`（与「媒体」页 `avatar` 目录的 `UPLOAD_EXT.avatar` 同口径） |
| 体积上限 | **25 MB**：前端先拦一次，后端按 base64 长度预检、解码后再卡一次（通用上传只有 64 MB 请求体上限；25 MB 与 `MAX_IMPORT_BYTES`、快照单文件上限同口径，保证「能传的一定备得上份」） |
| 真实格式 | 按**文件头魔数**判定，不信扩展名：`a.php.png`、把 txt / PHP 改名成 `.png` 一律拒绝；落盘扩展名也取自魔数（`jpeg` 归一成 `jpg`） |
| 文件名 | `avatar-<内容 sha256 前 12 位>.<格式>`；内容相同 → 文件名相同（可重入，不会反复堆文件），中文 / 空格 / 特殊字符不会进 URL |
| 不覆盖原图 | `avatar-zhi.webp` 永远留着，「恢复默认」就是把它写回去；上传过的图也**不删**（随时能切回去） |
| 缩放 | 本地有 `sharp`（站点构建依赖，面板用 `createRequire` 惰性解析）时把最长边缩到 **512px**：等比、不放大、去掉 EXIF；**动图（animated WebP / APNG）与 GIF 不缩**（默认参数会把动画压成静帧，见 `profileConfig.ts:9-10` 的动图红线）；没有 `sharp` 或缩放失败 → 按原图保存，并在 `note` 里写明原因 |
| 写配置 | 走 `settings.mjs` 的写入链（白名单 → 类型校验 → 写前快照 → 结构体检 → 回读校验）；**改配置失败会把刚写入的新图片删掉**再回滚，不留没人引用的孤儿文件 |
| 发布 | 新图片在 `public/assets/images/`、配置在 `src/config/profileConfig.ts`，两者都在 `PUBLISH_SCOPE` 内 —— 点「发布」会一起提交，不存在「换了头像但没提交」的坑 |

### 已知边界

- 只认 `/assets/images/<文件名>` 这种**平铺**路径。若 `avatar` 被手工写成远程 URL、`src` 相对路径或子目录，卡片只显示路径本身（`repoPath: null`、`fileExists: false`），请改用「媒体」页或「配置」页。
- 友链页里那张自己的头像写在 `src/content/spec/friends.mdx`（硬编码成站点绝对 URL），**不会跟着换** —— 它是内容文件，需要时在编辑器里手改；旧文件不会被删，所以也不会 404。
- 「恢复默认」只改配置，不清理你上传过的图片。

## 更新公告草稿（从最近改动生成）

**解决什么**：你加了新功能 / 改好了 bug，**回访的老访客不会知道**。这一块就是「把最近的代码改动快速变成一条面向访客的更新公告」。

**位置**：「公告」页最上面那张卡片 —— 一个可选的「起始点」输入、一个「最多取多少条提交」输入（默认 20）+「生成草稿」按钮。

> `limit` 的作用范围要说清：它只在**判断不出「上次公告」而退化成「最近 N 条」**时决定取多少条；其余情况一律最多读 200 条（`range.cap` 会如实告诉你这次用的上限，`truncated: true` = 区间里的提交比读到的更多，该填个更近的起始点）。

**怎么用（4 步）**：

1. 起始点**留空** = 自「上次公告」之后（面板取**最后一次改动 `src/config/announcements.json` 的提交**当分界，`<那个提交>..HEAD`）；也可以手填：
   - 提交 sha（7~40 位十六进制，如 `b607b70`）→ 取该提交**之后**（不含它）的提交；
   - 天数（如 `30`）→ 最近 30 天；
   - 日期（如 `2026-10-01`）→ 该日期起（含当天）。
2. 点「**生成草稿**」：面板读 `git log`（**只读，不改任何文件**），把提交整理成中文草稿，并**填进下面的公告表单**（新建态：标题、正文、日期、版本号都填好，`id` 形如 `update-2026-10-11-764ffbe`）。
3. **人来看一眼**：按提示改文案、删掉不想要的条目、决定要不要勾「固定为弹窗公告」。
4. 点「**保存**」→ 再按老流程去「发布」页点「立即发布」推送，老访客才看得到。

**草稿规则**（想改规则就改 `admin/announcement-draft.mjs`，那是唯一的实现处）：

| 规则 | 行为 |
| --- | --- |
| 取哪些提交 | 只取 `feat:`（→ 新增）、`fix:`（→ 修复）、`perf:`（→ 优化） |
| 跳过哪些 | 合并提交（`Merge …`）与 `chore:` / `docs:` / `style:` / `ci:` / `test:` / `build:` / `release:` / `typo:`（只计入统计，不写成要点） |
| 其它类型 | `refactor:` / `revert:` / 认不出的类型、以及不符合 Conventional Commits 的提交 → 归到「**其它维护**」**原样保留**，并给一条 warning 让你自己判断要不要发 |
| 标题 | `更新：新增 N 项、修复 M 项…`；有破坏性变更（`!` 或正文 `BREAKING CHANGE:`）会追加「（含破坏性变更）」 |
| 正文 | Markdown 分组列表（`### 新增` + `- 要点`）；`feat(admin):` 这类 scope 会查表变成中文前缀（`【面板】`），认不出就原样保留 |
| 中文从哪来 | 提交说明本身是中文 → 原样用；是英文 → **只把首词**机械映射成中文动词（add→新增、fix→修复、update→更新…），剩下的英文保留，并强制给一条 warning 让你润色 —— **这不是翻译**，别指望直接发 |
| 安全 | 提交说明里若带 `#`、`*`、反引号、`<script>` 之类，会被转义成字面量，不会变成 HTML |
| 空结果 | 区间里没有可用提交时**不会生成空公告**：卡片上直接告诉你「没有找到可用的提交」以及下一步怎么办 |

**接口**（`GET`，只读；未认证一律 403）：

```text
GET /api/announcement-draft                      # 默认：自「上次公告」之后
GET /api/announcement-draft?since=30             # 最近 30 天
GET /api/announcement-draft?since=2026-10-01     # 从某天起
GET /api/announcement-draft?since=b607b70        # 从某个提交之后（不含它）
GET /api/announcement-draft?since=30&limit=100   # limit 默认 20（只在退化成「最近 N 条」时决定取几条），上限 200
```

成功（HTTP 200）返回的形状：

```json
{
	"ok": true,
	"hasDraft": true,
	"empty": false,
	"range": { "mode": "sha", "label": "自提交 b607b70 之后（不含该提交）", "since": "b607b70", "limit": 20, "fetched": 13, "truncated": false, "cap": 200 },
	"draft": {
		"id": "update-2026-10-11-764ffbe",
		"title": "更新：新增 1 项、修复 2 项",
		"published": "2026-10-11",
		"version": "2026-10-11",
		"type": "info",
		"pinned": false,
		"content": "本次更新共 3 项（2026-10-11）：\n\n### 新增\n\n- 主页功能导览部件…\n\n### 修复\n\n- 【安全】修复审计发现的问题\n",
		"links": []
	},
	"warnings": ["…"],
	"stats": { "total": 13, "used": 3, "groups": { "新增": 1, "修复": 2, "优化": 0, "其它维护": 0 } },
	"commits": [{ "shortHash": "764ffbe", "type": "feat", "scope": "", "subject": "主页功能导览部件…", "breaking": false, "conventional": true, "merge": false }],
	"message": "已生成草稿：更新：新增 1 项、修复 2 项（3 条要点）。请确认或删减后点「保存」，再去「发布」页推送即可上线。"
}
```

| 情况 | HTTP | 返回 |
| --- | --- | --- |
| 没带凭据 | **403** | `{"error":"令牌无效，请重新启动管理后台"}` |
| `since` / `limit` 格式非法、未知查询参数 | **400** | `{"error":"since 只能是「提交 sha（7-40 位十六进制）」「YYYY-MM-DD 日期」或「最近天数（1-3650）」，收到：zzz"}` |
| `since` 语法对但提交不存在 | **400** | `{"error":"起始提交不存在：deadbee（也可以改填天数，例如 since=30，或日期 2026-10-01）"}` |
| 用 POST / PUT 调它 | **405** | `{"error":"请用 GET 调用 /api/announcement-draft"}` |
| 带字段 POST（`POST_BODY_FIELDS` 登记为 `[]`） | **400** | `{"error":"请求体包含不支持的字段：items"}` |
| 区间里没有可用提交 | **200** | `hasDraft:false`、`draft:null`，`message`/`warnings` 说明原因与下一步 |
| git 命令失败（不是仓库 / 找不到 git） | **502** | `{"error":"读取 git 历史失败：…（请确认当前目录是 git 仓库；也可以改填 since 参数缩小范围）"}` |

**已知边界**（都是有意为之，不要当成 bug 修）：

- **只产草稿，绝不自动发布**：接口不写任何文件、不打快照；保存仍走 `POST /api/announcements`，上线仍要点「发布」。
- **英文提交不会变成好中文**：只有首词被机械映射，剩下的英文原样保留 + warning。要发英文提交的公告，请人工改写。
- **站点上的公告正文是纯文本**（按空行分段渲染，不解析 Markdown）：草稿里的 `### 新增` 与行首的 `-` 会原样显示，想更干净就删掉标题行、只留列表。
- **草稿默认不勾「固定为弹窗公告」**：固定公告只能有一条，勾了会顶掉现有那条；要不要让所有回访访客都看到弹窗，由你决定（同时记得改「弹窗版本号」）。
- **只按提交类型筛选，看不懂提交内容**：一条 `feat: 修个错别字` 也会被列进「新增」，请人工删减。
- **一次最多读 200 条提交**（`truncated: true` 会提示），区间太大时要分批生成，别漏发。

## 体检（发布前的安全闸）

「体检 / 备份」页点「开始体检」即可。**10 项**检查，其中 9 项只读、秒级，只有「文章 schema」那一项会跑一次真实构建（约 10 秒，见下）。

| 检查 | 级别 | 说明 |
| --- | --- | --- |
| JSON/JSONC 合法性 | error | 所有配置与数据文件能否解析 |
| 歌单引用 | error | 每首歌的 `url`/`cover`/`lrc` 是否真的存在 |
| 公告完整性 | error | 必填字段、日期格式、固定公告只能一条 |
| 文章 frontmatter（YAML 速查） | error / warn | 秒级查「不依赖 schema 的通用坑」：日期被引号包住（`published: "2026-10-11"` 会变成字符串）、日期不是 `YYYY-MM-DD`（`2026/10/11`、`2026-13-45`、带时间但没秒的 `2026-10-11 10:30`）、`tags` 写成字符串或空、frontmatter 缺失或 YAML 语法坏（Tab 缩进 / 括号不配对 / 键重复 / 引号没闭合）、缺 `title`/`published`；顺带查封面图是否存在、文件名（slug）是否重复 |
| 文章 schema（真实构建校验） | error（跑不起来时 warn） | 跑**真实的** `astro build`，用 `src/content.config.ts` 的真实 schema 校验全部内容；报错翻成「文件 → 字段 → 期望类型 → 实际类型 → 怎么改」 |
| 站内链接 | warn | 正文里的 `](/path/)` 是否有对应页面（自动跳过代码块示例） |
| 疑似密钥 | error | `ghp_`/`sk-`/私钥/Cloudflare Token 等模式 |
| 异常大文件 | warn | 超过 8 MB 的文件（影响部署与国内加载） |
| 配置矛盾 | warn | 例如 `playerEnable: false` 却还留着 `playerUrl` |
| Git 状态 | warn | 未提交 / 待推送 / 落后远端 |

### 文章 frontmatter：为什么有两条检查

以前的体检只查「`title`/`published` 有没有写、日期是不是以 `YYYY-MM-DD` 开头」，**恰好漏掉**「日期被引号包住」这个坑 —— 那条正则会把引号吃掉，看起来一切正常，推上去 CI 才红：

```text
src/content/posts/xxx.md:0:0
published: Expected type `"date"`, received `"string"`
```

现在两条检查分工明确，而且**都不另写一套 schema**（手抄字段表一定会和 `src/content.config.ts` 漂移）：

1. **YAML 速查（秒级）**：只查与 schema 无关的通用写法问题（引号 / 日期写法 / 列表写法 / YAML 语法），能直接说清「第 3 行 `published` 被引号包住了，去掉引号」。
2. **真实构建（权威）**：直接跑仓库里真实的 `astro build`，字段名、类型、必填与否全部由 `src/content.config.ts` 说了算；它给的是「期望 `date`，实际是 `string`」这种来自真实 schema 的结论。

> 这两条是**发现**坏数据，不是**不再产生**坏数据。坏数据以前是面板自己写出来的 —— 写入侧的根因与修法见上文「**文章编辑器：保存时 frontmatter 怎么处理**」（`published: "2026-10-11"` 就是那个 bug 的产物）。

真实构建那一项的几个约定：

- 产物写到 `.astro/doctor-build/`（已在 `.gitignore` 里），**不会覆盖 `dist/`**；
- 一次约 10 秒（本机实测 12～13 秒；坏 frontmatter 会更早失败，约 6 秒）；
- 结果按「`src/` + 根配置文件的指纹」在**同一次面板运行内**缓存：文件没变就直接复用，所以「先体检、再发布」不会构建两次；
- **跑不起来不算错**：没装依赖、超时（默认 90 秒，可用环境变量 `ADMIN_DOCTOR_BUILD_TIMEOUT_MS` 调）都只给 ⚠️ warning，并说明「这一次没校验到」——**不会**因此拦住发布，也**不会**静默通过。

**发布时会自动跑一遍**：只要出现 error 级问题就拦住 push（`/api/publish` 可用 `force: true` 跳过）。被拦住时，发布页的「发布日志」会直接列出「哪个文件（路径徽章：可复制 / 打开所在文件夹）→ 哪个字段 → 怎么改」，并给一个「去体检页」按钮；接口返回 `blocked: true` + 完整 `report`，`message` 里也带同样的前几条。

## CI 失败详情（错在哪一步）

以前失败了只给一个短 sha，还得自己点进 GitHub Actions 翻日志。现在 `/api/ci` 会把失败的 check-run 一路追到「哪个 job 的哪个 step 挂了」，红色横幅直接显示：

```
❌ CI 部署失败：abc1234（❌ 失败）
检查 build · 失败步骤：Build site
原因：步骤 `Build site` 失败：Process completed with exit code 1
▸ 查看日志片段（最后 30 行）
[Actions 日志 →] [这次的 job →]                    [回滚这次提交（abc1234）]
```

### 它是怎么查出来的

| 步骤 | 请求 | 拿到什么 |
| --- | --- | --- |
| 1 | `GET /repos/{o}/{r}/commits/{sha}/check-runs` | 每个提交的 check-run（结论 + `details_url`） |
| 2 | 从 `details_url` 正则取运行 id（形态 `…/actions/runs/<id>/job/<jobId>`） | `1234567890` |
| 3 | `GET /repos/{o}/{r}/actions/runs/{id}/jobs` | 该次运行的 job 列表 → 失败 job 里结论为失败的步骤名 |
| 4 | `GET /repos/{o}/{r}/actions/jobs/{job_id}/logs` | 失败作业的日志尾部（最后 30 行；**仅当第 3 步拿到了失败步骤才请求**） |

### `/api/ci` 的 `lastFailure` 字段（失败时非空）

```json
{
	"ok": true,
	"runs": [ "…8 个提交的结论，字段不变…" ],
	"lastSuccess": { "sha": "05b5c94…", "url": "https://github.com/…/actions/runs/…" },
	"lastFailure": {
		"sha": "05b5c9412345678901234567890123456789abcd",
		"shortSha": "05b5c94",
		"conclusion": "failure",
		"status": "completed",
		"url": "https://github.com/zhihai-blog/firefly/actions/runs/1234567890/job/3456789012",
		"createdAt": "2026-10-11T07:30:00Z",
		"message": "feat: 示例提交",
		"checkName": "build",
		"detailsUrl": "https://github.com/zhihai-blog/firefly/actions/runs/1234567890/job/3456789012",
		"runUrl": "https://github.com/zhihai-blog/firefly/actions/runs/1234567890",
		"jobName": "build",
		"failingSteps": ["Build site"],
		"reason": "步骤 `Build site` 失败：Process completed with exit code 1",
		"logExcerpt": "log line 32\n…\nProcess completed with exit code 1",
		"detailWarning": ""
	}
}
```

| 字段 | 含义 |
| --- | --- |
| `sha` / `shortSha` / `status` / `createdAt` / `message` | 提交本身的信息（和 `runs[]` 里那条一致） |
| `conclusion` | 汇总后的结论（`failure`；`timed_out` / `startup_failure` 等也归到这里） |
| `checkName` | 失败的 check-run 名称（一般就是 job 名） |
| `detailsUrl` | check-run 的 `details_url`（通常精确到 `…/job/<jobId>`） |
| `runUrl` | 化简出的**那次 Actions 运行**地址 `…/actions/runs/<id>`；解析不出来是 `""` |
| `jobName` | 失败作业名；没拿到是 `""` |
| `failingSteps` | 失败步骤名数组（可能为空） |
| `reason` | 一句话中文摘要（有步骤时形如「步骤 \`X\` 失败：<output.summary>」，否则退化成 `output.title` / `output.summary`） |
| `logExcerpt` | 失败作业日志的最后 30 行（**拿不到就没有这个键**） |
| `detailWarning` | 详情获取过程中的降级说明（正常情况下是空串） |

前端横幅以 `lastFailure` 为准（找不到就退回 `runs[]` 里同 sha 的那条补齐结论/时间）：所以旧的失败被之后某次成功覆盖后，红条会自动消失，不会一直挂着。

### 限流与降级

- **60 秒内存缓存**：所有 GitHub 请求都走 `admin/ci.mjs` 的 `fetchWithCache()`，同一 URL 在 `CI_CACHE_TTL_MS`（60 秒）内只请求一次 —— 匿名 API 每小时只有 60 次，反复刷新面板不会把它刷爆；`ttlMs: 0` 可强制绕过缓存。缓存最多留 200 条（超出淘汰最旧的）。
- **只缓存成功响应**：超时、断网、403（限流）、404、非法 JSON 都不进缓存，避免一次偶发失败在 60 秒内被"钉死"。
- **8 秒超时**（`CI_TIMEOUT_MS`）+ 任何异常都降级成 `{ ok: false, error }`，不抛错；日志响应超长时只保留尾部 2 MB 再切 30 行。
- **详情失败不影响主流程**：`lastFailure` 的基本字段（sha / conclusion / checkName / detailsUrl / reason）照常返回，失败原因写进 `detailWarning`，`/api/ci` 永远是 200（路由里还保留了一层 try/catch 兜底）。
- 失败详情只在「这个失败真的要展示时」才去拉（最多多 2 个请求：jobs + logs）。

### 代码位置

| 文件 | 职责 |
| --- | --- |
| `admin/ci.mjs`（零依赖、可单测） | `extractRunId` / `runPageUrl` / `pickFailingJobs` / `pickFailingSteps` / `summarizeFailure` / `describeFailure` / `fetchWithCache` / `tailLines` / `firstLine` / `summarizeConclusion`（含 `FAILURE_CONCLUSIONS`） |
| `admin/server.mjs` | 只接线：`failureDetail()` 发请求并逐步降级，`ciStatus()` 决定是否返回 `lastFailure` |
| `admin/index.html` | 横幅渲染：`checkName` / `reason` / 步骤名 / 日志片段等**外部文本一律 `escapeHtml`**，日志用 `<details>` 折叠 |

### 已知取舍

| 取舍 | 说明 |
| --- | --- |
| 日志是"尽力而为" | `actions/jobs/{id}/logs` 对匿名请求并不稳定（可能 403/404，也可能 302 到签名地址）。取不到就不显示日志片段，只在 `detailWarning` 里说明；步骤与原因仍然照常显示 |
| `reason` 只点名第一个失败步骤 | 多个失败步骤会在「失败步骤」一行里全部列出，摘要在句子里只用第一个 |
| `cancelled` 不算失败 | 手动取消不触发红条（`FAILURE_CONCLUSIONS` 故意不含它）；`failure` / `timed_out` / `action_required` / `startup_failure` / `stale` 才算 |
| 只看最近 8 个提交 | 和改造前一致；更早的老失败不显示 |

## 备份与恢复

任何**写入**（文章、公告、歌单、站点设置、配置文件）之前，面板都会把原文件复制到：

```
admin-backups/<时间戳>-<随机>/          ← 已写进 .gitignore，不会提交也不会发布
    ├─ src/config/siteConfig.ts
    └─ meta.json                        ← 时间、原因、涉及文件
```

默认保留最新 **40** 份，超出自动清理最旧的；保留份数可在「体检 / 备份」页改（任意正整数，保存后立即清理超出部分）。「体检 / 备份」页列出快照，点「恢复 xxx」即可回滚某个文件；
**恢复前还会先给"当前版本"再打一份快照**，所以恢复错了也能再恢复回来。

设置本身写在 `admin-backups/keep.json`（随备份目录一起被 gitignore）；输入非法（0、负数、小数、非数字）会返回 400 并保持原设置不变。

## 认证方式（HttpOnly Cookie）

打开面板时地址里带着一次性令牌（`?token=…`）。页面一旦加载，令牌就换成 **HttpOnly Cookie**：

- 页面脚本读不到这个 Cookie（`HttpOnly`），也不会随页面内链泄漏到 Referer
- 页面加载后立刻把地址栏里的 `?token=` 抹掉（`history.replaceState`），不留在浏览器历史里
- 接口同时兼容 `X-Admin-Token` 请求头与 `?token=`（试听用的 `<audio>` 和 ZIP 下载要走 URL）
- 令牌每次启动随机生成、Cookie 用 HMAC 签名且恒定时间比较；关掉窗口就全部失效
- 若看到「认证失败（403）」，用带令牌的地址重新打开面板即可

## 导航菜单（隐藏 / 改名 / 排序）

「站点设置 → 导航菜单」的改动**不写进 TS 源码**，而是写进 `src/config/nav-overrides.json`：

| 字段 | 含义 |
| --- | --- |
| `hidden` | 要隐藏的菜单项 id 数组 |
| `order` | 自定义顺序（数组顺序即显示顺序，未提到的项保持原相对顺序） |
| `renamed` | `id → 新显示名` |

主题侧由 `src/config/navBarConfig.ts` 的 `applyNavOverrides()` 在构建时应用；**三个字段都为空 = 完全不影响现有行为**。
菜单项 id 就是 `navBarConfig.ts` 里每项显式写的 `id`（如 `home`、`friends`、`links-github`）。

> 面板只做**隐藏 / 改名 / 排序**，**不支持新增菜单项** —— 新增要改 TS 里的数组，风险大，请手工编辑 `navBarConfig.ts`。

## 友链管理

友链页的数据原来硬编码在 `src/config/friendsConfig.ts` 里。现在数据搬到了 **`src/config/friends.json`**，
`friendsConfig.ts` 只负责 `import` 它（`friendsPageConfig` 与 `getEnabledFriends()` 行为完全不变），
于是面板可以安全地增删改，而不必去改写 TS 源码 —— 改坏一个引号就会让整站构建失败。

### 接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/friends` | GET | 返回 `{ items: [...] }`（就是 `friends.json` 的内容） |
| `/api/friends` | POST | `{ action: "add" \| "update" \| "delete" \| "move" \| "toggle", ... }`，成功返回 `{ ok, items, backup, message }` |
| `/api/friends-fetch` | POST | `{ url }` → `{ ok, url, charset, title, desc, iconUrl, iconPath, warnings }` |

```jsonc
// 新增
{ "action": "add",    "item": { "title": "…", "imgurl": "/friends/x.png", "desc": "…", "siteurl": "https://…", "tags": ["友链"], "weight": 10, "enabled": true } }
// 修改（只覆盖传进来的字段）
{ "action": "update", "index": 3, "item": { "title": "改名" } }
// 删除 / 上移 / 停用
{ "action": "delete", "index": 3 }
{ "action": "move",   "index": 3, "direction": "up" }
{ "action": "toggle", "index": 3, "enabled": false }
```

写入流程和其它数据一样：**校验 → 写前快照（`admin-backups/`）→ 写 JSON（tab 缩进、UTF-8、末尾换行）→ 读回校验（条数 + 逐条内容）→ 不一致立即回滚**。

### 校验规则（不满足一律 400 + 中文提示）

| 字段 | 规则 |
| --- | --- |
| `title` | 必填，≤ 60 字（按码点算，一个 emoji 算 1 个字） |
| `desc` | ≤ 120 字 |
| `siteurl` | 必填，只允许 `http:` / `https:` |
| `imgurl` | 必填，站内绝对路径（`/friends/x.png`）或 `http(s)` 图片直链 |
| `tags` | ≤ 4 个、每个 ≤ 12 字的字符串数组（自动去重去空） |
| `weight` | -999 ~ 999 的整数 |
| `enabled` | 布尔值 |
| 总数 | ≤ 200 条 |

### 「从网址抓取」都处理了哪些坑

点「从网址抓取」只是把结果**填进表单**，不会保存 —— 猜错了直接改，不想要就点「取消」。

- **编码**：先读 `<meta charset>` / `<meta http-equiv="Content-Type">` 声明，再退回 HTTP 头，最后才是 UTF-8。
  声明 `gb2312 / gbk` 的站按 `TextDecoder("gbk")` 解码，否则中文站整页乱码。
- **HTML 实体**：`&amp;`、数字实体 `&#12345;`、十六进制 `&#x1F600;` 都会解码。
- **优先级**：标题 `og:title` → `<title>`；简介 `og:description` → `meta[name=description]` → `twitter:description`。
  `<meta content="…" property="og:title">` 这种**属性顺序颠倒**的写法照样能认出来（按属性名取值，不依赖顺序）。
- **未渲染的模板变量**：`site.seo.description`、`{{ page.title }}`、`${config.site.desc}` 这类占位符不会被当成标题/简介，
  而是写进 `warnings` 提示你手填（`astro.build`、`node.js` 这类正常文本不会误判）。
- **防爬 / 验证页**：标题命中 `Verify Yourself`、`Checking your Browser`、`Just a moment`、`Attention Required` 等特征时同样不采用，改为提示手填。
- **JS 动态渲染**：正文很短又没有 meta 时，明确提示「页面没有可用的静态介绍，请手动填写」——这类站只能手填。
- **图标**：候选顺序 `apple-touch-icon` → `link[rel~=icon]` → `og:image`，相对路径按**最终 URL**解析；
  按**文件头字节**（png / jpeg / gif / webp / ico / svg）判断是不是真图片，大小限制 100 B ~ 400 KB，
  落盘为 `public/friends/<域名slug>-<N>.<ext>`，**文件已存在就换序号，绝不覆盖**（写入用 `wx` 标志，并发也不会盖）。
  SVG 允许保存（用 `<img>` 加载不会执行脚本）。
- **SSRF 防护**：只允许 `http(s)`；拒绝 `localhost`、`127.0.0.1`、`::1`、`10.`、`172.16-31.`、`192.168.`、`169.254.`
  以及十进制 / 十六进制 / 八进制 / 简写的等价私网写法（`2130706433`、`0x7f.0.0.1`、`127.1` …）；
  重定向**每一跳都重新检查主机**（公网域名 302 到 `127.0.0.1` 也会被拦），并额外做一次 DNS 解析核对。
- 其它：15 秒超时、响应体上限 3 MB、用常见浏览器 UA（不少站会拒绝 Node 默认 UA）。
- 局限：这是「尽力而为」的加固，不是完整的安全边界 —— 判断与请求之间仍存在 DNS 重绑定窗口，
  也不检查非 HTTP 端口语义；链接预览请只对自己信任的站点使用。

### 面板之外

- 想手工加朋友？直接编辑 `src/config/friends.json` 即可，`friends.json` 也在「配置」页的可编辑白名单里。
- 图标缩略图通过后端 `/media-file` 只读读取 `public/friends/`（该目录**不在**媒体上传 / 删除白名单内，
  也就是说面板不会覆盖或删除你已有的图标文件）。
- 本页**不支持上传自定义图标**：头像字段只填「站内路径 / 图片直链」；要换图标请把文件放进 `public/friends/` 再填路径。

## 一键压缩（音乐 / 图片）

| 面板按钮 | 实际命令 | 是否改动文件 |
| --- | --- | --- |
| 音乐 → 先试算 | `node scripts/compress-music.mjs --dry-run` | 只列出，不改动 |
| 音乐 → 只压封面 | `… --covers` | 只改封面图 |
| 音乐 → 音频+封面 | `… --all` | **会重写音频并更新歌单**（有二次确认） |
| 媒体 → 批量转 WebP | 用仓库里的 `sharp` | **只新增 `.webp`，不删除也不覆盖原图**（默认先试算） |

⚠️ `compress-music.mjs` **不带任何参数**时等于「压缩音频并改写歌单」，所以面板里的「先试算」固定带 `--dry-run`，不会误触发。

## 备份导出

「体检 / 备份」里每个快照旁的**导出 ZIP** 会下载 `admin-backup-<快照id>.zip`（不压缩存储，便于核对），
走 `/api/backup-export`，快照 id 与每个文件路径都做过越界校验。

## 文件存在哪：路径徽章

面板里**每一类内容都写明它的真实文件路径**，目的只有一个：让你能直接去文件管理器 / 编辑器里找到那个文件，而不是先猜它在哪。

### 长什么样

路径徽章是 `admin/index.html` 里**唯一**的路径显示组件 `filePathBadge(relPath, opts)`，渲染出来是：

```html
<span class="path-badge" title="src/content/posts/markdown-cheatsheet.md">
  <code>src/content/posts/markdown-cheatsheet.md</code>
  <button class="path-btn" data-copy="src/content/posts/markdown-cheatsheet.md" title="复制：…">复制</button>
  <button class="path-btn" data-reveal="src/content/posts/markdown-cheatsheet.md" title="在资源管理器中定位（仅 Windows…）">📂</button>
</span>
```

- **复制**：点「复制」把仓库相对路径写进剪贴板，按钮上显示 **2 秒**「已复制」。复制走三级兜底：`navigator.clipboard.writeText` → `document.execCommand("copy")` → 都不行就把路径**选中**并提示你按 `Ctrl+C`。
- **📂 打开所在文件夹**：Windows 上用 `explorer /select,"<绝对路径>"` 定位到该文件（目录则打开它）。**只在 Windows 上真正执行**，其它系统返回 `ok:false` 与一句「请手动打开」的说明（不猜别的命令）。文件已删除 / 尚未创建 / 是远程 URL 时**不显示**这个按钮。
- 视觉上刻意次要：等宽小号字 + 次要颜色 + 可换行，`title` 里放完整值，不抢标题的视觉重心，也不撑破既有表单与表格。

### 哪些页签会显示

| 页签 / 位置 | 显示什么路径 | 来源接口的字段 |
| --- | --- | --- |
| 文章列表 | `src/content/posts/<文件名>`（`.md` / `.mdx` 原样）+ 该文 URL | `/api/posts` → `posts[].file` |
| 文章编辑器 | 当前文件、`src/content/posts/images`、正文 `./images/…` 引用到的图片（逐个核对过） | `/api/post` → `file` / `imagesDir` / `images[]` |
| 文章编辑器（新建） | 「保存后将写入 `src/content/posts/<slug>.md`（尚未创建）」 | `/api/posts` → `dir` + 输入框里的 slug |
| 媒体 | 当前目录 + 每个文件的 `public/assets/...`、体积、可引用的站内 URL | `/api/media` → `dirs` / `files[].repoPath` |
| 公告 | `src/config/announcements.json`（列表卡片与编辑器各一处） | `/api/announcements` → `file` |
| 音乐 | `src/config/music-playlist.json` + 每首歌音频 / 封面 / 歌词的真实文件 | `/api/playlist` → `file` / `paths[]` |
| 友链 | `src/config/friends.json`、`public/friends/` + 每个图标的 `public/friends/<文件名>` | `/api/friends` → `file` / `dir` / `icons[]` |
| 导航菜单 | `src/config/nav-overrides.json`（+「尚未创建」提示）与只读来源 `src/config/navBarConfig.ts` | `/api/nav` → `file` / `fileExists` / `sourceFile` |
| 站点设置（每一项 / 页面开关 / 横幅副标题） | `文件 → within.key`，如 `src/config/siteConfig.ts → navbar.title`、`src/config/backgroundWallpaper.ts → waves.enable.desktop`、`src/config/siteConfig.ts → resolvePageToggles.<name>` | `/api/settings` → `defs[].file/within/key`、`pageToggle.{file,block}` |
| 站点头像 | `src/config/profileConfig.ts → avatar` + `public/assets/images/<文件名>` | `/api/avatar` → `config.{file,key}` / `repoPath` / `fileExists` |
| 体检 / 备份 | `admin-backups/<id>/` 与快照里每个文件的 `rel` | `/api/backups` → `dir` / `files[].rel` |
| 发布 | 「待提交的改动」逐条 `{状态码, 路径}`；发布后列出本次提交的文件与被跳过的范围外改动 | `/api/diff` → `files[]`；`/api/publish` → `files` / `skipped` |

### 加新页面 / 新展示项时必须遵守

1. **复用 `filePathBadge()`**，不要各页自己拼 HTML —— 复制、已复制反馈、打开文件夹只有这一份实现（`data-copy` / `data-reveal` 由文档级事件委托统一处理，新徽章自动生效）。
2. **路径只能来自后端**：`fs.readdir` / `git status --porcelain -z` / 实际写入路径（保存后返回的 `file`）/ 快照目录，或按站点约定拼好后**当场 `stat` 核对**（如 `publicUrlToRepoPath` / `describeLocalFiles` / `describeFriendIcons`）。**前端不许自己拼路径** —— 拼错就等于让作者去文件管理器里白找一趟。

   > 站内 URL 可能带缓存参数（`compress-music.mjs` 会往歌单里写 `?v=<内容哈希>`）或 `#锚点`：转仓库路径前必须先剥掉 `?` / `#` 再 `stat`，否则会把存在的音频 / 封面误判成「文件不存在」。
3. **不许编造**：文件不存在就如实标 ⚠️ +「文件不存在」并隐藏「打开文件夹」按钮；还没创建的文件标「（尚未创建）」；远程 URL 只显示 URL 本身。
4. 添加了新的路径字段，就在上面的表里补一行，并同步 `docs/PROJECT-CONTEXT.md` 第 9.10 节与附录 E.2 第 11 行。

### 新增接口：`/api/reveal`（打开所在文件夹）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/reveal` | POST | `{ path }` → `{ ok, path, kind: "file"\|"directory", message? }` |

- `path` 是**仓库内相对路径**；越界 → `400`（`{"error":"只能打开仓库内的路径：…"}`），不存在 → `404`。
- 只接受 POST（GET → 405）；未认证照样 `403`（没有为它放宽任何鉴权）；`POST_BODY_FIELDS` 只放行 `path`（多带字段 → 400）。
- 拉起方式是 `spawn("explorer.exe", ["/select," + 绝对路径], { detached: true, stdio: "ignore" })` 且 `unref()`：**不阻塞请求**、不建管道、不等它退出（explorer 的退出码通常是 1，等它没有意义）。
- **仅 Windows**：其它平台返回 HTTP 200 + `{"ok": false, "message": "「打开所在文件夹」只在 Windows 上可用；…"}`，不会去尝试 `open` / `xdg-open` 之类行为不确定的命令。
- 它**不写盘、不打快照、不碰仓库内容**，只是把文件管理器叫起来。

### 顺带修掉的两个真问题

1. **`git status --porcelain` 的解析错位**：`run()` 会对 stdout 做 `trim()`，而 porcelain 的第一条记录可能是 ` M path`（以空格开头）—— 空格被吃掉后状态码与路径整体错位一个字符（`README.md` → `EADME.md`），`stageForPublish` 里 `git add -- <错路径>` 就会失败，表现为「明明有改动，发布却说没有需要提交的改动」。现在 `run()` 支持 `raw: true`（不 trim），`gitStatusZ()` 与 `stageForPublish` 都用它。
2. **体检里的 Git 详情全是 `undefined undefined`**：`repoInfo()` 返回的 `files` 是字符串数组，而 `doctor.mjs` 按 `f.status` / `f.file` 取值。现在 `repoInfo()` 另外返回结构化的 `changed[{code,path,origin}]`，体检详情改用它。

## 安全说明

- 服务只监听 `127.0.0.1`，同一局域网/公网都访问不到
- 每次启动生成随机访问令牌，页面和所有接口都要求带令牌（`?token=` 或 `X-Admin-Token` 头），避免其他网页偷偷调用你的本地服务
- 可写的路径有白名单：只有 `src/config/*` 白名单文件、`src/content/posts/` 与几个媒体目录可写，路径越界会被拒绝（`safeResolve`）
- 请求体上限 64 MB；设置写入有类型/范围/枚举校验；快照目录名与恢复路径都做过格式校验
- 头像上传额外做**文件头魔数**校验（改扩展名的脚本 / 文本传不进去）与 25 MB 上限，且只写 `public/assets/images/`（`admin/avatar.mjs`）
- 备份目录、构建产物、依赖目录都在 `.gitignore` 里，不会被误提交

## 想从手机/外网编辑？

这个后台是**本地**方案（最安全、零成本）。如果以后想在外面用手机发文，可以再做一套部署到 Cloudflare 的在线后台（需要给 Worker 配一个 GitHub token 与登录口令）。需要时告诉我就行。
