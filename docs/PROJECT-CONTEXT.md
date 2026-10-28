# 项目交接文档（给 AI agent / 新对话）

> 仓库：`D:\SoftWare\DeepSeek Harness\WorkSpace\1\firefly`
> 远端：`origin` = `https://github.com/Zhi2007/firefly-blog.git`（分支 `main`），`upstream` = `https://github.com/CuteLeaf/Firefly.git`（上游主题 `master`）
> 站点：<https://www.zhihaisblog.top>（裸域 <https://zhihaisblog.top> 301 到 www）
> 文档定位：**给 agent 的施工规范**。用户向说明（功能怎么用、配置怎么写）见仓库根 `README.md`（1059 行 / 13 章）与 `admin/README.md`（463 行），本文不重复它们，重点是**怎么改不出事**。
>
> 阅读顺序建议：第 1 章（速查）→ 第 2 章（哪些文件不能动）→ 第 12 章（为什么这么设计）→ 需要动手时再查对应章节。
>
> 事实来源：本仓库工作区文件（逐项读取）、`git log` 的 80 个提交与提交正文、`%TEMP%\project-evidence.json`（2026-10-11 实测响应头）。**凡是无法从仓库或该证据文件核实的，正文都显式标注「需确认」并说明原因**；没有写「需确认」的地方，都是我在仓库里读出来或有实测数据支撑的。文末列了「我读出来的文档与代码不一致之处」。

---

## 0. 使用本文档的三条硬规则

1. **改任何文件之前，先在第 2 章的三类分类里找到它**。落在「上游主题文件」里的，改动会和上游 diff 冲突；落在「内容与配置」里的才是日常改动区。
2. **每条结论都能在正文找到锚点**。锚点格式为 `文件:行号`，例如 `admin/server.mjs:1434 parseByteRange`，直接跳过去即可核对。
3. **不确定就复测**。仓库里有现成的门禁命令（第 11 章），跑一遍比猜便宜得多。

---

## 1. 30 秒速查

### 1.1 这一章解决什么问题

让一个从未见过这个仓库的 agent，在 30 秒内知道：这是什么、线上在哪、怎么构建、怎么发布、以及**最容易把它搞坏的 5 件事**。

### 1.2 一句话

用 Astro 7 静态生成的个人博客（Firefly 主题的个人定制版），产物由 **Cloudflare Worker** 接管（`run_worker_first: true`）后发布到 Cloudflare 边缘；内容与配置由一套**零依赖的本地管理面板**（`admin/`，只用 Node 内置模块）可视化维护，改完由面板 `git commit + push`，GitHub Actions 构建并 `wrangler deploy`（约 1 分钟上线）。

### 1.3 关键事实表

| 项目 | 值 | 依据 |
| --- | --- | --- |
| 站点主域 | `https://www.zhihaisblog.top` | `src/config/siteConfig.ts:51`；`%TEMP%\project-evidence.json` 实测 200 |
| 裸域行为 | 301 → `https://www.zhihaisblog.top/` | `worker/index.mjs:40-47`；实测 301 + `location` |
| GitHub 仓库 | `Zhi2007/firefly-blog`，分支 `main` | `git remote -v` |
| 上游主题 | `CuteLeaf/Firefly`（本地 ref `upstream/master`） | `git remote -v`、`git branch -r` |
| 主题版本号 | `firefly@6.16.8` | `package.json:4` |
| Astro | `7.3.2` | `package.json:56` |
| Svelte | `^5.57.0` | `package.json:90` |
| Tailwind CSS | `^4.3.3`（`@tailwindcss/vite`） | `package.json:91,103` |
| TypeScript | `^6.0.3` | `package.json:94` |
| Biome | `2.5.12` | `package.json:100`；本地实测版本一致 |
| Node 要求 | `>=22.23.0` | `package.json:6`；CI 用 node 24（`.github/workflows/deploy.yml:33`）；本机 v26.7.0 |
| 包管理器 | `pnpm@11.22.0`（`preinstall` 强制 pnpm） | `package.json:8,24` |
| 构建命令 | `pnpm build` → 8 步流水线 | `package.json:13` |
| 构建产物页数 | **30 个 HTML** | `dist/` 实测 30（2026-10-19 新增 1 篇文章后；此前为 29 / 28）；提交 `704baad`/`bc3f0b2` 等历史上以「astro build 28 页」为验收，页数随文章数变化 |
| Worker 名称 | `my-blog` | `wrangler.jsonc:2` |
| 发布链路 | 面板 stage → commit → push → Actions → `wrangler-action@v4` → CF 边缘 | `admin/server.mjs:1263-1324`、`.github/workflows/deploy.yml:58-63` |
| 上线耗时 | 约 1 分钟 | `admin/README.md:174`、`admin/server.mjs:1321` |
| 管理面板 | 优先双击根目录 `firefly-admin.exe`（单窗口：隐藏 node + Chrome/Edge `--app` 窗口 + 后台日志）；也可 `node admin/server.mjs`，监听 `127.0.0.1:8799` | `admin-launcher/FireflyAdminLauncher.cs`、`admin/server.mjs` |
| 面板页签数 | **11 个** | `admin/index.html` 的 `nav button[data-tab]` |
| `/api/*` 路由数 | **37**（36 个在 switch 内 + `/api/logout` 前置处理） | 静态提取脚本，见第 9.2 节 |
| 内容集合 | `posts` / `spec` / `dynamic` / `projects` | `src/content.config.ts:133-143` |
| 已发布文章 | 5 篇 | `src/content/posts/*.md` 实测 |

### 1.4 最容易踩的 5 条（背下来）

| # | 坑 | 后果 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 用 `git add -A` 或 `git add .` 提交 | 会把「改到一半的在制品」一起推上去，GitHub Actions 构建失败 → 线上部署挂掉。历史上真发生过：`09b0634` 的 4 个 `chore:` 提交里混进了半成品 `admin/ci.mjs`（284 行）和约 20 个 webp | 只用面板「发布」按钮（内部按 `PUBLISH_SCOPE` 白名单暂存，`admin/publish-scope.mjs:14-21`）；手工提交时**逐个列出路径** |
| 2 | 手工改 `src/config/*.ts` 里的 JSON 数据，或直接编辑面板管辖的 JSON | TS 源码改坏一个引号 = 整站构建失败；JSON 结构改坏 = 面板读取报错 | 数据类改 `src/config/{announcements,friends,music-playlist}.json`（面板会校验+快照）；站点设置走面板「站点设置」页（白名单 + 回读校验 + 回滚） |
| 3 | 手改 `src/constants/lqips.json`、`src/constants/icons-data.json`、`dist/`、`public/vndb-covers/` | 前两个是生成物（`lqips.json` 由 `pnpm lqips` 生成，`icons-data.json` 被 Biome 显式忽略），`dist/` 与 `public/vndb-covers/`、`admin-backups/`、`logs/` 都在 `.gitignore` 里 | 跑 `pnpm lqips` 重新生成；产物一律不手改 |
| 4 | 改 `public/vendor/giscus-*.mjs`、或改 `Giscus.astro` 里的 import 路径但不换文件名 | 该文件名带版本号并配了 1 年 `immutable` 缓存，改内容不换名 = 老访客永远拿旧文件 | 升级流程：下载新版本 → 存成 `giscus-<新版本>.mjs` → 同步改 `src/components/comment/Giscus.astro:68` 的 import 路径（`public/_headers:38-40`、`worker/index.mjs:124-126` 的缓存规则不用改） |
| 5 | 在 `admin/` 里 `import` 第三方包 / 加依赖 | 面板的设计前提是**零依赖**（只用 `node:` 内置模块），加依赖会让「双击 `启动管理面板.cmd` 就能用」失效，也会和 pnpm 严格依赖树冲突 | 面板代码只用 `node:fs`/`node:path`/`node:http`/`node:crypto`/`node:child_process` 等内置模块；需要复杂能力就调用仓库已有脚本（如 `scripts/compress-music.mjs`） |

### 1.5 绝对禁止清单（浓缩版，详见第 2.4 节）

- 不要改 `dist/`、`.astro/`、`node_modules/`、`public/vndb-covers/`、`admin-backups/`、`logs/`（要么是产物，要么是本地状态，要么被 gitignore）。
- 不要手改 `src/constants/lqips.json`（除非跑 `pnpm lqips`）。
- 不要动 `public/vendor/giscus-1.6.0.mjs`（除非按第 1.4 节第 4 条的升级流程整包替换）。
- 不要在 `admin/` 里加依赖。
- 不要用 `git add -A` / `git add .` / `git commit -a`。
- 不要改 `public/_headers` 或 `public/_redirects` 并期待它生效 —— `run_worker_first: true` 之后它们**不作用于 Worker 处理的响应**（`public/_headers:3-5` 自己就这么写）。真正生效的是 `worker/index.mjs:23-32`。
- 不要在 `worker/index.mjs` 里改 CSP 之外的地方而不读第 5 章（301、Range、安全头是一个整体，改动顺序有依赖）。

> 🔴 **新增 / 删除网站功能前，先读 [附录 E「新增功能时的同步契约（防漂移）」](#附录-e新增功能时的同步契约防漂移)**：任何新功能都可能要同时改**代码 / 管理面板 / 文档**三处，附录 E 有「加什么 → 必须同步哪里」对照表。改完跑 `pnpm check-docs`（= `node scripts/check-docs-sync.mjs`，零依赖、只读），它会用代码里的事实核对文档里的数字与清单；对不上就退出码 1。

---

## 2. 技术栈与目录地图

### 2.1 这一章解决什么问题

回答「这个文件能不能改」。仓库里混着三种来源的文件：**上游主题自带**、**本仓库作者自建**、**内容与配置**。分不清就会踩上游 diff 冲突，或者把该改的地方当成禁区。

### 2.2 三类文件（⭐ 最重要的一张表）

| 类别 | 判断依据 | 代表路径 | 改动策略 |
| --- | --- | --- | --- |
| ① **上游 Firefly/Fuwari 主题文件** | 在初始提交 `862d5c6`（`chore: 基于 Firefly 主题的个人博客（初始提交）`）里就存在，且本仓库后续没有为它建独立模块 | `src/layouts/`、`src/components/`、`src/pages/`、`src/plugins/`、`src/i18n/`、`src/utils/`（大部分）、`src/styles/`（大部分）、`src/types/`（大部分）、`astro.config.mjs`、`biome.json`、`tsconfig.json`、`postcss.config.mjs`、`svelte.config.js`、`vercel.json`、`AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`_frontmatter.json`、`CREDITS.md`、`LICENSE`、`UPSTREAM-README.md`、`README.en.md` | 尽量别动。必须动时：小步、单一目的、在提交说明里写清「为什么上游实现不够用」。改完必须过第 11 章三条门禁。**`AGENTS.md` / `CLAUDE.md` 是上游文件，内容与现状的出入已在 `AGENTS.md`/`CLAUDE.md` 中就地标注「本仓库修正」（2026-10-11），逐条差异见 2.5 节** |
| ② **本仓库自建** | 初始提交之后新增（`git log --diff-filter=A 862d5c6..HEAD` 可复现） | `worker/index.mjs`；`admin/`（18 个文件，含 `README.md`）；`admin-launcher/`（单窗口启动器源码，exe 是构建产物）；`scripts/compress-music.mjs`、`scripts/quarantine-bad-posts.mjs`；`public/vendor/giscus-1.6.0.mjs`；`public/friends/`（友链图标）；`public/pio/README.md`；`src/config/perfConfig.ts`；`src/config/{announcements,friends,music-playlist,nav-overrides}.json`；`src/styles/low-spec.css`；`src/types/navOverrides.ts`；`src/utils/announcement-utils.ts`；`重建依赖.cmd`；`启动管理面板.cmd`；`docs/`（本文档所在目录，新建）；`CREDITS.md`、`UPSTREAM-README.md`（作者整理的说明） | 这是本项目的「自有资产」，可以放心改。但仍要守第 11 章门禁、守零依赖约束（`admin/`、`admin-launcher/`） |
| ③ **内容与配置（日常改动区）** | 数据/配置类，改动不需要碰逻辑代码 | `src/content/posts/`（文章 + `images/`）、`src/content/spec/`、`src/content/dynamic/`、`src/content/projects/`；`src/config/`（除类型定义外的全部配置）；`public/assets/`（图片/音乐/字体）；`src/assets/`（走 Astro 优化管线的图） | **日常只改这里**。优先用管理面板（第 9 章），它自带快照 + 校验 + 回滚 |

> 复现方式（只读命令）：
> `git log --diff-filter=A --name-only --format="" 862d5c6..HEAD | Sort-Object -Unique`
> 上面第 ② 类就是从这条命令的结果里挑出来的（媒体文件与文章正文略去）。

### 2.3 带注释的目录树（只列会碰到的部分，全部实测存在）

```text
firefly/
├── admin/                      # ② 零依赖本地管理面板（18 个文件，只用 node: 内置模块）
│   ├── server.mjs              #    HTTP 服务 + 全部 /api 路由（2457 行）
│   ├── index.html              #    单页 UI（11 个页签，内联 JS/CSS，现代侧边栏外壳）
│   ├── README.md               #    面板完整用法（617 行）★ 改面板前必读
│   ├── publish-scope.mjs       #    发布范围白名单 PUBLISH_SCOPE（防 git add -A）
│   ├── settings.mjs            #    「站点设置」白名单表单（33 条 SETTINGS_DEFS）
│   ├── avatar.mjs              #    站点头像：魔数校验 + 可选缩放 → 写新文件并改 profileConfig.avatar
│   ├── announcement-draft.mjs  #    更新公告草稿：提交解析 / 分组 / 中文整理 / Markdown 转义（纯函数）
│   ├── nav.mjs                 #    导航隐藏/改名/排序 → 只写 nav-overrides.json
│   ├── doctor.mjs              #    体检 10 项（只读；其中 2 项查文章 frontmatter，见 9.11）
│   ├── content-check.mjs       #    文章 frontmatter 两层校验：YAML 速查（秒级）+ 真实 astro build（权威）
│   ├── post-frontmatter.mjs    #    保存文章时的 frontmatter 读写共用模型（外科式改写，见 9.12）★ 日期引号事故的根修
│   ├── backups.mjs             #    写前快照 admin-backups/（默认保留最新 40 份，面板可调）
│   ├── ci.mjs                  #    GitHub Actions 状态（60s 缓存 / 8s 超时 / 限流识别）
│   ├── zip.mjs                 #    快照导出 ZIP（store 模式）
│   ├── media-compress.mjs      #    批量转 WebP（只新增，不删原图）
│   ├── import-doc.mjs          #    .docx/.txt/.md → Markdown
│   ├── audio-meta.mjs          #    从 mp3/flac/m4a 读封面与歌词
│   └── friends.mjs             #    友链 CRUD + 「从网址抓取」（含 SSRF 防护）
├── admin-launcher/            # ② 单窗口桌面启动器（C# 5 / .NET Framework，零第三方依赖）
│   ├── FireflyAdminLauncher.cs #    隐藏 node + Chrome/Edge --app 窗口 + 日志 + 在线重启（716 行）
│   ├── build.cmd              #    csc 编译到根目录 firefly-admin.exe（exe 被 gitignore）
│   ├── app.ico                #    exe 图标（/win32icon 嵌入）
│   ├── app.manifest           #    asInvoker + 视觉样式
│   └── README.md              #    使用 / 构建 / 自检 / 排查
├── worker/
│   └── index.mjs               # ② Cloudflare Worker 入口（222 行，6 项职责）★ 第 5 章
├── public/                     # 原样拷贝进 dist/ 的静态文件
│   ├── _headers                # ① 上游文件 + 作者注释：run_worker_first 后**已不生效**，只是文档
│   ├── _redirects              # ① 同上，已不生效
│   ├── vendor/giscus-1.6.0.mjs # ② 自托管 giscus（25 KB，文件名带版本号 → 1 年 immutable）
│   ├── friends/                # ② 友链图标（24 个站点的图标，自托管）
│   ├── assets/{images,music,fonts,css,js}/   # ③ 站点图片 / 音乐 / 字体
│   ├── assets/music/{cover,lrc}/             # ③ 封面（48 个）与歌词（20 个）
│   ├── favicon/、gallery/、pio/、.well-known/security.txt
│   └── anime-list.json
├── src/
│   ├── content.config.ts       # ① 内容集合 schema（第 3 章的唯一依据）
│   ├── config/                 # ③ 配置区（33 个文件：23 个 *Config.ts + backgroundWallpaper.ts
│   │                           #    + index.ts + README.md + FooterConfig.html + 4 个 JSON）★ 第 4 章
│   ├── content/                # ③ 内容：posts/（5 篇 + images/）、spec/（4 个页面）、dynamic/、projects/
│   ├── layouts/                # ① Layout.astro（HTML 外壳）、MainGridLayout.astro（栅格）
│   ├── components/             # ① 组件（comment/Giscus.astro 是唯一被本地化改造过的热点；② features/PostSearch.svelte 文章内搜索）
│   ├── pages/                  # ① 文件路由（33 个文件；`/` 与 `/page/N/` 由 [...page].astro 提供）
│   ├── styles/                 # ① 全局样式；② low-spec.css 是自建
│   ├── utils/                  # ① 工具；② announcement-utils.ts 是自建
│   ├── types/                  # ① 类型；② navOverrides.ts 是自建
│   └── constants/              # ①+生成物：lqips.json（pnpm lqips 生成）、icons-data.json（Biome 忽略）
├── scripts/                    # ① 构建脚本 + ② compress-music.mjs / quarantine-bad-posts.mjs
├── .github/workflows/deploy.yml # ① CI：push main → build → wrangler deploy ★ 第 8 章
├── wrangler.jsonc              # ② Worker 部署配置（27 行）★ 第 5.3 节
├── README.md                   # ② 用户向文档（1069 行 / 13 章）
├── AGENTS.md / CLAUDE.md       # ① 上游给 AI 的说明（有陈旧内容，见 2.5）
├── 重建依赖.cmd / 启动管理面板.cmd  # ② Windows 双击脚本（GBK 编码！）
├── package.json / pnpm-lock.yaml / pnpm-workspace.yaml / tsconfig.json / biome.json
├── pagefind.yml / postcss.config.mjs / svelte.config.js / vercel.json / .npmrc
├── .gitignore                  # 忽略 dist/、.astro/、node_modules/、logs/、admin-backups/ 等
└── docs/PROJECT-CONTEXT.md     # ② 本文档
```

> 编码注意：`重建依赖.cmd` 与 `启动管理面板.cmd` 是 **GBK（代码页 936）**，用 UTF-8 读会失败（`read` 工具会直接报 `invalid UTF-8 text`）。读取方式：`node -e "console.log(new TextDecoder('gbk').decode(require('fs').readFileSync('重建依赖.cmd')))"`。
>
> 文章内搜索：`src/components/features/PostSearch.svelte` 挂在文章页正文前，只搜 `#post-container .markdown-content`（不搜导航/评论/目录）；用 CSS Custom Highlight API 给 Range 上色，**不改文章 DOM**，所以不会破坏 Shiki / KaTeX；非加密文章显示，Enter 跳到第一个/下一个、Shift+Enter 上一个、Esc 清除；旧浏览器退化为「当前匹配外框」但仍可计数与跳转。

### 2.4 分目录红线

| 路径 | 允许的操作 | 禁止的操作 |
| --- | --- | --- |
| `dist/` | `pnpm build` 生成、`pnpm preview` 预览 | 手工编辑、提交（`.gitignore:2` 已忽略） |
| `src/content/posts/` | 用面板「文章」页或直接写 `.md` | 放非 `.md`/`.mdx` 的正文（loader 只认这两种） |
| `src/config/*.ts` | 通过面板「站点设置」（白名单字段）或「配置」页编辑器 | 用脚本批量正则改写（会把结构改坏；面板有 `countStructure` 保护，手工没有） |
| `src/config/*.json` | 面板写入，或手工编辑（保持 JSON 合法 + tab 缩进 + 末尾换行） | 改 `friends.json` 的字段名（`friendsConfig.ts:9` 直接当类型用） |
| `src/config/nav-overrides.json` | 面板「站点设置 → 导航菜单」写入 | 想「新增菜单项」改这里（无效）；新增要改 `navBarConfig.ts` 的数组（`admin/nav.mjs:11-12,99`） |
| `public/vendor/` | 整包替换 + 同步改 import 路径 | 原地修改同名文件（immutable 缓存） |
| `public/friends/` | 手工放图标（面板**不能**上传到这个目录） | 通过面板上传/删除（`server.mjs:124` 只把它放进**只读**白名单） |
| `admin/` | 修改既有 `.mjs`（保持零依赖） | 新增 npm 依赖、改动 `/api/*` 路由却不更新 `POST_BODY_FIELDS`（见 9.2 节） |
| `src/constants/lqips.json` | `pnpm lqips` 重新生成 | 手改（会被下次生成覆盖） |
| `admin-backups/`、`logs/` | 让面板/脚本自己写 | 提交（`.gitignore:20,23`） |
| `AGENTS.md` | 仅在最前面追加指针段落（本次任务就是这么做的） | 改动其余内容（它属于上游文件） |

### 2.5 上游 AI 说明文件的陈旧之处（别照抄）

`AGENTS.md`（34 行）与 `CLAUDE.md`（98 行）是**上游主题**的文件，本仓库沿用未改。实测与现状不符的地方：

| 上游写法 | 实际 | 依据 |
| --- | --- | --- |
| AGENTS.md：「`pnpm type-check`: run TypeScript with `--noEmit`」 | 实际是 `tsc --noEmit --isolatedDeclarations` | `package.json:16`、`CLAUDE.md:17` |
| AGENTS.md：「`pnpm build`: generate **icons**, LQIPs, ...」 | build 第一步是 `generate-github-card-data.ts`，**没有** generate icons 这一步 | `package.json:13` |
| AGENTS.md / CLAUDE.md：「docs in `docs` and `Firefly-Docs`」 | `docs/` 本次才建；`Firefly-Docs/` 与 `Firefly-docs/` **都不存在**（`.gitignore:43` 里有 `Firefly-docs/`） | 实测 `Test-Path` 均为 False |
| CLAUDE.md：「Deployment: **Vercel**（default）、Cloudflare Workers（set `CF_WORKERS` env var）」 | 实际部署是 **Cloudflare Workers**，由 GitHub Actions 触发；`vercel.json` 只是上游遗留 | `.github/workflows/deploy.yml`、`wrangler.jsonc` |
| CLAUDE.md：`pnpm lint`/`format` 只针对 `./src` | 实际是 `./src ./scripts` | `package.json:22-23` |
| CLAUDE.md 说背景视频「媒体」相关配置 | 背景视频与远程随机壁纸**已关闭**（`backgroundWallpaper.ts:8`、`coverImageConfig.ts:32`） | 提交 `588d320`、`2bf015b` |

> 结论：**以本仓库代码 + 本文档为准，`AGENTS.md`/`CLAUDE.md` 只当上游背景资料读。**

---

## 3. 内容与写作

### 3.1 这一章解决什么问题

写文章 / 加图片 / 导入 Word 时，**以哪个文件为准**、字段写错会怎样、为什么不能直接塞 `.docx`。用户向的完整教程见 `README.md` 第 6 章；这里只写 agent 必须知道的约束与坑。

### 3.2 唯一权威：`src/content.config.ts`

四个集合与它们的 loader（`src/content.config.ts:62-131`）：

| 集合 | loader 目录 | 文件类型 | 必填字段 |
| --- | --- | --- | --- |
| `posts` | `src/content/posts` | `.md` / `.mdx` | `title`、`published` |
| `spec` | `src/content/spec` | `.md` / `.mdx` | **无**（`schema: z.object({})`，`content.config.ts:96`） |
| `dynamic` | `src/content/dynamic` | **只认 `.md`**（`content.config.ts:100`） | `published` |
| `projects` | `src/content/projects` | `.md` / `.mdx` | `title`、`published` |

当前内容实况（实测）：`posts/` 5 篇（`deploy-to-cloudflare.md`、`hello-world.md`、`markdown-cheatsheet.md`、`vmware-workstation-pro-26h1u1.md`、`common-file-formats.md`）+ `images/`；`spec/` 4 个（`about.md`、`announcement.md`、`friends.mdx`、`guestbook.md`）；`dynamic/`、`projects/` 为空目录。

### 3.3 `posts` frontmatter 全字段（逐个核对 `src/content.config.ts:64-90`）

| # | 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | `title` | `string` | **是** | — | 标题 |
| 2 | `published` | `date` | **是** | — | 发布日；写 `YYYY-MM-DD` |
| 3 | `updated` | `date` | 否 | 无 | 更新日；配合 `siteConfig.post.showLastModified` |
| 4 | `draft` | `boolean` | 否 | `false` | 草稿 |
| 5 | `description` | `string` | 否 | `""` | 摘要（列表 / 搜索 / OG） |
| 6 | `image` | `string` | 否 | `""` | 封面路径；填 `"api"` 才走随机封面 API（当前 `coverImageConfig.randomCoverImage.enable: false`，所以 `"api"` 现在无效） |
| 7 | `tags` | `string[]` | 否 | `[]` | 标签 |
| 8 | `category` | `string \| null` | 否 | `""` | 分类（schema 允许 `null`） |
| 9 | `lang` | `string` | 否 | `""` | 单篇语言覆盖 |
| 10 | `pinned` | `boolean` | 否 | `false` | 置顶 |
| 11 | `author` | `string` | 否 | `""` | 作者覆盖（默认 `profileConfig.name`） |
| 12 | `sourceLink` | `string` | 否 | `""` | 转载来源 |
| 13 | `licenseName` | `string` | 否 | `""` | 单篇许可名 |
| 14 | `licenseUrl` | `string` | 否 | `""` | 单篇许可链接 |
| 15 | `comment` | `boolean` | 否 | **`true`** | 单篇评论开关（默认开） |
| 16 | `password` | `string` | 否 | `""` | 非空 = 正文加密 |
| 17 | `passwordHint` | `string` | 否 | `""` | 密码提示 |
| 18 | `series` | `string` | 否 | `""` | 系列名 |
| 19 | `seriesOrder` | `number` | 否 | 无 | 系列内序 |
| 20 | `prevTitle` | `string` | 否（内部） | `""` | 上一篇标题，工具写 |
| 21 | `prevSlug` | `string` | 否（内部） | `""` | 上一篇 slug |
| 22 | `nextTitle` | `string` | 否（内部） | `""` | 下一篇标题 |
| 23 | `nextSlug` | `string` | 否（内部） | `""` | 下一篇 slug |

另外两个集合（同样以 `content.config.ts` 为准）：

| 集合 | 字段 | 类型 | 默认值 |
| --- | --- | --- | --- |
| `dynamic`（`:101-105`） | `published` / `pinned` / `location` | `date` / `boolean` / `string` | 必填 / `false` / `""` |
| `projects`（`:110-130`） | `title` / `published` / `draft` / `order` / `description` / `image` / `tags` / `link[]` / `status` / `lang` | — | `link[]` 每项为 `{label(必填), icon(""), value(必填)}`；`order` 无默认 |

**写错字段名的后果**：Astro 内容集合的 schema 是 `z.object({...})`（非 `.strict()`），多写的字段**会被静默忽略**，不会报错 —— 这就是下面 `slug` 坑的成因；但**类型写错**（如 `pinned: "yes"`）会让 `astro build` 直接失败。

### 3.4 文章 URL 由文件路径决定

- loader 是 `glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" })`（`content.config.ts:63`），路由是 `src/pages/posts/[...slug].astro`，用 `entry.id` 去掉扩展名。
- 所以 `src/content/posts/hello-world.md` → `/posts/hello-world/`；子目录 `posts/a/b.md` → `/posts/a/b/`。
- 重命名文件 = 改 URL = 旧链接失效（`worker/index.mjs` 只处理 `/blog/*` 的历史跳转，见第 5 章）。

### 3.5 图片的四种放法（依据 + 推荐）

| 放法 | 引用写法 | 是否走 Astro 优化 | 依据 | 何时用 |
| --- | --- | --- | --- | --- |
| ① `public/`（站点级） | `/assets/images/foo.webp`（**以 `/` 开头**） | ❌ 不优化，原样拷贝 | `profileConfig.ts:6`、`siteConfig.ts:102`，`public/` 会整体进 `dist/` | 头像、logo、打赏码、分享图、动图（GIF/动态 WebP 必须走这里，见 ② 的注意） |
| ② `src/assets/`（走管线） | `assets/images/foo.avif`（**不以 `/` 开头**） | ✅ 自动转 WebP（`siteConfig.imageOptimization.formats: "webp"`，质量 85） | `profileConfig.ts:7`、`siteConfig.ts:103,327-344` | 文章封面、内容配图（体积敏感） |
| ③ 文章自己的 `images/` 目录 | `./images/foo.png`（**相对文章文件**） | ❌ | `admin/server.mjs:140`（`MEDIA_URL_PREFIX["post-images"] = "./images/"`）、`admin/README.md:130-133` | 面板上传的图片、Word 导入抽出的图片 |
| ④ 远程 URL | `https://.../foo.jpg` | ❌ | `siteConfig.ts:104` | 防盗链站点（已在 `noReferrerDomains` 里列了 `*.hdslb.com` 等，`siteConfig.ts:338-343`） |

⚠️ **动图红线**：`profileConfig.ts:9-10` 写明「动图必须放在 `public/` 并用 `/` 开头的路径，走 `src` 的优化管线会被转成静态图、动画就没了」。当前头像就是 `public/assets/images/avatar-zhi.webp`（动态 WebP）。

⚠️ **不要用 `d1`-`d6` / `m1`-`m6` 命名自己的壁纸**：`backgroundWallpaper.ts:17-19` 说明这些是主题示例图名，上游可能替换覆盖。

### 3.6 为什么「发布」必须是 md / mdx

三个硬约束，缺一不可：

1. `posts` 的 loader 是 `glob({ pattern: "**/*.{md,mdx}" })`（`content.config.ts:63`）——`.docx`/`.txt`/`.html` 根本不会被扫描成内容条目。
2. Astro 内容集合的正文需要 Markdown/MDX 解析器（`@astrojs/markdown-remark`、`@astrojs/mdx`，`package.json:31,33`），二进制格式没有对应 loader。
3. 站点大量功能挂在正文的 remark/rehype 插件上（KaTeX、Mermaid、PlantUML、代码块折叠…，`astro.config.mjs:164-358`），只有 md/mdx 能进这条管线。

**所以**：Word/txt 只能「先转 Markdown 再当文章」，这正是第 3.7 节那个导入功能的定位。

### 3.7 Word / txt / md 导入（面板「文章」页）

| 项 | 事实 | 依据 |
| --- | --- | --- |
| 入口 | 「文章」页编辑器上方「从 Word / txt 导入」 | `admin/README.md:59` |
| 支持 | `.docx`（自己读 ZIP + `inflateRawSync`）、`.txt`/`.text`、`.md`/`.markdown` | `admin/import-doc.mjs:1011` 导出 `MAX_IMPORT_BYTES`；`admin/README.md:114-120` |
| 不支持 | 旧版 `.doc`（二进制）、其它扩展名 | 同上 |
| 体积上限 | **25 MB**（前端拦一次，后端 `MAX_IMPORT_BYTES` 再拦一次，`admin/import-doc.mjs:17`、`server.mjs:2219-2230`） | 实测 |
| 编码 | UTF-8 严格模式 → 失败或含 `\uFFFD` 时退回 **GBK**，并写 `warnings` | `admin/README.md:123` |
| 图片落盘 | `src/content/posts/images/<slug>-imgN.ext`，同名往后加序号，**绝不覆盖**；后端先校验目录必须是 `src/content/posts/images` | `server.mjs:2233-2242` |
| 是否自动保存 | **不自动保存**。接口只做「转 Markdown + 图片落盘」，正文回填编辑器由人确认后再点保存 | `server.mjs:2203-2209`、`admin/README.md:151-159` |
| 认证 | 与其它接口一致（Cookie / `X-Admin-Token` / `?token=` 任一），非 POST 返回 405 | `server.mjs:2206-2209` |

### 3.8 `pnpm new-post` 模板里的 `slug` 字段（一定会困惑的点）

- `scripts/new-post.js:82-93` 生成的模板包含 `slug: <拼音>`（第 91 行），其中中文文件名会被转成拼音（`scripts/new-post.js:41-69`，依赖 `pinyin-pro`）。
- **`posts` schema 里没有 `slug` 字段**（`src/content.config.ts:64-90` 全字段见 3.3 节）→ 多写的字段被 `z.object` 静默忽略。
- 真正决定 URL 的是**文件路径**（3.4 节）。想让 URL 用拼音，就在建文件时用拼音文件名：`pnpm new-post 我的第一篇` → 生成 `src/content/posts/wo-de-di-yi-pian.md`。
- 同时注意模板的 `title: ${args[0]}`（`new-post.js:83`）**没加引号**：标题里带 `:`、`#`、`{` 等字符会写出非法 YAML，必须手工修。

### 3.9 内容相关的高危操作

| 操作 | 风险 | 安全做法 |
| --- | --- | --- |
| 用脚本批量改 frontmatter | 破坏 YAML → 构建失败 | 改前 `pnpm type-check && pnpm build`；或走面板（`/api/save-post` 会 `snapshotBefore`，`server.mjs:1766`；且保存时不再重写整份 frontmatter，见 9.12） |
| 直接删文章文件 | 无快照、无回滚 | 面板「文章 → 删除」会先快照（`server.mjs:1793`） |
| 手工重命名文章 | URL 变了、封面相对路径可能失效 | 面板保存时传 `originalSlug` 会删旧文件（`server.mjs:1772-1774`），并**先校验 slug 正则**（`server.mjs:1753`，这是 `M2` 修的越界删文件漏洞，见第 12 章） |
| 手工改 `friends.json`/`announcements.json`/`music-playlist.json` | 结构错 → 面板/构建报错 | 优选面板接口；改完跑面板「体检」（`admin/doctor.mjs` 会查引用与必填字段） |

---

## 4. 配置地图（`src/config` 全量）

### 4.1 这一章解决什么问题

`src/config/` 到底有多少个文件、各自管什么、**哪些已经被管理面板接管**（不用手改）、改错了会怎样。父任务里说「14 个 `src/config` 文件」，实测口径如下（下面给出三个真实数字，避免对不上）：

| 口径 | 数量 | 清单 |
| --- | --- | --- |
| `*Config.ts` | **24** | analytics, announcement, booknav, comment, coverImage, displaySettings, dynamic, effects, expressiveCode, font, friends, gallery, license, mermaid, music, navBar, perf, pio, plantuml, profile, sidebar, site, sponsor |
| 目录下全部 `.ts` | **26** | 上面 23 个 + `backgroundWallpaper.ts`（壁纸，不以 Config 结尾）+ `index.ts`（统一导出，`src/config/index.ts:58-89`） |
| 目录下全部文件 | **33** | 上面 25 个 + `README.md` + `FooterConfig.html` + `announcements.json`、`friends.json`、`music-playlist.json`、`nav-overrides.json` |
| 面板「配置」页可编辑白名单 | **15** | `admin/server.mjs:86-111` 的 `CONFIG_FILES` |
| 面板「站点设置」可视化字段 | **33 条 def，落在 5 个文件** | `admin/settings.mjs:25-68` |
| 面板管理的 JSON 数据 | **3 + 1** | `announcements.json`、`music-playlist.json`（`server.mjs:206-209` 的 `DATA_FILES`）+ `friends.json`（`admin/friends.mjs`）+ `nav-overrides.json`（`admin/nav.mjs`） |

> `index.ts` 只做统一导出与 `navbarMode` 解析（`src/config/index.ts:8-17`），**没有**导出 `perfConfig`：`perfConfig` 由 `src/layouts/Layout.astro:51` 直接 import。改动 `index.ts` 的导出集合会影响所有 `@/config` 引用点，属于高风险文件。

### 4.2 逐个文件的职责与风险

图例：**面板**栏里 ✅ = 面板可直接改（不用手改 TS）；✏️ = 面板只改其中部分字段/数据；❌ = 只能手改。

| 文件 | 控制什么 | 关键字段（实测） | 改了会怎样 | 面板 |
| --- | --- | --- | --- | --- |
| `siteConfig.ts`（359 行） | 站点身份、主题色、宽度、列表布局、分页、文章页、各第三方（bilibili/bangumi/vndb/mal）、图片优化、RSS、页面开关 | `title/subtitle/site_url/description/keywords`（`:45-58`）、`themeColor.hue/defaultMode`（`:61-66`）、`pageWidth`（`:71`）、`contentWidth/contentWidthVw`（`:73-74`）、`navbar.*`（`:98-126`）、`siteStartDate`（`:129`）、`timezone`（`:133`）、`postListLayout.*`（`:155-211`）、`pagination.postsPerPage`（`:216`）、`post.*`（`:220-254`）、`imageOptimization.*`（`:327-344`）、`feed.contentMode`（`:351`）、`pages`（`:10-41` + `:358`） | 影响全站；`site_url` 改动必须**同时**改 `wrangler.jsonc:19-25` 与 `worker/index.mjs:16-17`（否则 canonical/RSS/301 目标不一致） | ✅ 14 个字段（`settings.mjs:26-39`）+ 11 个 `pages.*` 开关（动态从 `resolvePageToggles` 读取） |
| `backgroundWallpaper.ts`（209 行） | 壁纸模式、图片列表、主页横幅文案/链接、轮播、水波纹、渐变、导航栏毛玻璃、全屏模糊渐变 | `mode`（`:5`）、`playerEnable: false`（`:8`）、`src.desktop/mobile`（`:42-59`）、`common.homeText.*`（`:71-122`）、`common.carousel`（`:124-131`）、`common.waves.enable.{desktop,mobile}: false`（`:133-140`）、`banner.navbar.blur: 0`（`:169`）、`overlay.blur: 0`（`:179`）、`fullscreen.blurRamp.enable.{desktop,mobile}: false`（`:200-207`） | 性能相关字段都调过（第 12 章）；`playerEnable: true` 会重新引入视频 | ✅ 11 个字段（`settings.mjs:43-45,61-67`） |
| `profileConfig.ts` | 头像、名字、签名、社交链接 | `avatar`（`:14`）、`name: "栀海"`（`:17`）、`bio`（`:20`）、`links[]`（`:28-47`） | 名字会出现在页脚版权、文章作者、OG 卡片；`avatar` 除表单外还能在「站点设置 → 站点头像」直接上传更换（9.8 节） | ✅ 3 个字段（`settings.mjs:40-42`）+ 头像卡片（`/api/avatar`） |
| `displaySettingsConfig.ts`（72 行） | 视图设置面板（🎨）总开关与各切换项 | `enable: true`（`:24`）、`wallpaperModeSwitchable: false`（`:43`）、`overlaySwitchable`（`:62-66`） | **总开关开/关直接决定客户端 JS 体积**（见 4.3）；`wallpaperModeSwitchable: true` 让每页约 +33 KB JS（`settings.mjs:55` 的 label 原话） | ✅ 4 个字段（`settings.mjs:54-57`） |
| `perfConfig.ts`（21 行） | 低配模式总开关 | `lowSpec: true`（`:20`） | 见 4.3 与第 12 章；改为 `false` 会恢复毛玻璃与装饰动画 | ✅ 见 4.4：该缺陷已修（面板开关现名 `perf.spine`）（面板那个「性能 · Live2D」开关实际控制错了文件里的块） |
| `featureTourConfig.ts`（15 行） | 主页中间栏「功能导览」部件：开关、自动轮播、触摸滑动与分页内容（数据在 `feature-tour.json`） | `enable`（`:13-14`；**当前 `feature-tour.json` 里为 `false`，首页已关闭、不渲染该卡片**）、`autoplay.enable`（默认 false）、`swipe`；页面数据见 `src/config/feature-tour.json`（19 条功能，其中 14 条带 `href`） | `enable:false` 首页完全不渲染（产物里也没有标记）；`autoplay.enable:true` 会引入常驻 setTimeout 轮播（默认关闭，与低 GPU 占用方向一致）。**带 `href` 的条目**渲染成 `<a>`（可 Tab 聚焦、`:focus-visible` 有主题色描边），**无 `href` 的条目**是普通文本；`href` **必须是产物里真实存在、且当前页面开关下真的会渲染的地址** —— 目标页面被 `siteConfig.pages` 关掉时产物是 `/404/` 跳转 stub，绝不能当跳转目标。当前 14 个 `href` 全部经「dist 产物存在 + 锚点 id 存在」校验，未演示的能力（数学公式 / 图片灯箱 / Mermaid / PlantUML / 文章加密）宁可不可点 | ✏️ 数据是 JSON，可在面板「配置」页编辑 |
| `navBarConfig.ts`（426 行） | 导航菜单数组、搜索配置、`LinkPresets`、`applyNavOverrides` | `getDynamicNavBarConfig()`（菜单数组，`:17-130` 的 id/name）、`navBarSearchConfig`（`:133`）、`LinkPresets`（`:141-255`）、`navItemId`（`:268-276`）、`normalizeNavOverrides`（`:301-311`）、`applyNavOverrides`（`:401-421`）、导出（`:423-426`） | 新增菜单项**只能在这里改**；每项必须写显式 `id`，否则面板读不到（`admin/nav.mjs:28`） | ✏️ 只能隐藏/改名/排序（写 `nav-overrides.json`）；**不支持新增**（`admin/nav.mjs:11-12,99`） |
| `sidebarConfig.ts`（328 行） | 侧栏位置（left/right/both）、平板端选哪侧、左右组件列表与顺序 | `enable`（`:7`）、`position: "both"`（`:14`）、`tabletSidebar: "left"`（`:19`）、`hideSidebarOnPostPage`（`:22`）、`noSidebarContentWidth: 0.6`（`:25`）、`leftComponents[]`（`:36+`，含被关掉的 `announcement`） | 组件顺序 = 数组顺序（`top` 优先于 `sticky`） | ❌（「配置」页编辑器可整文编辑） |
| `commentConfig.ts` | 评论系统选择与五个后端配置 | `type: "giscus"`（`:5`）、`giscus.repo: "Zhi2007/my-blog"`（`:57`）、`repoId`（`:59`）、`categoryId`（`:63`） | ⚠️ giscus 的仓库 `Zhi2007/my-blog` **不是**本仓库（`Zhi2007/firefly-blog`）：评论存在 Discussions 里；改错 = 评论区空白 | ❌（配置页可编辑） |
| `musicConfig.ts` | 播放器入口、悬浮播放器、模式（meting/local）、音量、循环、歌词 | `showInNavbar: true`（`:14`）、`showInSidebar: false`（`:17`）、`floating.enable`（`:21`）、`mode: "local"`（`:26`）、`local.playlist`（`:58`，`import` 自 JSON） | `mode: "meting"` 会切到在线歌单（外链，受 CSP `connect-src https:` 约束） | ✏️ 歌单数据由「音乐」页写 `music-playlist.json` |
| `announcementConfig.ts` | 公告栏标题/可关闭/底部按钮 + 首访弹窗 | `items`（`:31`，`import` 自 JSON）、`modal.enable/storageKey/delayMs`（`:34-40`） | 弹窗版本号（`version`）变了访客会重新看到一次（`:13` 注释） | ✏️ 公告数据由「公告」页写 `announcements.json` |
| `friendsConfig.ts` | 友链数据 + 友链页配置 | `friendsConfig`（`:9`，`import` 自 JSON）、`friendsPageConfig`（`:12-27`）、`getEnabledFriends()`（`:30-38`） | `randomizeSort: true` 会让构建时随机排序、忽略 `weight`（`:25`） | ✏️ 数据由「友链」页写 `friends.json` |
| `fontConfig.ts` | Astro Font API 字体定义 + 选择 + 本地字体子集化 | `fontsList`（`:29-84`，含 `fontsource` 与一个 `local` 示例）、`fontConfig.selected: ["system"]`（`:92`）、`bannerTitleFont`（`:97`）、`codeFont`（`:103`）、`subsetFonts`（`:107-112`） | 加字体 = 加构建时间与下载体积；`subsetFonts` 的 key 必须与 `cssVariable` 一致，否则 `scripts/subset-fonts.ts` 不处理 | ❌ |
| `coverImageConfig.ts` | 文章页封面显示方式 + 随机封面 API | `enableInPost: true`（`:22`）、`enableInPostOverlay: false`（`:25`）、`showLoading`（`:28`）、`randomCoverImage.enable: false`（`:32`）、`apis[3]`（`:34-38`，仍含 `t.alcy.cc` 等外链但**未启用**） | 打开随机封面会引入外部请求（受 CSP `img-src https:` 允许，但会拖慢首屏且不稳定） | ❌ |
| `analyticsConfig.ts` | GA / Clarity / Umami / 51la / **Cloudflare Web Analytics** | 前四个 ID 全为空；`cloudflareWebAnalytics.token: "67aa…"`（`:52`） | 这个 token 与 CSP 里的 `static.cloudflareinsights.com` 是配套的（`worker/index.mjs:31`） | ❌ |
| `pioConfig.ts`（187 行） | 看板娘：Spine 与 Live2D | `spineModelConfig.enable: false`（`:6`）、`live2dWidgetConfig.enable: false`（`:88`） | 两者都关 = `scripts/prune-pio-assets.ts` 会从 `dist/` 删掉整个 `pio`（约 15 MiB，`CLAUDE.md:91`）。打开 Live2D 会重新引入 651 KB 脚本 + 常驻动画（第 12 章） | ⚠️ 见 4.4 |
| `effectsConfig.ts` | 樱花、侧栏时间进度、标签页标题轮播 | `sakuraConfig.enable: false`（`:11`）、`timeProgressConfig.enable: true`（`:64`）、`tabTitleConfig.enable: true`（`:77`） | 樱花是 Web Worker + 无限动画（CSP `worker-src 'self' blob:` 就是为它放的） | ✏️ 樱花开关在设置面板里对访客可见（`displaySettingsConfig.sakuraSwitchable`） |
| `expressiveCodeConfig.ts` | 代码块主题、折叠、语言徽章/Logo | `darkTheme: "one-dark-pro"`（`:11`）、`lightTheme: "one-light"`（`:14`）、`pluginCollapsible`（`:20-25`）、`pluginLanguageBadge.enable: true`（`:30`）、`pluginLanguageLogo.enable: false`（`:36`） | 改主题要重启 dev server（`:6` 注释）；`pluginLanguageLogo` 打开会显著加 CSS | ❌ |
| `mermaidConfig.ts` | Mermaid 明暗主题（构建时渲染成静态 SVG） | `lightTheme: "editor-light"`（`:16`）、`darkTheme: "editor-dark"`（`:22`） | 构建期渲染，改完要重新构建才生效 | ❌ |
| `plantumlConfig.ts` | PlantUML 开关、服务器、明暗主题 | `enable: true`（`:17`）、`server: "https://www.plantuml.com/plantuml"`（`:24`）、`darkTheme: "cyborg"`（`:36`） | 内容会发到公共服务器（`:22` 注释提醒敏感内容自建） | ❌ |
| `licenseConfig.ts` | 文章顶部许可信息 | `enable: true`（`:5`）、`name: "CC BY-NC-SA 4.0"`（`:8`）、`icon`（`:23`，留空按名称自动匹配） | 只影响展示 | ❌ |
| `galleryConfig.ts` | 相册列表 + 瀑布流列宽 | `albums[2]`（`:6-37`，含一个密码相册 `123456`）、`columnWidth: 240`（`:41`） | 相册页由 `pages.gallery` 开关控制，当前为 `false`（`siteConfig.ts:25`），页面不生成 | ❌ |
| `dynamicConfig.ts` | 动态页标题/评论/每页条数/数据源 | `itemsPerPage: 20`（`:17`）、`apiUrl: "/api/dynamic.json"`（`:23`）、`memos.enable: false`（`:30`） | 页面开关 `pages.dynamic: false`（`siteConfig.ts:21`），当前不生成页面 | ❌ |
| `booknavConfig.ts`（156 行） | 书签导航分组与条目 + favicon 接口 | `booknavPageConfig.favicon.api`（`:20`）、`booknavConfig[]`（`:26-155`） | 页面开关 `pages.booknav: false`（`siteConfig.ts:27`）；favicon 走第三方 `a.favicon.im`（受 CSP `img-src https:`） | ❌ |
| `sponsorConfig.ts` | 打赏方式与打赏者列表 | `showButtonInPost: false`（`:21`）、四种 `enabled: false`（`:32,40,48,56`）、`sponsors[]` 示例数据（`:61-78`） | 页面开关 `pages.sponsor: false`（`siteConfig.ts:40`） | ❌ |
| `index.ts` | 统一导出 + `navbarMode` 解析 | `resolveNavbarMode`（`:8-14`）、`navbarMode`（`:17`）、类型导出（`:20-57`）、配置导出（`:58-89`） | 增删导出会影响所有 `@/config` 引用点 | ❌ |

### 4.3 已知取舍（必须知道，否则会「优化」出退化）

| 取舍 | 事实 | 依据 |
| --- | --- | --- |
| `displaySettingsConfig.enable` 的 JS 体积代价 | 打开 = 设置面板组件及其依赖（各设置项逻辑、图标）进客户端产物，构建体积变大、首屏多一份 JS；关闭 = 完全不渲染面板、体积更小 | `displaySettingsConfig.ts:14-16` 注释原文 |
| 其中「壁纸模式切换」是体积大头 | 为支持运行时切换，构建期要把各壁纸模式的整套内容打进产物，**约 +33 KB/页**，因此已关（`wallpaperModeSwitchable: false`） | `displaySettingsConfig.ts:17-18`、`settings.mjs:55` |
| 环境变量可覆盖总开关 | `PUBLIC_DISPLAY_SETTINGS=true/1/on/yes/enable/enabled` 开启，`false/0/off/no/disable/disabled` 关闭；**环境变量优先于配置文件**；取值无法识别则用文件里的值 | `src/utils/display-settings-utils.ts:7-8,53-58` |
| 页面开关也有环境变量覆盖 | `PUBLIC_PAGES_<KEY>`（KEY 为大写的 `pages` 键名），优先于 `siteConfig.pages.<KEY>` | `src/utils/page-toggle-utils.ts:18-44` |
| `nav-overrides.json` 的能力边界 | 只能 **隐藏 / 改名 / 排序**。`applyNavOverrides` 处理顺序：先 `hidden` → 再 `order` → 最后 `renamed`（改名不影响 id）；三个字段全空时**原样返回同一对象引用**（= 完全不影响现有行为） | `navBarConfig.ts:401-421`、`admin/nav.mjs:4-12` |
| **新增菜单项必须改 `navBarConfig.ts`** | 面板提交的 id 集合必须与配置完全一致，多了就 400：「未知菜单项 id…（面板不支持新增菜单项，请改 navBarConfig.ts）」；新增时要在 `getDynamicNavBarConfig()` 里加项并**显式写 `id`** | `admin/nav.mjs:94-100`、`navBarConfig.ts:17-130` |
| 低配模式为什么必须「移除属性」 | 见第 12 章第 12.4 节（`backdrop-filter` 存在即生成合成层，把模糊设 0 无效） | `src/styles/low-spec.css:4-8`、`perfConfig.ts:4-6` |
| 内容宽度用 `min(px, vw)` 且兜底不用 `min()` | 见第 12 章第 12.3 节（压缩器会简化成裸 `vw` 丢上限） | `src/layouts/Layout.astro:493-494`、`src/styles/variables.styl:170` |

### 4.4 ✅ 已修：`perf.live2d` 面板开关曾指向错误的配置块（现为 `perf.spine`）

> **状态：2026-10-11 已修复**。`admin/settings.mjs` 已把该 def 改名为 `perf.spine`、`within: "spineModelConfig"`（名实相符）。
> `live2dWidgetConfig` 方案被放弃的原因：`findBlock` 的正则 `\b[^{}]*?\{` 会跨行匹配到过宽区间（块内出现 2 处 `enable`），
> 写入器以「无法确定改哪一处」拒绝，因此**不再提供误导性开关**；Live2D 只能直接改 `src/config/pioConfig.ts` 的 `live2dWidgetConfig.enable`
> （当前为 false，配合 `prune-pio-assets.ts` 去掉 651KB 脚本与常驻动画）。
> 下面保留当初的实测记录，作为「名字对不上行为」这类语义漂移的教材。

| 项 | 内容 |
| --- | --- |
| 现象 | 面板「站点设置」里有一项 `perf.live2d`，label 是「性能 · Live2D 看板娘（关掉省 651KB 且去掉常驻动画）」，`file: "src/config/pioConfig.ts"`、`key: "enable"`、`within: "pioConfig"`（`admin/settings.mjs:60`） |
| 核实方式 | 把 `admin/settings.mjs:153-182` 的 `findBlock` 逐字复制后运行：`findBlock(pioConfig.ts, "pioConfig")` 与 `findBlock(pioConfig.ts, "spineModelConfig")` 返回**同一区间** `[146,1281]` |
| 原因 | `pioConfig.ts` 里根本没有名为 `pioConfig` 的块；正则 `\b pioConfig \b [^{}]*? \{` 先命中第 1 行 import 语句里的 `"../types/pioConfig"`，再吃到它之后第一个 `{` —— 也就是 `spineModelConfig` 对象的 `{`（`pioConfig.ts:4`） |
| 后果 | 该开关读写的其实是 `spineModelConfig.enable`（`pioConfig.ts:6`），**不是** `live2dWidgetConfig.enable`（`pioConfig.ts:88`）。也就是说：想用面板关 Live2D，实际改的是 Spine；Live2D 是否加载仍只由 `pioConfig.ts:88` 决定 |
| 当前无感知的原因 | 两者现在都是 `false`（`readSettings` 实测 `perf.live2d = false`），所以表现上看不出差异 |
| 建议修法（**已实施**：改名 `perf.spine`；`live2dWidgetConfig` 方案因写入器拒绝而放弃） | 把 `within: "pioConfig"` 改成 `within: "live2dWidgetConfig"`；或拆成两条 def（`live2d` + `spine`）。改完必须复测：`readSettings` 返回的 `perf.live2d` 应与 `live2dWidgetConfig.enable` 同步变化，且 `applySettings` 写回后 `pioConfig.ts` 只动了第 88 行 |
| 状态 | 本次**未修改**（任务限定只交付文档），仅作为「读代码时发现的缺陷」记录 |

---

## 5. 运行时架构（Cloudflare Worker）

### 5.1 这一章解决什么问题

线上**真正的入口是 Worker，不是静态资源**。不知道这一点，就会去改 `public/_headers`、`_redirects` 或指望平台自动处理 Range，然后发现「改了没用」。

### 5.2 Worker 的 6 项职责（`worker/index.mjs`，222 行）

| # | 职责 | 实现位置 | 细节 |
| --- | --- | --- | --- |
| 1 | **裸域 301 → 主域** | `worker/index.mjs:40-47` | `url.hostname === APEX_HOST`（`zhihaisblog.top`）时 301 到 `CANONICAL_HOST`（`www.zhihaisblog.top`），**保留路径与查询串**，并强制 `https:`；返回值也过 `withSecurityHeaders`（301 一样要带 HSTS/CSP） |
| 2 | **legacy `/blog/*` 301（大小写不敏感）** | `worker/index.mjs:50-56, 84-90` | `/blog`、`/blog/` → `/archive/`；`/blog/<slug>` → `/posts/<slug>`（slug 保留原始大小写）。`legacyRedirect()` 先 `toLowerCase()` 再判断，所以 `/Blog/x`、`/BLOG/x` 也能跳（这是 `L1` 修的） |
| 3 | **`/assets/music/*` 的 Range/206/304/HEAD/416/405** | `worker/index.mjs:59-61, 137-222` | 先不带 Range 取全量（`env.ASSETS.fetch`）→ 自己切片。`parseRange()`（`:199-222`）只接受单段 `bytes=`；语法非法 → 忽略该头返回 200；语法合法但越界 → `416` + `Content-Range: bytes */<total>`。ETag 命中 `If-None-Match` → `304`。非 GET/HEAD → `405` + `Allow: GET, HEAD` |
| 4 | **给所有响应补安全头** | `worker/index.mjs:23-32, 97-115` | `applySecurityHeaders()` 用 **`headers.set()` 覆盖**（不是 `append`）：上游若带了宽松 CSP，必须被换掉，绝不能出现两份同名头。`withSecurityHeaders()` 是所有出口的统一收口 |
| 5 | **缓存策略** | `worker/index.mjs:118-135, 158-161` | `/_astro/*` → `max-age=31536000, immutable`；`/vendor/*` → 同左；`/pagefind/*` → `max-age=604800`；媒体：音频 `86400` / 封面（路径含 `/cover/`）`604800` / 其它（歌词）`3600` |
| 6 | **异常兜底** | `worker/index.mjs:65-75` | `catch` 里先 `env.ASSETS.fetch(request)` 再补头；**再失败**才返回 `503` 纯文本「服务暂时不可用，请稍后重试。」（不回显内部错误）；`1940c1c` 起 503 不再泄漏内部细节 |

附带：`AUDIO_RE`（`:19`）与 `COVER_RE`（`:20`）决定媒体缓存档位；`MEDIA_PREFIX = "/assets/music/"`（`:18`）。

### 5.3 为什么必须用 Worker（三条不可替代）

| 需求 | 静态资源 / 配置文件为什么不行 | 依据 |
| --- | --- | --- |
| 音乐边下边播、拖进度条 | **Workers 静态资源不处理 `Range`**：实测 `Range: bytes=0-1023` 得到 `200` + 整个 11 MB 文件 | 提交 `bb0e122` 正文；`worker/index.mjs:4` 注释 |
| 裸域按域名 301 | `_redirects` **不支持按域名匹配**（DOMAIN 级跳转） | 提交 `749ffb5` 正文；`worker/index.mjs:5` |
| 所有响应补安全头 | `_headers` / `_redirects` **不作用于 Worker 处理的响应**；而 `run_worker_first: true` 之后所有响应都经 Worker | `public/_headers:3-5`（文件自己声明「本文件目前只是文档」）、`wrangler.jsonc:9-10` 注释 |

> 直接后果：`public/_headers` 与 `public/_redirects` **保留但无效**。改安全头只改 `worker/index.mjs:23-32`；两份 CSP 目前**逐字节一致**（实测都是 407 字符，见 6.4 节），但**只有 worker 那份生效**。

### 5.4 `wrangler.jsonc` 每个字段（27 行）

| 行 | 字段 | 值 | 含义 / 影响 |
| --- | --- | --- | --- |
| `:2` | `name` | `"my-blog"` | Worker 名称；决定 `*.workers.dev` 子域（旧地址 `my-blog.mc20070831.workers.dev` 仍可用，见 `wrangler.jsonc:16` 注释） |
| `:3` | `main` | `"worker/index.mjs"` | Worker 入口 |
| `:4` | `compatibility_date` | `"2025-01-01"` | 运行时兼容性基线。**不要随意前移**：会改变 Workers 运行时行为（`nodejs_compat` 语义、`Response` 行为等），必须整套复测 |
| `:5` | `compatibility_flags` | `["nodejs_compat"]` | 提供 Node 兼容 API。当前 worker 代码只用标准 Web API，但**不要删**（删了会影响 `wrangler` 的构建校验预期） |
| `:7` | `assets.directory` | `"./dist"` | 把 `pnpm build` 产物作为静态资源上传 |
| `:8` | `assets.binding` | `"ASSETS"` | Worker 里通过 `env.ASSETS.fetch(...)` 取资源（`worker/index.mjs:68,119,146` 都在用这个名字） |
| `:11` | `assets.run_worker_first` | `true` | **所有请求先过 Worker**（不是只过 `/assets/music/*`）。这是 301、安全头、缓存策略能生效的前提 |
| `:13` | `assets.not_found_handling` | `"404-page"` | 未知路径交给 `dist/404.html`；改回默认值会退回 Cloudflare 纯文本 404（`1940c1c` 加的） |
| `:17-21` | `routes[0]` | `zhihaisblog.top` + `custom_domain: true` | 裸域绑定；部署时自动建 DNS 记录并签发证书 |
| `:22-25` | `routes[1]` | `www.zhihaisblog.top` + `custom_domain: true` | 主域绑定 |
| `:9-10,15-16,26` | 注释 | — | 写明了「为什么不能靠 `_redirects`/`_headers`」「域名已托管在 CF，部署时自动建记录」 |

### 5.5 改 Worker 的正确姿势

1. 只改 `SECURITY_HEADERS`（`:23-32`）时：**必须同步改 `public/_headers:26-32`** 保持一致（虽然不生效，但两份不一致会让下一个 agent 误判哪份是真的）。改完用 6.4 节的办法比对两份字符串是否仍相同。
2. 加新的响应出口（新的 `return`）时：**必须经过 `withSecurityHeaders()`**，否则那条路径会裸奔 —— 这正是 `H1` 修的 4 条路径（裸域 301 / legacy 301 / 媒体非 2xx / 异常兜底）。
3. 改 `parseRange` 的语义前先读 `:79-83` 的注释：**刻意选择**「语法非法 → 忽略头返回 200」「语法合法但越界 → 416」，不是 bug。
4. 本地验证优先用 `pnpm exec wrangler dev`（需 `dist/` 已构建）；**不要**为了试 Worker 而提交 `dist/`。

---

## 6. Cloudflare 配置（以实测证据为准）

### 6.1 这一章解决什么问题

线上实际下发了什么头、缓存是什么状态、哪些东西在 Cloudflare 控制台里（仓库看不到、必须人工确认）。所有数字来自 `%TEMP%\project-evidence.json`（采集于 `2026-10-11T08:16:36.918Z`）与仓库文件。

### 6.2 实测证据总览

| 请求 | 结果 | 与仓库是否一致 |
| --- | --- | --- |
| `https://www.zhihaisblog.top/` | `200`，`server: cloudflare`，`cf-cache-status: HIT`，HTML 头齐全 | ✅ |
| 裸域 | `301`，`location: https://www.zhihaisblog.top/` | ✅ 与 `worker/index.mjs:40-47` 一致 |
| 旧地址 | `301`，`location: https://www.zhihaisblog.top/posts/hello` | ✅ 与 `worker/index.mjs:84-90` 一致（`/blog/<slug>` → `/posts/<slug>`） |
| 不存在的路径 | `404`，`cf-cache-status: MISS`，HTML 头齐全 | ✅ 与 `not_found_handling: "404-page"` 一致（返回 HTML 而非纯文本） |
| `/assets/music/all-eyes-on-me.mp3` + Range | `206`，`content-range: bytes 0-1023/3666939`，`accept-ranges: bytes`，`content-length: 1024`，`cache-control: public, max-age=86400`，`content-type: audio/mpeg` | ✅ 与 `worker/index.mjs:137-192,158-161` 一致；且仓库里该文件字节数**恰好也是 3666939**（实测 `Get-Item`），可交叉验证是同一个文件 |

**HTML 的 `cache-control`**：实测是 `public, max-age=0, must-revalidate`。`worker/index.mjs` **没有**设置 HTML 的 cache-control（只设 `/_astro/`、`/vendor/`、`/pagefind/`），所以这个值是 Cloudflare 静态资源默认行为产生的。即便如此首页仍 `cf-cache-status: HIT`，说明边缘确实缓存了 HTML 但要求每次回源校验。

### 6.3 DNS / NS（⚠️ 需确认）

| 项 | 结论 | 依据 / 为什么无法确认 |
| --- | --- | --- |
| DNS 是否托管在 Cloudflare | **是（强推断）** | ① 实测响应 `server: cloudflare`；② `wrangler.jsonc:17-25` 用 `custom_domain: true`（自定义域要求该 zone 在本账号内，即 NS 必须指向 CF）；③ `wrangler.jsonc:15` 注释「域名已托管在 Cloudflare，部署时会自动创建 DNS 记录并签发证书」 |
| NS 具体主机名（例如 `gordon.ns.cloudflare.com` / `karina.ns.cloudflare.com`） | **需确认** | 父 agent 提供的实测记录称是 `gordon/karina.ns.cloudflare.com`；但本次证据文件里 `dns.zhihaisblog.top/NS` 的采集结果是 `{"error":"TypeError"}`（**整段 DNS 查询与 RDAP 全部失败**），仓库里也搜不到这两个字符串（`grep gordon|karina` 无命中）。**我无法在仓库或证据文件内复核这两个主机名**，所以只能标「需确认」：请在 Cloudflare 控制台 → 域名 → Overview 底部，或 `nslookup -type=NS zhihaisblog.top 1.1.1.1` 现场确认 |
| A / AAAA / CAA / DS / TXT / MX 记录 | **需确认** | 同上，证据文件里这几项全是 `TypeError`（网络/解析失败），`rdap` 是 `SyntaxError` |

### 6.4 CSP 全文与逐项放行理由

当前生效值（`worker/index.mjs:31`；`public/_headers:32` 与之**完全一致**，实测两者都是 407 字符）：

```text
default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://giscus.app https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https:; frame-src https://giscus.app; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'
```

逐条为什么放行（依据来自 `public/_headers:13-23` 的核对记录 + 代码位置）：

| 指令 | 放行内容 | 为什么必须放行 | 依据 |
| --- | --- | --- | --- |
| `default-src` | `'self'` | 白名单基线：默认只允许同源 | `public/_headers:32` |
| `script-src` | `'self'` | 本站脚本 | — |
| | `'unsafe-inline'` | 站点大量使用内联脚本/样式（Firefly 的内联初始化、Swup 钩子） | `public/_headers:14` |
| | `'wasm-unsafe-eval'` | **Pagefind 站内搜索用 WebAssembly**（缺了搜索直接不可用） | `public/_headers:15`、`eb2e64e` 正文 |
| | `https://giscus.app` | 评论区：`<giscus-widget>` 内部会加载 giscus.app 的资源 | `public/_headers:18` |
| | `https://static.cloudflareinsights.com` | Cloudflare Web Analytics（与 `analyticsConfig.ts:52` 的 token 配套） | `public/_headers:19` |
| `style-src` | `'self' 'unsafe-inline'` | 内联样式（主题变量注入、组件内联 style） | — |
| `img-src` | `'self'` | 本地图 | — |
| | `data:` | 内联小图/占位 | — |
| | `blob:` | **Fancybox 用 `URL.createObjectURL` 处理 SVG 图片**（缺了灯箱会坏） | `public/_headers:16`、`eb2e64e` 正文 |
| | `https:` | 远程图片：友链图标直链、MAL/VNDB 封面等 | `public/_headers:17`、`siteConfig.ts:338-343` |
| `media-src` | `'self' blob:` | 音乐播放器（本地 `/assets/music/*` + blob）；**背景视频已删除，不再放行远程媒体** | `public/_headers:21`、`1940c1c`、`588d320` |
| `font-src` | `'self' data:` | 字体子集产物与内联字体 | — |
| `connect-src` | `'self' https:` | 站点自身 fetch（Pagefind 同源）+ 第三方 https 接口（giscus、CF insights） | — |
| `frame-src` | `https://giscus.app` | 评论区是 iframe | `public/_headers:18` |
| `worker-src` | `'self' blob:` | **樱花特效的 Web Worker** | `public/_headers:20`、`eb2e64e` |
| `frame-ancestors` | `'self'` | 防点击劫持（与 `X-Frame-Options: SAMEORIGIN` 双保险） | `public/_headers:11` |
| `base-uri` | `'self'` | 防 `<base>` 劫持 | — |
| `object-src` | `'none'` | 禁插件 | — |
| `form-action` | `'self'` | 防表单外发 | — |

**已从 CSP 移除：`https://esm.sh`。** 原因与结论：

- 曾经 giscus 用 `import("https://esm.sh/giscus")` 动态注册自定义元素，CSP 必须放行 `esm.sh`；漏放行导致**评论区整体打不开**（提交 `46cd957`，见第 12.6 节）。
- 现在改为**自托管** `public/vendor/giscus-1.6.0.mjs`（25 KB，`import("/vendor/giscus-1.6.0.mjs")`，`src/components/comment/Giscus.astro:68`），CSP 收紧回「纯第一方 + giscus.app」（提交 `d34f995`）。
- 实测：`worker` CSP 与 `_headers` CSP 中 `esm.sh` 命中数均为 **0**。**注意**：`dist/vendor/giscus-1.6.0.mjs` 第 1 行有一句 banner 注释 `/* esm.sh - giscus@1.6.0 */`，所以对整个 `dist/` 做全文搜索会得到 1 处 `esm.sh` —— 那是**注释文本，不是加载依赖**，`d34f995` 正文说的「命中数为 0」是指 HTML/JS/CSS/XML 的引用，两者不矛盾但容易被误读。

> 调试 CSP 的办法（`public/_headers:22-23` 写的）：把响应头临时改回 `Content-Security-Policy-Report-Only`，先观察不拦截。注意**必须改 worker**，改 `_headers` 无效。

### 6.5 HSTS 与其他安全头（实测）

| 头 | 实测值 | 来源 |
| --- | --- | --- |
| `strict-transport-security` | `max-age=15552000; includeSubDomains`（= 180 天） | `worker/index.mjs:24`（**代码下发**，不需要控制台开 HSTS） |
| `x-content-type-options` | `nosniff` | `:25` |
| `referrer-policy` | `strict-origin-when-cross-origin` | `:26` |
| `x-frame-options` | `SAMEORIGIN` | `:27` |
| `permissions-policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | `:28` |
| `x-xss-protection` | `0` | `:29`（刻意设为 0，交给 CSP） |
| `content-security-policy` | 见 6.4 | `:31` |

> 实测四类响应（200 HTML / 404 HTML / 206 音频 / 301 跳转）都带齐了这些头 —— 与 `H1` 修复后的设计一致。**301 也带头**（`worker/index.mjs:44-46` 的注释点明了这点）。

### 6.6 媒体长缓存与 Range 的配合

| 路径 | `cache-control` | 依据 | 注意 |
| --- | --- | --- | --- |
| `/assets/music/*.mp3`（`AUDIO_RE`） | `public, max-age=86400`（1 天） | `worker/index.mjs:19,160` | 音频 URL 在歌单里带 `?v=<内容哈希>`（实测样例 `"/assets/music/all-eyes-on-me.mp3?v=54166e81"`），换歌后哈希会变 |
| `/assets/music/cover/*`（`COVER_RE` 命中 `/cover/`） | `public, max-age=604800`（7 天） | `:20,160` | 同上 |
| 其它 `/assets/music/*`（歌词） | `public, max-age=3600`（1 小时） | `:160` | 歌词可能随时补 |
| `/_astro/*`、`/vendor/*` | `public, max-age=31536000, immutable` | `:122-126` | 文件名带内容哈希/版本号 |
| `/pagefind/*` | `public, max-age=604800` | `:127-129` | 搜索索引 |

### 6.7 需要在 Cloudflare 控制台确认的清单（仓库里查不到 → 全部「需确认」）

| # | 项 | 为什么需要确认 | 建议值 / 注意事项 |
| --- | --- | --- | --- |
| 1 | **NS 记录** | 证据文件 DNS 采集失败（6.3） | 应指向 Cloudflare 分配的两个 NS（父 agent 记录为 `gordon/karina.ns.cloudflare.com`，**未能在本次核实**） |
| 2 | **SSL/TLS 加密模式** | 仓库里没有任何对应文件；Worker `custom_domain` 会自动签证书，但模式仍可被改 | 至少 `Full`；若源站可控用 `Full (strict)`。设成 `Flexible` 会和 HSTS 冲突 |
| 3 | **Always Use HTTPS** | 控制台开关，仓库无对应配置 | 建议开启（HSTS 由 worker 下发，但首次访问/无 HSTS 缓存时仍靠这个开关做 301） |
| 4 | **缓存规则 / Cache Rules** | 仓库无配置文件；实测首页 `cf-cache-status: HIT` 说明边缘在缓存 HTML | 不要再叠加「Cache Everything + 长 TTL」的规则，否则发布后 HTML 可能长时间不更新（现在 HTML 是 `max-age=0, must-revalidate`，属安全配置） |
| 5 | **DNSSEC 的 DS 记录** | 纯控制台操作，仓库无文件 | 在 CF 开启 DNSSEC 后，到**域名注册商**添加 DS；**算法选 `ECDSA Curve P-256 with SHA-256`**（Cloudflare 当前签发的就是它），选 RSA/SHA-256 会导致校验失败（`README.md:979` 同样写了这一条） |
| 6 | **CAA 记录不要删** | 控制台/DNS 记录 | CAA 是「只允许指定 CA 为本域签发证书」的声明；删掉或改错会导致证书签发/续期失败、HTTPS 直接不可用（`README.md:980`） |
| 7 | **Bot Fight Mode / 各种「优化」开关** | 控制台 | 开 Rocket Loader / Auto Minify（旧版）之类会改写 HTML/JS，与 Swup、内联脚本、Pagefind 可能冲突 → 建议保持关闭，改完必须实测首页/文章页/搜索/评论区 |
| 8 | **Web Analytics 是否仍启用** | `analyticsConfig.ts:52` 有 token；CSP 放行了 `static.cloudflareinsights.com` | 若在控制台关闭了 Web Analytics，可考虑同步移除 CSP 里那一项（非必须） |
| 9 | **Workers 的 deployment 历史与回滚** | 控制台 | `wrangler deploy` 每次都会留版本，可以一键回滚到上一个版本（与 git revert 是两条独立回滚路径，见第 10.4 节） |

---

## 7. 阿里云相关配置（域名注册侧）

### 7.1 这一章解决什么问题

`zhihaisblog.top` 的**注册/续费/实名**在阿里云，**DNS 解析**在 Cloudflare。这两件事分属不同平台，混在一起操作是「站点忽然打不开」的经典成因。这一章划清边界、给出排查顺序。

### 7.2 事实与依据

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 域名 | `zhihaisblog.top` | `worker/index.mjs:16-17`、`wrangler.jsonc:19,23`、`src/config/siteConfig.ts:51` |
| 注册商 | **阿里云（父任务陈述）** | 仓库里**没有任何**阿里云相关的配置、脚本或文档；此项只能由人工确认（见 7.4） |
| DNS 托管 | **Cloudflare** | 见 6.3：实测 `server: cloudflare` + `custom_domain` 路由 + `wrangler.jsonc:15` 注释 |
| 仓库里与 DNS 有关的文件 | **没有**。DNS 记录由 `wrangler deploy` 依据 `wrangler.jsonc:17-26` 自动创建 | 实测全仓库无 `*.tf`、无 CF API 脚本、无 DNS 记录清单 |

### 7.3 域名注册侧 vs DNS 侧（务必分清）

| 事项 | 归属 | 现状 / 该做什么 |
| --- | --- | --- |
| 域名所有权、到期时间、续费 | **阿里云（注册商）** | 建议开启**自动续费**；`.top` 到期后进入赎回期的成本远高于续费 |
| 实名认证（域名持有者信息） | **阿里云（注册商）** | 保持实名信息有效。**姓名/证件/邮箱变更后要同步更新**，否则可能被注册局暂停解析（serverHold）→ 表现为「整站打不开」 |
| 转移锁 / 域名锁（clientTransferProhibited） | **阿里云（注册商）** | 保持「开启转移锁」是安全的默认状态；只有真的要转出时才临时关闭 |
| NS 服务器（nameserver） | **注册商侧填写 → 决定 DNS 归属** | **已经指向 Cloudflare，不要再动**。改动 NS = 把解析权搬走 = 站点与证书立刻受影响 |
| A / AAAA / CNAME / CAA / TXT 等记录 | **Cloudflare（DNS 托管方）** | 由 `wrangler deploy` 自动创建（`custom_domain`）；**不要在阿里云再建一份解析**（阿里云的解析此时不生效，容易误导排查） |
| DS 记录（DNSSEC） | **注册商侧（阿里云）填写**，值由 **Cloudflare** 生成 | 见 6.7 第 5 条：算法选 `ECDSA Curve P-256 with SHA-256` |
| CAA 记录 | **Cloudflare** | 不要删（见 6.7 第 6 条） |
| ICP 备案 | **不适用/需确认** | 站点托管在 Cloudflare 边缘、不使用中国大陆境内服务器，通常不需要 ICP 备案；**但这是合规问题，且仓库里没有任何可核实的证据，不在此断言**。父任务明确要求不要编造备案号 |

### 7.4 「需在控制台确认」清单（我无法从仓库验证的原因）

| # | 项 | 为什么无法验证 |
| --- | --- | --- |
| 1 | 阿里云账号、域名持有人、实名状态、到期日 | 仓库内无任何凭据/截图/文本；证据文件的 `rdap` 采集直接 `SyntaxError`（失败），拿不到注册数据 |
| 2 | 是否已开启自动续费 | 同上 |
| 3 | 转移锁状态 | 同上 |
| 4 | NS 当前值（应为 Cloudflare 的两个 NS） | 证据文件 `dns.zhihaisblog.top/NS` 为 `TypeError`（采集失败）；仓库文本内无 NS 主机名 |
| 5 | DS 记录是否已添加、算法是否为 ECDSA P-256 | 控制台侧数据，仓库无文件 |
| 6 | 是否存在历史遗留的旧解析记录（例如指向旧站的 A 记录） | 需查阿里云解析列表（此处理论上不生效，但残留记录会造成排查干扰） |

> 父任务给的一条信息（NS = `gordon/karina.ns.cloudflare.com`）与本次证据采集结果冲突，我按第 6.3 节处理：作为「父 agent 记录」保留，但**标注需确认**，不作为文档结论。

### 7.5 迁移 / 排查顺序（照这个顺序做，不要跳步）

**场景 A：站点打不开（先分清是 DNS 还是站点）**

1. `nslookup zhihaisblog.top 1.1.1.1` 与 `nslookup www.zhihaisblog.top 1.1.1.1` → 能否解析出 Cloudflare 的 IP。解析不出来 = **NS/注册侧问题**（去阿里云看域名状态：是否过期、是否 serverHold、NS 是否被改）。
2. 解析正常但仍打不开 → `curl -I https://www.zhihaisblog.top/` 看 `server: cloudflare` 与状态码。
   - 证书错误 → 看 Cloudflare SSL/TLS 模式与证书签发状态（6.7 第 2、6 条）。
   - `503` → 看 Cloudflare Workers 的部署状态/版本，必要时回滚上一个 Worker 版本。
   - `404` 但页面是纯文本 → 检查 `wrangler.jsonc:13` 的 `not_found_handling` 是否被改回默认。
3. 只有裸域打不开、www 正常 → 检查 `worker/index.mjs:16-17` 的 `APEX_HOST`/`CANONICAL_HOST` 与 `wrangler.jsonc:17-25` 的两个 route。
4. **不要在排查过程中改 NS**。改 NS 会把问题从「一个点」变成「需要等 24-48 小时传播」。

**场景 B：要换域名**

必须同时改四处（`README.md:981` 也写了这条）：
1. `src/config/siteConfig.ts:51` 的 `site_url`；
2. `wrangler.jsonc:17-26` 的 `routes`；
3. `worker/index.mjs:16-17` 的 `CANONICAL_HOST` / `APEX_HOST`；
4. `public/.well-known/security.txt` 里的 `Canonical` / `Contact` / `Policy` 链接。

**场景 C：要迁移 DNS 提供商**

先在目标平台建好全部记录 → 降低 TTL（提前 ≥24h）→ 再改 NS → 验证解析与证书续期 → 最后清理旧记录。**在 DNS 迁移期间不要同时发布站点内容**，否则出问题无法二分定位。

---

## 8. GitHub 配置

### 8.1 这一章解决什么问题

推送 `main` 之后会发生什么、需要哪些 Secrets、CI 的哪些「红」不是真失败、以及匿名 GitHub API 限流如何影响面板 —— 避免把正常现象当成故障去「修」。

### 8.2 仓库与触发

| 项 | 事实 | 依据 |
| --- | --- | --- |
| 仓库 | `Zhi2007/firefly-blog` | `git remote -v`（`origin`） |
| 主分支 | `main` | `git rev-parse --abbrev-ref HEAD` |
| 触发条件 | `push` 到 `main`、`pull_request`、`workflow_dispatch` | `.github/workflows/deploy.yml:3-7` |
| 并发策略 | `concurrency: group: deploy-${{ github.ref }}` + `cancel-in-progress: true` —— **同一分支连续推送只保留最后一次部署** | `:12-15` |
| 权限 | `permissions: contents: read`（只读） | `:9-10` |
| 超时 | `timeout-minutes: 20` | `:20` |
| 上游主题仓库 | `CuteLeaf/Firefly`（本地 ref `upstream/master`） | `git remote -v`、`git branch -r` |

### 8.3 `deploy.yml` 的 7 个步骤（逐行核对）

| # | 步骤 | 内容 | 行 |
| --- | --- | --- | --- |
| 1 | Checkout | `actions/checkout@v7` | `:22-23` |
| 2 | Setup pnpm | `pnpm/action-setup@v4`，`run_install: false` | `:25-28` |
| 3 | Setup Node.js | `actions/setup-node@v7`，`node-version: 24`，`cache: pnpm` | `:30-34` |
| 4 | Install dependencies | `pnpm install --frozen-lockfile` | `:36-37` |
| 5 | Build site | `pnpm run build`（注释写明完整链路：LQIP → Astro → 字体子集 → Pagefind） | `:39-41` |
| 6 | Check Cloudflare credentials | **仅非 PR**；检查两个 Secret 是否为空，缺了就 `::error::` 并 `exit 1` | `:43-55` |
| 7 | Deploy to Cloudflare Workers | **仅非 PR**；`cloudflare/wrangler-action@v4`，`apiToken` + `accountId` | `:57-63` |

> PR 只做构建校验、不部署（`:57` 的 `if`）。所以 **PR 变绿 ≠ 已上线**。

### 8.4 必需的 Secrets（只写名字，不写值）

| Secret 名 | 用在哪 | 从哪拿（用户向说明见 `README.md:915-918`） |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `.github/workflows/deploy.yml:46,62` | Cloudflare → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | `.github/workflows/deploy.yml:47,63` | Cloudflare → Workers & Pages 右侧栏 |

**建议的最小权限**（生产实践建议，仓库里没有记录 token 权限的能力 → 标注为**建议**而非事实）：

- 用 Cloudflare 内置模板 **Edit Cloudflare Workers** 创建；
- 作用域至少需要：`Account → Workers Scripts: Edit`、`Account → Workers KV/其他被用到的绑定: Edit`（当前 Worker 只用静态资源绑定 `ASSETS`，无需 KV/R2/D1）、`Zone → Workers Routes: Edit`（`custom_domain` 路由）、`Zone → Zone: Read`（读 zone 以绑定路由）、`Zone → DNS: Edit`（仅首次创建自定义域时写入 DNS 记录）；
- **不要**给 `All zones` + 全部权限的 Global API Key（Global Key 无法限定作用域，泄漏即全账号失守）；
- token 只放 GitHub Secrets，**绝不**写进仓库文件（`AGENTS.md:34` 也是这条）。

### 8.5 `cancelled` 不算失败（容易被误判）

| 现象 | 真相 |
| --- | --- |
| 快速连续推送后，Actions 里出现 `cancelled` 的 run | 这是 `concurrency.cancel-in-progress: true`（`.github/workflows/deploy.yml:15`）的**正常行为**：新推送取代了旧运行 |
| 面板顶部挂红条显示「CI 部署失败」 | 曾经的真 bug：`FAILURE_CONCLUSIONS` 含 `"cancelled"`，且 `lastFailure` 只要历史上出现过失败就永远返回它。已修（提交 `e861438`）：失败集合移除 `cancelled`，且改为「仅当失败比最近一次成功更新时才返回 `lastFailure`」 |
| 判定失败的口径 | `admin/ci.mjs:39`：`FAILURE_CONCLUSIONS = {failure, timed_out, action_required, startup_failure, stale}` —— **不含 `cancelled`** |
| 旧失败被新成功覆盖后红条是否消失 | 会（`e861438` 的验收就是「真实启动面板调 `/api/ci` → `ok=true`、`lastFailure` 为空、`lastSuccess` 存在」） |

### 8.6 匿名 GitHub API 限流与面板降级

| 机制 | 参数 | 依据 |
| --- | --- | --- |
| 匿名 API 配额 | **每小时 60 次** | `admin/README.md:446` |
| 内存缓存 | `CI_CACHE_TTL_MS = 60 * 1000`（同一 URL 60 秒内只请求一次），最多 200 条，超出淘汰最旧 | `admin/ci.mjs:23,27`、`admin/README.md:446` |
| 只缓存成功响应 | 超时、断网、403（限流）、404、非法 JSON **都不进缓存**（避免偶发失败被钉死 60 秒） | `admin/README.md:447` |
| 超时 | `CI_TIMEOUT_MS = 8000`（8 秒）+ 任何异常降级成 `{ok:false, error}`，不抛错 | `admin/ci.mjs:25`、`admin/README.md:448` |
| 日志体积 | `LOG_MAX_BYTES = 2 MiB`，只保留尾部再切最后 30 行 | `admin/ci.mjs:29`、`tailLines`（`:204`） |
| 限流识别 | `isRateLimitedResponse()`（`admin/ci.mjs:105`）+ `rateLimitWarning()`（`:117`）；`/api/ci` 返回 `rateLimited: true/false` 与 `warning` | `admin/server.mjs:1160-1169,867` |
| 请求次数优化 | `M5` 修复后：由「每次约 10 个请求」改为 **1 次 `actions/runs` 按 `head_sha` 归并**（`groupWorkflowRunsBySha`，`admin/ci.mjs:91`） | `bc3f0b2` 正文 |
| 详情是「尽力而为」 | `actions/jobs/{id}/logs` 匿名请求不稳定（可能 403/404/302）；拿不到就只在 `detailWarning` 说明，步骤与原因照常显示；`/api/ci` **永远是 200** | `admin/README.md:450,408`、`admin/server.mjs:2157-2176` |
| 看几个提交 | 最近 **8** 个（更早的老失败不显示） | `admin/README.md:468` |

### 8.7 其他 GitHub 侧事实与「需确认」项

| 项 | 结论 | 依据 |
| --- | --- | --- |
| Dependabot | 已配置：npm 生态、每日、patch/minor 分组、**忽略 major** | `.github/dependabot.yml:1-22` |
| 是否启用分支保护 | **需确认**：证据文件里 `github.branchProtection` 返回 `403`（注解为「需要授权才能读，或未开启保护」） | `%TEMP%\project-evidence.json` |
| Secrets 是否已配置 | **需确认**：证据文件 `github.secretsReadable: 403`（GitHub 不允许匿名读 Secrets，属正常） | 同上 |
| 仓库 License | 证据文件 `github.license: null`（未识别到许可证元数据）；仓库根有 `LICENSE` 文件 | 证据 + 实测 `LICENSE` 存在 |
| 远端是否有未拉取的提交 | 本次 `git status --porcelain --untracked-files=all` 输出为空（工作区干净） | 实测 |

---

## 9. 管理面板（`admin/`）

### 9.1 这一章解决什么问题

面板是本项目**唯一的常规写入通道**。要知道：它怎么认证、有哪些接口、每个接口会不会写盘/建快照、有哪些已知边界。用户向用法见 `admin/README.md`（689 行，章节索引在它开头）。

### 9.2 认证模型

| 环节 | 事实 | 依据 |
| --- | --- | --- |
| 监听地址 | **只监听 `127.0.0.1`**，局域网/公网都访问不到 | `admin/server.mjs:2495`（`server.listen(PORT, "127.0.0.1", ...)`） |
| 端口 | 默认 **8799**；`--port=8899` 或环境变量 `ADMIN_PORT` 可改 | `admin/server.mjs:67-72` |
| 令牌 | **默认每次启动随机生成**：`randomBytes(16).toString("hex")` → 32 位十六进制；启动器会通过环境变量 `ADMIN_TOKEN` 注入一个**固定令牌**（重启后不变，旧 Cookie 仍有效） | `admin/server.mjs` 顶部 `TOKEN` |
| 打开方式 | 启动时自动打开 `http://127.0.0.1:<PORT>/?token=<TOKEN>`；`--no-open` 可禁自动打开 | `admin/server.mjs` 启动段 |
| 页面本身也要令牌 | 打开 `/` 或 `/index.html` 时认 **URL `?token=` / `X-Admin-Token` 头 / 会话 Cookie** 三者之一；**认 Cookie 是为了页面刷新**（地址栏 token 已被 replaceState 抹掉，只认 token 会让 F5 变 403） | `admin/server.mjs` 静态页分支 |
| 会话 Cookie | 页面校验通过后下发 `admin_session=<HMAC-SHA256 hex>`，属性 `HttpOnly; SameSite=Strict; Path=/`，**不含 `Secure`**（只跑在 127.0.0.1） | `admin/server.mjs` 会话 Cookie 段 |
| Cookie 签名密钥 | 就是本次启动的 TOKEN；**启动器注入固定 TOKEN，所以在线重启后 Cookie 不会失效**；手动 `node admin/server.mjs` 启动仍是每次随机、重启即失效 | `admin/server.mjs` 顶部 |
| 托管标记 | 启动器设置 `ADMIN_SUPERVISED=1`；只有该值为 1 时 `POST /api/status {action:"restart"}` 才允许退出并由启动器重新拉起 | `admin/server.mjs` 顶部 / `/api/status` |
| 三选一认证 | 接口接受 `sessionValid(Cookie)` **或** `x-admin-token` **或** `?token=` | `admin/server.mjs` `authorized()` |
| 恒定时间比较 | 令牌与 Cookie 签名都用 `timingSafeEqual`，长度不等直接 false | `admin/server.mjs` 认证辅助函数 |
| **`/api/logout` 故意免认证** | 它只清本地 Cookie，没登录时调用也无害；**除它以外所有接口都要凭证** | `admin/server.mjs` 前置分支 |
| 未认证返回 | `403 {"error":"令牌无效，请重新启动管理后台"}`（**不是 401**） | `admin/server.mjs` 认证分支 |
| 请求体上限 | 64 MB（`readBody` 内累计超过即 400） | `admin/server.mjs` `readBody` |
| 前端抹除令牌 | 页面加载后 `history.replaceState` 清掉地址栏 `?token=`；刷新靠 HttpOnly Cookie | `admin/index.html` 脚本开头 |

### 9.3 全部 `/api/*` 路由表（37 条）

**统计方式（可复现）**：用正则 `case\s+"(\/api\/[^"]+)"` 从 `admin/server.mjs` 提取 → **36** 条；再用 `(?:route|pathname)\s*===\s*"(\/api\/[^"]+)"` 提取 switch 之外的**前置处理** → **1** 条（`/api/logout`）；两者并集去重 → **37** 条。另有 1 条非 `/api` 的 `case`：`/media-file`。`POST_BODY_FIELDS`（`admin/server.mjs:1564-1602`）登记 **35** 条：没登记的只有 `/api/post`（只需 `GET` + query）与 `/api/logout`（在进入 switch 之前就处理完了），两条都没有 POST body，语义上不需要登记。

> ⚠️ 新增 `/api/*` 路由时**必须同时往 `POST_BODY_FIELDS` 加一行**：未登记的接口跳过字段校验（`assertPostBody` 里 `if (!allowed) return body;`，`admin/server.mjs:1592`），等于放弃「字段打错不许静默执行」这道保护。

> 📌 下表最后一列的「位置」是 2026-10-11 实测的 `admin/server.mjs` 行号。**在这个文件里插删代码后它一定会整体偏移** —— 要么按下面的办法重算，要么至少把改动到的那几行更新掉（脚本不检查这一列）：
>
> ```sh
> node -e "const t=require('fs').readFileSync('admin/server.mjs','utf8').split(/\r?\n/);t.forEach((l,i)=>{if(/^\s*case \"\/api\//.test(l))console.log(i+1,l.trim())})"
> ```

| # | 路由 | 方法（代码实际行为） | 写盘 | 写前快照 | 关键安全约束 / 备注 | 位置 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/api/logout` | **仅 POST**（否则 405） | 否 | 否 | **故意免认证**；清 Cookie | `:1647-1654` |
| — | `/api/health` | **仅 GET**（否则 405） | 否 | 否 | 启动器就绪探针专用：只回 `{ok,ready,pid,port,supervised,startedAt}`，**不跑 git、不联网、不 spawn 子进程**（毫秒级）；`POST_BODY_FIELDS` 登记空数组；见 9.13 节 | `admin/server.mjs` 的 `/api/health` 分支 |
| 2 | `/api/status` | GET 读状态；**POST `{action:"restart"}`**（仅启动器托管时） | 否 | 否 | 仓库信息 + 最近 Actions + pnpm 探测；`changed[]` 是结构化的待提交文件（`{code,path,origin}`）；`server{pid,port,supervised,startedAt,uptimeMs,logFile}`；`?log=1` 额外返回后台日志尾部（最多 128KB，`log{text,size,truncated,missing}`）；POST restart 先回 `{ok:true}` 再退出，由启动器以同端口/令牌重新拉起；未托管返回 **409**；`POST_BODY_FIELDS` 放行 `action` | `admin/server.mjs` 的 `/api/status` 分支 |
| 3 | `/api/posts` | GET | 否 | 否 | 文章列表；另返回 `dir` / `imagesDir` / `imagesUrlPrefix`（面板显示「文章存在哪、图片放哪」） | `:1681-1691` |
| 4 | `/api/post` | GET（读 query `slug`） | 否 | 否 | **slug 先过 `POST_SLUG_RE` 再拼路径**（`M1`）；返回 `file` / `dir` / `imagesDir` / `images[]`（正文引用的本地图片 + 逐个 `stat` 过的真实路径） | `:1692-1733` |
| 5 | `/api/save-post` | POST | **是** | **是**（新文件 + 改名前的旧文件） | `slug` 与 `originalSlug` **都**过正则（`M2`）；**frontmatter 外科式改写**：日期落盘为不带引号的 `YYYY-MM-DD`、非法日期或空 `title` 一律 400（不落盘）、没编辑的行逐字节保留（**9.12 节**）；返回 `file` / `notes[]`（本次顺手规整了哪一行日期） | `:1745-1780` |
| 6 | `/api/delete-post` | POST | 是（删除） | 是 | slug 正则 + `resolveInside([POSTS_DIR])` | `:1762-1778` |
| 7 | `/api/media` | GET | 否 | 否 | 返回目录表（`dirs`）与文件列表（每项含 `repoPath` 仓库相对路径） | `:1779-1782` |
| 8 | `/api/upload` | POST | **是** | 覆盖同名文件时 | `dir` ∈ `MEDIA_DIRS`；扩展名白名单 `UPLOAD_EXT`；`resolveInside`；音频额外抽封面/歌词；返回 `repoPath` | `:1783-1825` |
| 9 | `/api/delete-media` | POST | 是（删除） | **是**（删除不可逆，必留快照） | `resolveInside` 到全部 `MEDIA_DIRS` | `:1826-1845` |
| 10 | `/api/announcements` | GET 读 / POST 写 | **是** | 是（`writeJsonData` 内） | `body.items` 必须是数组；GET 返回数据文件路径 `file` | `:1846-1866` |
| 11 | `/api/announcement-draft` | **仅 GET** | 否（只读 git 历史，不碰任何文件） | 否（设计如此：只产草稿） | 未认证 403；`since` 支持「提交 sha / YYYY-MM-DD / 最近天数」，非法一律 400；git 失败降级为 502 并给中文原因；**只生成草稿、不自动发布**；见 9.9 节 | `:1867-1882` |
| 12 | `/api/playlist` | GET 读 / POST 写 | **是** | 是 | `body.songs` 必须是数组；GET 返回数据文件路径 `file` 与每首歌 `paths:{url,cover,lrc}`（站内路径逐个 `stat` 过）；**POST 会拒绝重复 url**（见 9.14） | `:1883-1911` |
| 13 | `/api/save-lyrics` | POST | **是** | **是**（`L6` 补的） | 路径由音频 URL 派生到 `lrc/<base>.lrc` | `:1912-1939` |
| 14 | `/api/extract-audio` | POST | 是（封面/歌词） | 否（走 `extractAndStoreAudio`） | 只允许 `public/assets/music` 下的音频 | `:1940-1959` |
| 15 | `/media-file` | GET（非 `/api`） | 否（只读流） | 否 | 只读白名单 `MEDIA_READ_DIRS`（= 5 个媒体目录 + `public/friends`）；Range/206/416；**畸形 Range 曾打死进程**（`C1`） | `:1960-2031` |
| 16 | `/api/configs` | GET | 否 | 否 | 返回 `CONFIG_FILES`（15 个） | `:2032-2035` |
| 17 | `/api/config-file` | GET 读 / POST 写 | **是** | 是 | `path` 必须在 `CONFIG_FILES` 白名单内 | `:2036-2057` |
| 18 | `/api/sync` | GET/POST | 否（git 操作） | 否 | 本地有未提交改动则拒绝 | `:2058-2063` |
| 19 | `/api/publish` | POST | git commit（+push） | 否 | `message` 必须 string；默认先跑体检（**10 项**，含文章 frontmatter 的 YAML 速查 + 真实 `astro build`），有 error 拦住（`force: true` 跳过）；被拦住时 `blocked: true`，`message` 直接列出「文件 → 字段 → 怎么改」（见 9.11）；只暂存 `PUBLISH_SCOPE`；返回 `files` / `skipped`（都是真实相对路径）；**工作区没有新改动但本地有未推送提交时，不报「没有需要提交的改动」，而是直接 push 这批提交**（不产生空提交，见 10.2） | `:2085-2095` |
| 20 | `/api/doctor` | GET/POST | 否（唯一的写盘是 `astro build` 的产物 `.astro/doctor-build/`，不碰 `dist/` 与仓库内容） | 否 | **10 项**体检；其中 `content-frontmatter`（YAML 速查）与 `content-schema`（真实构建）专查文章 frontmatter，见 9.11；Git 那一项用 `info.changed` 列出待提交文件 | `:2096-2101` |
| 21 | `/api/settings` | 非 POST 读 / POST 写 | **是** | 是（每个涉及文件） | `SETTINGS_DEFS` 白名单 + 类型/范围/枚举 + 结构体检 + 回读校验 + 失败回滚；GET 返回 `defs`（含 `file`/`within`/`key`）与 `pageToggle:{file,block}` | `:2081-2107` |
| 22 | `/api/backups` | GET 读列表 / POST 设置保留份数 | **是**（仅 `admin-backups/keep.json` 保留份数设置） | 否（设置文件本身就在备份目录，无需再备份） | GET 返回 `backups[]` + `keep`；POST `{ keep: N }`，N 必须是**正整数**，保存后立即清理超出份数的旧快照并返回 `removed` | `:2156-2185` |
| 23 | `/api/restore` | POST | **是** | **是**（恢复前再给「当前版本」留一份） | `id` 格式校验；`rel` 双重校验（`1940c1c`） | `:2113-2122` |
| 24 | `/api/backup-export` | **仅 GET** | 否（读快照打包） | 否 | `id` 必须 `^[A-Za-z0-9-]+$` | `:2123-2156` |
| 25 | `/api/ci` | **仅 GET** | 否 | 否 | 内部与路由双层兜底，**永远 200**；限流时 `rateLimited: true` | `:2157-2176` |
| 26 | `/api/revert` | **仅 POST** | git revert（+push） | 否（git 操作无原文件） | `sha` 必须 `^[0-9a-f]{7,40}$`；`execFile` 不过 shell | `:2177-2193` |
| 27 | `/api/taxonomy` | **仅 GET** | 否 | 否 | 标签/分类候选 | `:2194-2202` |
| 28 | `/api/import-document` | **仅 POST** | 图片落盘（不写文章） | **否（设计如此：没有旧版本可备份）** | 25 MB 上限（先按 base64 估长再解码）；图片目录固定且校验；返回 `images[].repoPath` | `:2203-2246` |
| 29 | `/api/nav` | GET 读 / POST 写 | **是**（`nav-overrides.json`） | 是 | 提交的 id 集合必须与 `navBarConfig.ts` 完全一致，**不支持新增**；GET 返回 `file`（+`fileExists`，没改过导航时该文件不存在）与只读来源 `sourceFile` | `:2247-2259` |
| 30 | `/api/friends` | GET 读 / POST 写 | **是**（`friends.json`） | 是 | 校验规则见 `admin/README.md:535-544`；GET 返回 `file` / `dir` / `icons[]`（每条友链图标的仓库路径 + 是否存在） | `:2260-2271` |
| 31 | `/api/friends-fetch` | **仅 POST** | 是（图标落盘 `public/friends/`） | 否 | SSRF 守卫（`admin/friends.mjs:443+`）；**不写 `friends.json`** | `:2272-2283` |
| 32 | `/api/compress-music` | **仅 POST** | 取决于 `mode` | 否（脚本内部） | `mode ∈ {all, covers, check}`；命令行参数由服务端拼；`check` 固定带 `--dry-run` | `:2284-2307` |
| 33 | `/api/compress-media` | **仅 POST** | 是（**只新增 `.webp`**） | 否 | `dirs` 必须在 3 个 `COMPRESS_DIRS` 内；`dryRun` 默认 true 由前端控制；每项含 `rel` / `outRel` | `:2308-2338` |
| 34 | `/api/run` | POST | 否 | 否 | `script ∈ {build, dev, check}`；找不到 pnpm 时返回**可读提示**（不是报错） | `:2339-2366` |
| 35 | `/api/avatar` | 非 POST 读状态 / POST 换图或恢复默认 | **是**（新图片 + 改写 `profileConfig.ts` 的 `avatar`） | 是（同名图片覆盖时 + 配置改写前） | 扩展名白名单 + **魔数校验**（改扩展名骗不过）+ 25 MB 上限 + 只写 `public/assets/images`；`{restore:true}` 改回默认；GET 返回 `dir` / `repoPath` / `config:{file,key}`；见 9.8 节 | `:2367-2411` |
| 36 | `/api/reveal` | **仅 POST** | 否（拉起资源管理器，不碰仓库） | 否 | 「打开所在文件夹」：`path` 必须**落在仓库内**且真实存在（越界 400 / 不存在 404）；只在 Windows 上执行（其它平台 200 + `ok:false` 说明）；文件用 `spawn("explorer.exe", ["/select,", abs], {detached, stdio:"ignore"}).unref()`、目录直接传 `[abs]`，**`/select,` 与路径必须分开传**（合并时含空格路径会被整体加引号，Explorer 会退回「文档」目录），**不阻塞请求**；`POST_BODY_FIELDS` 只放行 `path`；见 9.10 节 | `:2517-2552` |
| — | `/api/diff` | GET/POST | 否 | 否 | `git diff --stat` + 结构化的 `files[{code,path,origin}]`（面板据此显示待提交文件的真实路径） | `:2412-2433` |
| — | 未知 `/api/*` | 任意 | 否 | 否 | `404 {"error":"未知接口: <route>"}` | `:2469-2471` |

### 9.4 页签清单（11 个，实测 `admin/index.html` 的 `nav button[data-tab]`）

| # | 页签 | `data-tab` | 能做什么（摘要） |
| --- | --- | --- | --- |
| 1 | 概览 | `overview` | 仓库/分支/未提交改动、最近提交、最近一次部署状态；本地预览/构建/类型检查 |
| 2 | 文章 | `posts` | 列表/新建/编辑/删除；标签分类候选下拉；密码/草稿/置顶；Markdown 预览 + 字数；封面上传；**从 Word/txt 导入**。每篇显示真实文件路径 `src/content/posts/<文件名>`（+ URL，由文件名决定）；编辑器里显示当前文件、图片目录与正文引用到的图片路径（见 9.10 节） |
| 3 | 公告 | `announce` | 公告增删改（含固定为弹窗的那一条）与弹窗版本号；**「生成草稿」**（读 git log → 填表单，只产草稿、不自动发布，见 9.9 节）；显示数据文件 `src/config/announcements.json` |
| 4 | 音乐 | `music` | 上传音频/封面/歌词、编辑歌曲、排序、本地试听；一键压缩（试算/只压封面/全压）；显示歌单文件 `src/config/music-playlist.json` 与每首歌音频/封面/歌词的真实路径 |
| 5 | 友链 | `friends` | 24 条友链的增删改排序 + 启停；「从网址抓取」自动猜标题/简介/图标（只填表单，需人工确认）；显示 `src/config/friends.json` 与每个图标的 `public/friends/<文件名>` |
| 6 | 媒体 | `media` | 分类查看/上传/复制路径/删除；**批量转 WebP**（默认先试算，只新增不删原图）；每条显示 `public/assets/...` 下的仓库相对路径 + 体积，卡片上显示当前目录路径 |
| 7 | 配置 | `config` | 直接编辑 `CONFIG_FILES`（15 个，含 `FooterConfig.html` 与 3 个 JSON） |
| 8 | 站点设置 | `settings` | 33 条可视化字段（**含 11 个页面开关**） + 导航菜单隐藏/改名/排序 + **站点头像卡片**（缩略图 / 上传新头像 / 恢复默认，见 9.8 节）；**每一项都显示「写进哪个文件的哪个块/字段」**（`file → within.key`，见 9.10 节），导航卡片显示 `src/config/nav-overrides.json`（+ 只读来源 `navBarConfig.ts`） |
| 9 | 体检 / 备份 | `doctor` | 一键体检（**10 项**，含「文章 frontmatter（YAML 速查）」与「文章 schema（真实构建校验）」两项，见 9.11）；快照列表 + 恢复 + 导出 ZIP（显示 `admin-backups/<id>/` 与每个文件的真实路径）；**保留份数可改为任意正整数**（`keep.json`，保存后立即清理旧快照）；CI 失败横幅与「回滚该提交」 |
| 10 | 发布 | `publish` | 同步状态、自动同步开关、一键 commit+push、从 GitHub 拉取、部署状态与日志；「待提交的改动」按 `git status` 逐条显示真实路径与状态码，发布后列出本次提交的文件（见 9.10 节） |
| 11 | 后台 | `runtime` | 后台状态（PID / 端口 / 运行时长 / 是否启动器托管）；**后台日志**（读 `logs/admin-server.log` 尾部，2 秒自动刷新、复制、📂 打开文件）；**重启后台**（仅启动器托管时可用，重启后页面自动重连）；**刷新界面**；见 9.13 节 |

> 📌 **历史不一致（已修）**：`README.md` 第 8.3 节的标题与目录树注释曾写「九个页签」（无 `publish` 页签那会儿），后来改成 **10 个**；2026-10-19 新增「后台」页签后为 **11 个**。`admin/README.md` 的功能表也同步为 11 行。

### 9.5 写入安全链（所有写接口共用）

```text
① 认证（Cookie / X-Admin-Token / ?token=，三者任一）        server.mjs:1657-1660
   ↓
② POST 请求体校验：必须是 JSON 对象 + 只允许登记字段         server.mjs:1575-1586
   （坏 JSON / null / 数组 / 数字 / 字符串 / 意外字段 → 400，绝不 500）
   ↓
③ 参数格式校验（slug 正则 / dir 白名单 / 扩展名白名单 / id 格式 / 目录归属）
   ↓
④ safeResolve + resolveInside（先 resolve 再按绝对路径比较目录前缀）  server.mjs:559-582
   ↓
⑤ 写前快照 → admin-backups/<时间戳>-<随机>/（默认保留最新 40 份，可调）    backups.mjs:18,48-112
   ↓
⑥ 写入（原子性：单文件覆盖 / 同目录临时文件 rename）
   ↓
⑦ 读回校验 → 不一致立即回滚（文件类用原内容重写；JSON 类逐条比对）
   ↓
⑧ 前端提示（含 backup 快照 id，可「传错了想还原」）
```

具体到「站点设置」这一条最长的链（`admin/settings.mjs:402-480` + `admin/README.md:215-223`）：

1. **白名单**：只允许 `SETTINGS_DEFS` 声明的 id（`:417-419`）；`pages.*` 走动态分支（`:405-415`）。
2. **类型校验**：string 长度、number 范围（如 `theme.hue` 0-360）、enum 取值、boolean、stringlist（`literalFor`，`:100-141`）。
3. **写前快照**：每个涉及文件一次（`server.mjs:2098-2100`）。
4. **结构体检**：改写前后 `countStructure()` 的 `{}[]` 数量必须一致（`:294-300,444-452`）—— 这一步挡的是「正则匹配到意外位置」。
5. **位置校验**：`replaceLiteralChecked` 要求字段在作用域内唯一，且改写后重新定位的下标与改写前完全相同（`:223-238`）。
6. **回读校验**：重新解析刚写的文件，值与目标不符 → **立即用原文回滚**并报错（`:457-469`）。

### 9.6 CI 状态与失败详情（页面红条的后端）

| 能力 | 实现 | 依据 |
| --- | --- | --- |
| 汇总最近 8 个提交的结论 | `ciStatus()` | `admin/server.mjs:1135-1212`、`admin/README.md:468` |
| 追到「哪个 job 的哪个 step 挂了」 | `check-runs` → `details_url` 取 run id → `actions/runs/{id}/jobs` → 失败 job 的 `actions/jobs/{id}/logs` | `admin/README.md:393-398`、`admin/ci.mjs:143-204` |
| `lastFailure` 只在「失败比成功更新」时返回 | 修掉了「旧失败永久挂红条」 | 提交 `e861438` |
| 日志片段 | 尾部 2 MiB → 最后 30 行；拿不到就只给 `detailWarning` | `admin/ci.mjs:29,204`；`admin/README.md:439,407` |
| 限流 | `rateLimited` 字段 + `warning` 文案 | `admin/server.mjs:1160-1169` |
| 一键回滚 | 「回滚该提交」→ `POST /api/revert {sha}` | `admin/index.html`（横幅按钮）、`admin/server.mjs:2157-2173` |

### 9.7 已知边界（**不要**当成 bug 去修）

| 边界 | 说明 | 依据 |
| --- | --- | --- |
| SSRF 防护是「尽力而为」 | 判断主机与真正发请求之间**仍存在 DNS 重绑定窗口**，也不检查非 HTTP 端口的语义。所以「从网址抓取」只应对信任站点使用 | `admin/README.md:569-568`、`admin/friends.mjs:1204` 注释 |
| JS 动态渲染的站点抓不到简介 | 正文很短又没有 meta 时，明确提示「页面没有可用的静态介绍，请手动填写」 | `admin/README.md:560` |
| **友链图标不能通过面板上传** | `public/friends/` **不在**上传/删除白名单（只是**只读**可访问，`MEDIA_READ_DIRS` 额外加了它）。站点头像则是**可以**通过面板换的：走「站点设置 → 站点头像」的 `/api/avatar`（只写 `public/assets/images/` 并同时改 `profileConfig.avatar`，见 9.8 节），「媒体」页里的 `avatar` 目录仍然只能传文件、不关联配置 | `admin/server.mjs:124-134`、`admin/README.md:575-575`、9.8 节 |
| 换头像不动友链页那张图 | 友链页自己的头像硬编码在 `src/content/spec/friends.mdx`（站点绝对 URL，属内容文件），换站点头像不会连带改它；旧文件不删，所以不会 404 | `src/content/spec/friends.mdx:14`、`admin/README.md` 站点头像一节 |
| 头像只认平铺路径 | `avatar` 被手工写成远程 URL / `src` 相对路径 / 子目录时，卡片只显示路径文本（`repoPath: null`），不会去猜文件 | `admin/avatar.mjs` 的 `describeAvatar` |
| 媒体 404 也走统一收口 | 媒体非 2xx 会经 `withSecurityHeaders` 返回，避免漏安全头 | `worker/index.mjs:147-148`、`H1` |
| 面板不新增导航项 | 见 4.3 节 | `admin/nav.mjs:99` |
| `/api/import-document` 不建快照 | 它不写文章（没有旧版本可备份），只转 Markdown + 落图片 | `admin/server.mjs:2203-2209` |
| `compress-media` 只新增 `.webp` | 不删也不覆盖原图；默认先试算 | `admin/README.md:585` |
| 体检「站内链接」依赖 `dist/` | 没有 `dist/` 时动态路由判定会退化（它先看 `dist/` 是否存在） | `admin/doctor.mjs:182-183` |
| 体检的「文章 schema」会真的跑一次 `astro build` | 约 8～13 秒（本机实测 12～13 秒；坏 frontmatter 时约 6 秒就报错退出）；这是**唯一**会写盘的体检项，产物写进 `.astro/doctor-build/`（已 gitignore），**不覆盖 `dist/`**。跑不起来（没装依赖 / 超时）只给 warning、不阻断发布；结果按「`src/` + 根配置文件指纹」在**同一进程内**缓存，文件没变就复用 —— 所以「先点体检、再点发布」不会构建两次 | `admin/content-check.mjs` 文件头、9.11 节 |
| **更新公告草稿不写盘、不自动发布** | `/api/announcement-draft` 只读 `git log` + 只读 `announcements.json`，**不打快照、不改任何文件**；生成的草稿只回给前端填表单，保存仍走 `POST /api/announcements`，上线仍要人点「发布」（实测：整轮请求前后 `git status` 逐字节不变、`admin-backups/` 不新增） | 9.9 节、`admin/announcement-draft.mjs` 顶部注释 |
| **英文提交说明只能机械整理，不能算翻译** | 只把英文首词映射成「新增/修复/优化…」，剩下的英文原样留着，并强制给一条 warning 让人润色；非 Conventional 的提交（含真实历史里的 `perf/security(comment): …`）一律原样放进「其它维护」+ warning，绝不猜 | `admin/announcement-draft.mjs` 的 `localizeCommitText` / `buildAnnouncementDraft` |
| 公告正文是纯文本，不解析 Markdown | 站点侧 `splitParagraphs()` 按空行切段后原样输出，所以草稿里的 `### 新增` 与行首 `-` 会**原样显示**；草稿据此在 warnings 里明说。要改渲染得动 `src/components/common/AnnouncementList.astro`（本次没动） | `src/utils/announcement-utils.ts:43`、`admin/announcement-draft.mjs` |

### 9.8 站点头像更换（`/api/avatar` + `admin/avatar.mjs`）

面板「站点设置」页顶部新增**站点头像卡片**：缩略图 + 当前路径/体积 + 「上传新头像…」+「恢复默认」。

**为什么放在「站点设置」而不是「媒体」页**：换头像不是单纯的文件上传，它得**同时改写 `src/config/profileConfig.ts` 的 `avatar` 字段**（首页侧栏资料卡 `Profile.astro`、文章分享海报 `[...slug].astro`、OG 图 `og/[...slug].ts`、`Person.image` 结构化数据都读它）。配置的归属地是「站点设置」，写入必须复用 `settings.mjs` 那条链；「媒体」页继续只做文件管理。

| 环节 | 实现 | 依据 |
| --- | --- | --- |
| 路由 | 一个 `/api/avatar`：`GET` 读状态（`describeAvatar`），`POST {filename,dataBase64}` 换图，`POST {restore:true}` 恢复默认 | `admin/server.mjs:2347-2391` |
| 落盘位置 | `public/assets/images/avatar-<内容 sha256 前 12 位>.<真实格式>`；**不覆盖** `avatar-zhi.webp`，「恢复默认」= 把配置写回它 | `admin/avatar.mjs` |
| 校验 | 扩展名白名单（与 `UPLOAD_EXT.avatar` 同口径：png/jpg/jpeg/webp/avif/gif）+ **魔数嗅探**（`sniffImageFormat`，`a.php.png` 这类拒掉；落盘扩展名取魔数）+ 25 MB 上限（base64 长度预检 + 解码后再卡） | `admin/avatar.mjs`、`admin/server.mjs:154-160` |
| 缩放 | 有 `sharp`（`createRequire` 惰性解析，面板仍零依赖）且最长边 > 512px、**且不是动图/GIF** → 等比缩到 512px 并去掉 EXIF；动图与 GIF 一律原样保存（默认参数会把动画压成静帧，见 3.5 节动图红线）；无 `sharp`/失败 → 原图 + `note` 说明 | `admin/avatar.mjs` 的 `downscaleAvatar` |
| 写配置 | `applySettings({ "profile.avatar": url }, snapshot)`：白名单 → 类型校验 → 写前快照 → 结构体检 → 回读校验；**失败时把刚写入的新图片删掉**再回滚 | `admin/avatar.mjs`、`admin/settings.mjs` |
| 发布 | 两个路径都在 `PUBLISH_SCOPE`（`public/assets`、`src/config`），点「发布」会一起提交 | `admin/publish-scope.mjs:14-20`、10.3 节 |

已知边界见 9.7 节（友链页那张图不跟着换、只认平铺路径、恢复默认不删已上传文件）。用户向说明在 `admin/README.md` 的「站点头像（上传 / 恢复默认）」一节。

### 9.9 更新公告草稿（`/api/announcement-draft` + `admin/announcement-draft.mjs`）

**要解决的问题**（用户原话）：*「在之后添加新功能或者修改现有功能后，之前访问的用户并不知道我对网站做了修改，所以需要公告来告知之前的访客。」* —— 也就是「加完功能要能方便地发一条更新通知」。

面板「公告」页顶部新增一张卡片：一个可选的「起始点」输入 + 一个「最多取多少条提交」输入 + 「生成草稿」按钮。点一下 → 读 `git log`（**只读**）→ 生成中文草稿 → **填进下面的公告表单**（新建态），人确认/删减后再点「保存」；保存后照旧走 `scheduleAutoPublish()` / 「发布」页推送，并额外提示一句「去『发布』页点『立即发布』推送，回访的老访客才能看到」。

| 环节 | 实现 | 依据 |
| --- | --- | --- |
| 路由 | `GET /api/announcement-draft?since=<sha\|YYYY-MM-DD\|天数>&limit=<1-200>`；**仅 GET**（POST/PUT → 405）；已在 `POST_BODY_FIELDS` 登记 `[]`（带字段的 POST → 400） | `admin/server.mjs:1867-1882`、`:1550` |
| 起点（默认） | 不传 `since` = 「自上次公告之后」：先取**最后一次改动 `src/config/announcements.json` 的提交** `git log -1 --format=%H -- <file>`，用它做 `<sha>..HEAD`；读不到就退化成「公告里最新的 `published` 日期」`--since=<date>`；再读不到才退化成「最近 N 条」（`N` = `limit`，默认 20，上限 200，会带 warning 说明退化了） | `admin/server.mjs` 的 `lastAnnouncementCommit` / `lastAnnouncementDate` / `announcementDraftResponse` |
| 起点（手动） | `since` 三种写法：7-40 位十六进制（=`<sha>..HEAD`，**不含该提交**）、`YYYY-MM-DD`（`--since=`，含当天）、1-3650 的天数（换算成 `--since=<今天-N 天>`）。语法非法 → **400**；语法合法但提交不存在（`git rev-parse --verify <sha>^{commit}` 失败）→ **400** | `admin/announcement-draft.mjs` 的 `parseDraftQuery` |
| 过滤规则 | 合并提交（`^Merge`）与 `chore/docs/style/ci/test/build/release/typo` **跳过**（只计数）；`feat→新增`、`fix→修复`、`perf→优化` 逐条列出；其余（`refactor`/`revert`/未知类型/非 Conventional）进「其它维护」并**原样保留** + warning | `buildAnnouncementDraft` |
| 排序 / 去重 | 组间按 `新增 → 修复 → 优化 → 其它维护`；组内保持 `git log` 顺序（新 → 旧）；同组内完全相同的要点去重并计数 | 同上 |
| 标题 | `更新：新增 N 项、修复 M 项…`（只有「其它维护」时写 `其它维护 N 项`；有破坏性变更时追加「（含破坏性变更）」）；`!` 或正文 `BREAKING CHANGE:` 都算破坏性变更 | `buildAnnouncementDraft` |
| 正文 | Markdown 分组列表：首行「本次更新共 N 项（日期）：」，随后 `### 分组` + `- 要点`（块之间空行）；scope 查表成中文前缀（`feat(admin):` → `【面板】`），认不出就原样 | 同上 |
| 中文整理 | 提交说明含中文 → 原样（去句尾标点）；纯英文 → **只映射首词**（add→新增、fix→修复、update→更新…），其余英文保留，并给 warning 要求人工润色（**不是翻译**，见 9.7 边界） | `localizeCommitText` |
| 注入防护 | 提交说明进 Markdown 前一律 `escapeMarkdownText()`：`` \ ` * _ [ ] < > # | `` 全部反斜杠转义 + 控制字符剔除，所以 `<img onerror=…>` 出来是字面量，不是标签 | `escapeMarkdownText` |
| 只读 / 降级 | 不写盘、不打快照、不发布。`git` 命令失败 → **502** + 中文原因（提示确认是 git 仓库或改填 `since`）；区间里没有可用提交 → **200** 且 `hasDraft:false`、`draft:null`，用 `message` + `warnings` 明确说明（**不会生成空公告**） | `announcementDraftResponse` |
| 响应 | `{ok, hasDraft, empty, range:{mode,label,since,limit,fetched,truncated,cap}, draft:{id,title,published,version,type,pinned,content,links}\|null, warnings[], stats, commits[], message}`；`draft.id` 形如 `update-2026-10-11-764ffbe`，满足公告 id 的既有约束 `^[A-Za-z0-9._-]+$` | `suggestDraftId`、`sanitizeAnnouncements` |
| 纯函数可复跑 | 提交解析 / 分组 / 中文整理 / Markdown 转义 / 参数校验 / id 与日期全部在 `admin/announcement-draft.mjs`（零 import，连 `node:` 都不用），`admin/server.mjs` 只负责跑 git 与拼 HTTP | `admin/announcement-draft.mjs` |

**为什么不做成「自动发布」**：草稿是机械整理出来的，质量一定不足以直接面向访客（英文提交尤其）。自动发布等于把未经人看的文案推给所有人；而且发布动作本身会 `git commit + push`，属于「写仓库」的强动作，必须由人触发（面板既有约定：写盘走快照 + 人确认）。

**没做的部分**：没有接任何翻译 API / LLM（面板零依赖 + 不联网是硬约束）；没有把草稿存成草稿文件（它只存在于表单里，不点保存就不落盘）；没有自动勾「固定为弹窗公告」（固定公告只能有一条，勾不勾是人的决定，草稿只给提示）。

### 9.10 面板里的「路径徽章」：每一类内容都能看到它的真实文件（`filePathBadge` + `/api/reveal`）

**要解决的问题**（用户原话）：*「在管理面板写明文件存放在哪。比如『这个博客的 Markdown 速查表』就没有明显的路径说明，不方便直接寻找文件。」* —— 也就是「面板里看到的每样东西，都要能一眼知道它存在仓库的哪个文件，并能直接复制 / 定位过去」。

**唯一的组件**：`admin/index.html` 的 `filePathBadge(relPath, opts)`（内联脚本，`escapeHtml` 旁边）。它返回一段 HTML：

```html
<span class="path-badge" title="src/content/posts/markdown-cheatsheet.md">
  <code>src/content/posts/markdown-cheatsheet.md</code>
  <button class="path-btn" data-copy="src/content/posts/markdown-cheatsheet.md">复制</button>
  <button class="path-btn" data-reveal="src/content/posts/markdown-cheatsheet.md">📂</button>
</span>
```

| 环节 | 实现 | 依据 |
| --- | --- | --- |
| 复制 | **文档级事件委托**处理 `[data-copy]`（徽章会被各页反复重渲染，逐个绑定必然漏）；`copyText()` 先试 `navigator.clipboard.writeText`，失败退回 `document.execCommand("copy")`，再失败就把 `<code>` 里的文本**选中**让用户按 Ctrl+C；成功后按钮上显示 **2 秒**「已复制」 | `admin/index.html` 的 `filePathBadge` / `copyText` / `flashCopied` |
| 打开所在文件夹 | `[data-reveal]` → `POST /api/reveal {path}`；后端 `resolveInside` 保证目标在**仓库内**、`fs.stat` 保证真实存在、只接受 POST；文件用 `spawnSync("explorer.exe", ["/select,", abs], {stdio:"ignore", timeout:5000})`、目录用 `[abs]`（同步等它退出：explorer 只负责把请求转给已运行的 shell，正常 100ms 内退出，退出码 1 也算成功；只有 `result.error` 才回 `ok:false`），`/select,` 与路径**必须分开传**（合并时含空格路径会被整体加引号，Explorer 退回「文档」目录）；**必须同步拿结果**——早期用 `spawn(...).unref()` 且吞掉异步 error，在启动器托管（node 无控制台窗口）的环境里进程可能根本没起来却仍返回 `ok:true`，前端弹「已定位」但什么都不会打开（2026-10-28 实测修复）；**异常退出码必须如实回 `ok:false`**：explorer 被系统拒绝时是 `0xC0000142`（常见于面板运行在**低完整性/受限环境**，例如从沙箱终端启动），服务端会再用 `whoami /groups` 判断 Low integrity 并给出「请从资源管理器双击 firefly-admin.exe 重新打开」的中文原因；**仅 Windows**（其它平台 200 + `ok:false` + 中文说明） | `admin/server.mjs` 的 `revealInExplorer` / `/api/reveal`；前端 `opts.reveal === false` 时不渲染该按钮（文件已删除 / 尚未创建 / 远程 URL） |
| 路径从哪来 | **只能来自后端**：`fs.readdir`（文章、媒体）、`git status --porcelain -z`（待提交）、实际写入路径（保存后返回的 `file`）、快照目录（`listSnapshots` 的 `dir`），或按站点约定拼好后**当场 `stat` 核对**（`publicUrlToRepoPath` / `describeLocalFiles` / `describeFriendIcons`）。前端**不许**自己拼路径。站内 URL 的 `?v=<内容哈希>` 缓存参数与 `#锚点` 必须先剥掉再拼仓库路径，否则存在的音频 / 封面会被误判成「文件不存在」 | `admin/server.mjs`、`admin/friends.mjs` |
| 不编造 | 文件不存在时如实标 ⚠️ +「文件不存在」且**不给**「打开所在文件夹」；`/api/nav` 的 `fileExists:false` 显示「（尚未创建，保存后生成）」；新建文章显示「保存后将写入 …（尚未创建）」 | `filePathBadge` 的 `note`/`warn`/`reveal` 三个选项 |
| 视觉 | `.path-badge` 用等宽小号字 + 次要色，可换行（`overflow-wrap: anywhere`）、hover 用 `title` 显示完整值，**不抢标题的视觉重心**，也不撑破既有表单 / 表格 | `admin/index.html` 的 `.path-badge` 样式 |

**覆盖到哪些页签**（新增面板展示项时按这张表对照）：

| 页签 / 位置 | 显示什么路径 | 数据来源 |
| --- | --- | --- |
| 文章列表（每篇） | `src/content/posts/<真实文件名>`（`.md` / `.mdx` 原样）+ 该文的 URL | `/api/posts` 的 `posts[].file`（`fs.readdir`） |
| 文章编辑器 | 当前文件、`src/content/posts/images`、正文 `./images/…` 引用到的图片（逐个 `stat`） | `/api/post` 的 `file` / `imagesDir` / `images[]` |
| 文章编辑器（新建） | 「保存后将写入 `src/content/posts/<slug>.md`（尚未创建）」 | `postsMeta.dir`（`/api/posts`）+ 输入框里的 slug |
| 媒体页 | 当前目录 + 每个文件的 `public/assets/...`（+ 体积、可引用的站内 URL） | `/api/media` 的 `dirs` / `files[].repoPath` |
| 公告 | `src/config/announcements.json` | `/api/announcements` 的 `file` |
| 音乐 | `src/config/music-playlist.json` + 每首歌的音频/封面/歌词真实文件 | `/api/playlist` 的 `file` / `paths[]` |
| 友链 | `src/config/friends.json`、`public/friends/` + 每个图标的 `public/friends/<文件名>` | `/api/friends` 的 `file` / `dir` / `icons[]` |
| 导航覆盖 | `src/config/nav-overrides.json`（+ `fileExists`）与只读来源 `src/config/navBarConfig.ts` | `/api/nav` 的 `file` / `sourceFile` |
| 站点设置（每一项 + 页面开关 + 横幅副标题） | `文件 → within.key`（如 `src/config/siteConfig.ts → navbar.title`、`… → waves.enable.desktop`、`siteConfig.ts → resolvePageToggles.<name>`） | `/api/settings` 的 `defs[].file/within/key` 与 `pageToggle.{file,block}` |
| 站点头像 | `src/config/profileConfig.ts → avatar` + `public/assets/images/<文件名>` | `/api/avatar` 的 `config.{file,key}` / `repoPath` |
| 体检 / 备份 | `admin-backups/<id>/` 与快照里每个文件的 `rel` | `/api/backups` 的 `dir` / `files[].rel` |
| 发布 | 「待提交的改动」逐条 `{状态码, 路径}`；发布后列出本次提交的文件与被跳过的范围外改动 | `/api/diff` 的 `files[]`、`/api/publish` 的 `files` / `skipped` |

**顺带修掉的两个真问题**（都在同一条代码路径上，属于「路径必须真实」的范畴）：

1. **`git status --porcelain` 的输出被 `trim()` 吃掉前导空格** → 第一记录的状态码与路径整体错位一个字符（`README.md` 会解析成 `EADME.md`），`stageForPublish` 里 `git add -- <错路径>` 会失败，表现为「明明有改动，发布却说没有需要提交的改动」。修法：`run()` 增加 `raw: true`（不 trim）+ 专用 `gitStatusZ()`，`admin/publish-scope.mjs` 的 `stageForPublish` 同样带 `raw: true`。
2. **体检的「Git 工作区状态」详情全是 `undefined undefined`** → `repoInfo()` 早先返回的 `files` 是字符串数组，而 `doctor.mjs` 按 `f.status` / `f.file` 取值。修法：`repoInfo()` 另外返回结构化的 `changed[{code,path,origin}]`，`doctor.mjs` 改用它。

**没做的部分**：徽章里的「打开所在文件夹」只在 Windows 上真正执行（`explorer /select,`），macOS / Linux 明确回 `ok:false` 并给出**手动路径**，不猜其它命令；不提供「在编辑器里打开」（面板不知道用户装了哪个编辑器，也不该替用户拉起任意程序）。

### 9.11 体检里的文章 frontmatter 校验（`content-frontmatter` + `content-schema`）

**要解决的问题**（真实事故）：面板发了一篇 frontmatter 写成 `published: "2026-10-11"`（多了一对引号 → YAML 当字符串）的文章，`src/content.config.ts` 的 schema 要 `Date`，CI 立刻红：

```text
src/content/posts/vmware-workstation-pro-26h1u1.md:0:0
published: Expected type `"date"`, received `"string"`
```

当时的体检**没有**校验 frontmatter，坏数据被推上去了 —— 用户等 1 分钟看到红叉，还得找人救。

| 检查项 | 级别 | 查什么 | 依据 |
| --- | --- | --- | --- |
| `content-frontmatter`（标题「文章 frontmatter（YAML 速查）」） | error / warn | **只查不依赖 schema 的通用坑**：引号把日期变字符串、日期不是 ISO / 日历上不存在、`tags` 写成字符串或 null、frontmatter 缺失或 YAML 语法坏（Tab 缩进 / 括号不配对 / 键重复 / 引号未闭合）、缺 `title`/`published`；顺带查封面图是否存在、文件名（slug）是否重复。**不枚举 schema 字段、不断言字段类型** | `admin/content-check.mjs` 的 `lintPostFrontmatter` / `buildFrontmatterCheck` |
| `content-schema`（标题「文章 schema（真实构建校验）」） | error（跑不起来时 warn） | 跑**真实的** `astro build`（`node node_modules/astro/bin/astro.mjs build --outDir .astro/doctor-build`），用 `src/content.config.ts` 的真实 schema 校验真实文件；把 Astro 的报错翻译成「文件 + 字段 + 期望类型 + 实际类型 + 怎么改」 | `admin/content-check.mjs` 的 `buildContentSchemaCheck` / `parseContentBuildErrors` |

**为什么不是「另写一套平行 schema」**（硬约束）：字段名与类型只有 `src/content.config.ts` 一个来源，手抄一份必然漂移。所以这里分两层 —— YAML 层只认「引号 / 日期写法 / 列表写法 / YAML 语法」这类**与 schema 无关**的问题（`published: "2026-10-11"` 在任何 schema 下都是字符串），**字段与类型的判定权 100% 在真实构建那一层**。新增校验项时的同步契约见附录 E.2 第 12 行。

**实测行为**（`admin/content-check.mjs` 的注释与 `%TEMP%` 测试脚本都是同一口径）：

- 反例全部命中：`published: "2026-10-11"`、`published: 2026/10/11`、`published: 2026-13-45`、`published: 2026-10-11 10:30`（带时间但没秒 → YAML 当字符串）、`tags: 虚拟机, VMware`、`tags:`（null）、少结尾 `---`、`tags: [a, b`（少右括号）、Tab 缩进、`published` 重复 → 都是 `error`，提示里带**文件 + 字段 + 怎么改**。
- 其中 `published: 2026-13-45` 是 **YAML 层比真实构建更严**的一条：Astro / js-yaml 会把「13 月」静默滚成别的日期、构建照样通过（实测 status=0），但文章日期就不是作者写的那个了，所以这里按 error 拦住。
- 4 篇真实文章、`tags` 块列表写法、块标量（`|`）里含 `[`、行尾注释 `#` 都不误报（夹具 + 真实仓库实测）。
- 失败用例约 6 秒、成功用例约 12～13 秒；超时默认 90 秒，可用环境变量 `ADMIN_DOCTOR_BUILD_TIMEOUT_MS`（毫秒）覆盖。

**发布时怎么拦住**：`publish()` 先跑 `runDoctor`，只要有任何 `error` 就直接返回 `blocked: true`（不执行任何 git 命令），并且 `message` 里带「文件 → 字段 → 怎么改」；面板「发布日志」区还会用 `filePathBadge()` 把每个文件渲染成可复制 / 可定位的路径徽章 + 「去体检页」按钮（见 `admin/index.html` 的 `renderBlockedDoctor`）。`force: true` 仍是逃生门。

**⚠️ 上面这两项是「发现」，不是「不产生」**：它们拦住的是**已经写坏的**文件。坏数据是面板自己写的 —— 写入侧的根因与修复见 **9.12 节**（同一个事故发生了两次：第一次只加了检查，第二次才修写入路径）。

### 9.12 文章保存：frontmatter 的「外科式改写」（`/api/save-post` + `admin/post-frontmatter.mjs`）

**要解决的问题**（同一个事故的**第二次**发生）：面板保存文章后 frontmatter 里的日期被加上了引号——`published: "2026-10-11"`。YAML 里加了引号就是**字符串**，而 `src/content.config.ts` 的 `posts.published` 是 `z.date()` → `astro build` 直接失败（9.11 / 12.13 节记录了第一次与当时的「只加检查」修法）。用户在面板里给正文加了一行下载链接、点保存，引号就又回来了 —— 因为**写入路径**从来没修过。

**根因（已实测，不是推测）**：旧的 `stringifyPost()` 把整份 frontmatter 用一串模板字符串重写：

```js
`${k}: ${typeof v === "string" ? `"${v}"` : v}`      // 字符串值一律加引号
```

于是表单里的日期（`<input type="date">` 给的是 `"2026-10-11"` 这个**字符串**）被写成 `published: "2026-10-11"`。为什么跑的是这条兜底分支：`readYamlModule()` 用 `import("yaml")` 找 `yaml` 包，而它**不在** `package.json` 依赖里、`node_modules/yaml` 也不存在（实测 `ERR_MODULE_NOT_FOUND`），所以永远走手写序列化。同一个函数还带来两个副作用：① 提交上来的 frontmatter 只有表单里那 9 个字段，`lang` / `comment` / `series` / `author` 等**全部被删掉**；② 块列表 `tags:`（`- 测试`）被读成空字符串，写回去就变成 `tags: []`。

**现在的策略（`admin/post-frontmatter.mjs`，零依赖纯函数）**：读目标文件**当前**的原文当基准，**只替换「值真的变了」的字段行**（连同它的续行），其余行原样保留。规则：

| 项 | 行为 |
| --- | --- |
| 面板管理的字段 | `title` / `published` / `description` / `tags` / `category` / `image` / `password` / `pinned` / `draft` —— 顺序即新建文章时的写出顺序（与仓库现有文章一致） |
| 日期字段（`published` / `updated`） | **必须写成不带引号的 `YYYY-MM-DD`**：`published` 由表单提供并在写入前用正则 + 日历双重校验（`published="2026-10-11"` / `2026/10/11` / `2026-13-45` → **400，不落盘**）；已经是 `YYYY-MM-DD` 的行**逐字节保留**，同一天的时间戳（`2026-10-10T10:30:00+08:00`）**不降级**成日期；历史遗留的带引号日期在保存时被顺手规整成不带引号（响应里返回 `notes` 说明改了哪一行）。`updated` 表单里没有，只修「被引号包住的合法日期」 |
| 值没变的字段 | 整段原样保留 —— 引号风格、块标量（`\|` / `>`）、块列表、行尾注释、字段顺序都不动（**编辑正文不会碰 frontmatter**，实测 4 篇真实文章原样保存后整文件逐字节不变） |
| 面板不认识的字段 | `lang` / `comment` / `series` / `author` / `passwordHint` / 自定义字段一律**原样保留**，不再被删 |
| 空值 | 表单里清空的字段 → 删掉那一行（这是用户的操作意图）；文件里本来没有的字段 → 按上表顺序补在末尾，**不重排**已有行 |
| 需要引号的字符串 | 只有「不加引号会被 YAML 读成别的类型 / 会语法出错」时才加（`a: b`、`#`、`123`、`true`、`2026-10-11` 等），普通中文（`技术`、含 `：`、`、`）不加 —— 与仓库现有文章写法一致 |
| 同名 key 重复 | 只管理**最后一个**（YAML 的实际取值语义），更早的重复行不替用户删；重复键本身由 9.11 的体检报 error |
| 落盘编码 | 一律 LF + `---\n<frontmatter>\n---\n\n<body>`（与旧行为一致；正文开头的空行会被吃掉一行） |

**行模型的唯一来源**：`admin/post-frontmatter.mjs` 复用 `admin/content-check.mjs` 导出的 `scanMapping()` / `readScalar()` / `splitFrontmatter()` —— 体检（只读）与保存（写入）对「什么算一个字段、哪些行属于它」必须是同一个定义，否则会出现「体检认得出这行、保存时却把它当成别的」。`parseFrontmatter()` 的兜底解析也换成了同一套（块列表因此能被表单正确回填；旧兜底读不出 `tags:` 的 `- 项目`，表单显示为空 → 保存时就把标签写没了）。

**已知边界**（没做 / 故意不做）：

- **不批量修历史坏数据**：面板不会在你没打开那篇文章时偷偷改它；坏数据由 9.11 的 `content-frontmatter` 报出来，或在你下次保存那篇时被规整。
- **目标文件真的不存在时只能按表单重写**：如果你在资源管理器里把文件删了再去保存那篇（`originalSlug` 指向的文件不存在），没有原文可当基准，frontmatter 会按表单重建 —— 面板不管理的字段（`lang` / `comment` / `series`…）就没法保留了。
- 顺带修掉 `content-check.mjs` 的 `readScalar()` 一个**真 bug**：双引号值以反斜杠结尾（`description: "a\\"`，值本身是 `a\`）时，它只看「前一个字符是不是 `\`」，把**收尾引号**误判成被转义 → 报「引号没有闭合」，而且表单回填成空、再保存就把这一行**删掉**。现在按「连续反斜杠的奇偶」判断（奇数才是转义），真实文章与 5 类合法写法零误报，6 类坏写法仍全部报 error。
- `updated` 以外的「复杂结构」（对象数组，如 `projects` 的 `link:`）不做完整建模；那些字段面板不管理，保存时原样保留。
- 块标量的值按「折叠空白后比较」判断是否被改过：用 `>` 折行的长描述只要语义没变就不会被重排成一行。
- **本文档 §9.3 / §3.9 里 `server.mjs:行号` 是写作时的快照，本来就与当前文件有 ±20 行的漂移**（实测：文档写 save-post 在 `:1734` 时，真实行号是 1755）。本次修复让 `admin/server.mjs` 从 2536 行变成 **2535 行**（净减 1 行），save-post 那个 case 现在在 `admin/server.mjs:1745-1780`。核对锚点时**按关键词检索**（`case "/api/save-post"`、`function dateNormalizeNotes`）比按旧行号跳更可靠。

### 9.13 单窗口桌面启动器（`firefly-admin.exe`）：在线重启 / 后台日志

**解决什么**：以前是「cmd 窗口跑 node + 浏览器标签页」两处；现在双击项目根目录 `firefly-admin.exe`，只出现一个无标签栏的 Chrome/Edge 窗口，node 隐藏运行，关窗口即停服务。

| 事实 | 说明 |
| --- | --- |
| 源码 / 构建 | `admin-launcher/FireflyAdminLauncher.cs`；`admin-launcher/build.cmd` 用 Windows 自带 .NET Framework `csc.exe` 编译到根目录 `firefly-admin.exe`。exe 是构建产物（`.gitignore`），换机器重新跑 `build.cmd` 即可 |
| 启动 | 单实例 Mutex；在 PATH / 常见安装位置找 Node；从 8799 起找空闲端口；生成**固定** `ADMIN_TOKEN`；设置 `ADMIN_SUPERVISED=1`；隐藏启动 `node admin/server.mjs --no-open --port=<port>` |
| 浏览器 | 优先 Chrome，其次 Edge；`--app=<URL> --user-data-dir=logs/admin-browser-profile-<浏览器>`（两种浏览器的 profile 格式不兼容，必须分开）；关闭窗口 = 浏览器进程退出 = 启动器结束 node |
| 就绪检测 | 轮询 `GET /api/health?token=…`（只读内存状态，毫秒级）：单次 5 秒、总窗口 60 秒；旧版服务端没有该接口（404）时自动退回 `/api/status`；失败会在 `logs/admin-server.log` 里写「尝试次数 + 最后错误」。**不要再拿 `/api/status` 当就绪探针** —— 它要等 GitHub Actions + pnpm 探测 + 12 个 git 子进程，2026-10-28 实测把 25 秒窗口拖爆，把「后台已启动」误判成「启动失败」 |
| 日志 | 启动器把 node 的 stdout/stderr 实时追加到 `logs/admin-server.log`；面板「后台」页通过 `GET /api/status?log=1` 读尾部（最多 128KB，去掉 ANSI） |
| 在线重启 | 面板「重启后台」→ `POST /api/status {action:"restart"}` → 服务端回包后退出 → 启动器用同端口/同 token 拉起 → 页面轮询 `/api/status` 恢复后 `location.reload()`；固定 token 让 Cookie 继续有效 |
| 刷新页面 | 「刷新界面」= `location.reload()`；静态页现在也认会话 Cookie，不会再因为地址栏没有 token 而 403 |
| 浏览器沙箱降级 | 正常先带沙箱启动；若 Chromium 以 `STATUS_BREAKPOINT` 秒退，自动用 `--no-sandbox --test-type` 重试一次并写日志（`--test-type` 隐藏 Chromium 的「不受支持的命令行标记」提示条）；只影响本机回环面板，不浏览外部网页。某些 Windows / 安全软件环境也会触发 |
| 自检 | `firefly-admin.exe --selftest`：启动后台 → 校验 `supervised` → 请求重启 → 等新 PID → 写 `logs/admin-selftest.txt`，退出码 0/1；不打开浏览器窗口 |
| 手动 node | `node admin/server.mjs` 仍可用，但没有启动器托管：`supervised:false`，「重启后台」禁用；后台日志可能为空（stdout 在终端里） |
| 管理员权限 | **启动器入口直接拦截**：检测到提权就弹窗「请不要以管理员身份运行」并退出。原因：管理员权限下 Chrome/Edge 会拒绝打开面板窗口（表现为「浏览器退出码 0」，还会因为重试多开窗口），explorer.exe 也不允许从提权进程拉起（「打开所在文件夹」必然 `0xC0000142`）；正常双击即可 |
| 低完整性目录 | 仓库目录若被打上 **Low integrity** 标签（agent 沙箱写过文件后可能出现），仓库里的 `firefly-admin.exe` 会以 Low 运行，节点进程也是 Low → 「打开所在文件夹」必然 `0xC0000142`（cmd 里手动跑 `node admin/server.mjs` 却正常，因为 node 不在该目录）。解法：把 exe 复制到普通目录（`%LOCALAPPDATA%\FireflyAdmin\`）并用 `--root="<仓库>"` 启动（桌面快捷方式）；或在仓库外编译 exe 再用**同卷 `Move-Item` 移入仓库**（rename 保留文件安全描述符，不继承目录低标签，2026-10-28 实测移入后直接双击仓库 exe 即 Medium）；或管理员执行 `icacls <仓库> /setintegritylevel (OI)(CI)Medium /T` 重置后再编译 |

> **为什么浏览器 profile 按浏览器分开**：Chrome 与 Edge 的 profile 目录格式不同；共用一个目录会出现「Chrome 秒退 / Edge 白屏」。2026-10-19 实测踩过。

> **界面外壳**：左侧分组导航 + 顶部状态栏 + 内容区卡片；明暗主题切换存在浏览器 `localStorage`（`zhihai-admin-theme`），不写站点配置。页签切换会同步更新浏览器标题。



### 9.14 音乐资源：发布前先压缩，避免 git 历史重复存储

**背景（2026-10-28 实测）**：历史里先提交了两代音乐——旧的 210 MB 高码率 mp3 + 新的 89 MB 128 kbps 版本，两代都可达，于是 `.git` 里各存一份（音乐对象 295 MB，`.git` 总计 323 MB）。做历史去重后只保留当前版本：`.git` 323→112 MB、仓库 425→214 MB。**根因不是压缩脚本，而是「先提交原始大文件、之后再压缩覆盖」这个顺序。**

| 闸门 | 行为 | 代码 |
| --- | --- | --- |
| 上传去重 | 同一目录里已有**完全相同内容**（sha256）→ 409，不写入；改名重传也一样拦 | `admin/server.mjs` `/api/upload`；`admin/music-guard.mjs` `findSameContent` |
| 高码率提示 | 上传的 mp3 > `AUDIO_MAX_KBPS`（160k）或码率读不出且 > 12 MB → 返回 `audio{bitrate,bytes,needsCompress}` + `warning` | `music-guard.mjs` `probeMp3`；前端 `admin/index.html` `uploadTo` |
| 跳过自动发布 | 上传结果 `audio.needsCompress` 时，前端**不** `scheduleAutoPublish`（避免原始文件被自动提交） | `admin/index.html` `uploadTo` |
| 发布闸门 | `/api/publish` 在体检之前检查「将被提交的 `public/assets/music/**/*.mp3`」，超限 → `{blocked:true, violations}`；`force:true` 可跳过 | `admin/server.mjs` `musicPublishGuard` |
| 歌单去重 | `POST /api/playlist` 里两首歌的 `url`（去掉 `?v=` / `#` 后）相同 → 400 | `admin/server.mjs` `/api/playlist` |

**正确顺序**：上传音频 → 面板「音乐」页「一键压缩全部音乐」（`scripts/compress-music.mjs --all`，原地重写并同步歌单里的 `?v=` 内容哈希）→ 再发布。

**为什么不能靠「压缩后覆盖」清历史**：git 是内容寻址的，旧 blob 只要还在历史 commits 里就可达；要真正清掉只能重写历史（`git filter-branch` / `git filter-repo` + force push），代价是所有提交哈希变更。所以策略是**别让原始大文件进历史**。

**已知取舍**：阈值是「>160kbps 才拦」，所以 128/160kbps 的音频可以直接发布；极少数确实要发高码率文件时：调 `/api/publish` 传 `force:true`，或直接 `git commit/push` 绕过面板发布（**面板发布页没有 force 开关**，这是故意的——正常流程就该先压缩）；但那份文件会永久留在历史里。

---

## 10. 部署链路（从本地改到线上生效）

### 10.1 这一章解决什么问题

让 agent 清楚「我改了文件 → 线上什么时候变」的完整因果链，以及**发布按钮不会提交什么**（这是最容易误解的一点）。

### 10.2 完整链路（正常路径）

```text
① 本地改内容/配置（面板 或 手写 src/config、src/content）
        ↓
② 面板「发布」页点「立即发布」（或开自动同步，保存即触发；2.5s 内合并为一次提交）
   ├─ (a) 音乐闸门 musicPublishGuard：将被提交的 mp3 若 >160kbps / >12MB → blocked（force 跳过）  server.mjs 的 musicPublishGuard
   ├─ (b) 先跑体检 runDoctor（10 项，含文章 frontmatter 的 YAML 速查 + 真实构建）
   │      有 error 级问题 → 直接拦住（不执行任何 git 命令，message 列出「文件 → 字段 → 怎么改」）  server.mjs:1284-1300
   ├─ (c) stageForPublish：只 git add 白名单内的路径             publish-scope.mjs:67-84
   │      没有文件改动但本地 ahead>0 → 跳过 (d) 不造空提交，直接走 (e) push 现有提交  server.mjs 的 publish()
   ├─ (d) git commit -m "<提交说明>"                            server.mjs:1322
   └─ (e) git fetch origin → 落后则 pull --rebase --autostash → git push   :893-922
        ↓
③ GitHub Actions 被 push 触发（.github/workflows/deploy.yml:3-7）
   ├─ 若同一分支有更早的 run：cancel-in-progress 取消它（cancelled ≠ 失败）  :15
   ├─ setup pnpm/node → pnpm install --frozen-lockfile → pnpm run build      :36-41
   └─ 非 PR：cloudflare/wrangler-action@v4 → wrangler deploy（用两个 Secret） :57-63
        ↓
④ Cloudflare 边缘：上传 dist/ 静态资源 + 部署 Worker；custom_domain 路由生效
        ↓
⑤ 访客侧生效：约 1 分钟（admin/README.md:173、server.mjs:1321）
```

### 10.3 ⭐ 发布只提交 `PUBLISH_SCOPE`（必须记住）

`admin/publish-scope.mjs:14-20`：

```js
export const PUBLISH_SCOPE = [
  "src/content",   // 文章、动态、文章自带图片
  "src/config",    // 站点设置 / 导航覆盖 / 友链 JSON / 公告 / 歌单等面板可写配置
  "public/assets", // 媒体库上传与压缩产物（图片、音乐、封面）
  "public/friends",// 友链图标
  "public/vendor", // 自托管第三方脚本（如 giscus）
  "src/constants", // 构建产物数据：LQIP 占位图（lqips.json）等，须随文章一起发布
];
```

| 行为 | 事实 | 依据 |
| --- | --- | --- |
| 只暂存白名单内的改动 | `git status --porcelain -z --untracked-files=all` → 过滤 → 分批（50 个一组）`git add -- <paths>` | `publish-scope.mjs:67-84` |
| **范围外改动会被跳过，并明确提示** | 返回体带 `skipped`，message 形如「面板管理范围内没有改动。另有 N 个改动不在面板管理范围，已跳过（不会提交）：a、b、c… —— 需要提交请用 git 命令手动处理」 | `server.mjs:1287-1298` |
| 为什么不用 `git add -A` | 会把工作区**所有**改动一起提交推送，包括改到一半的在制品；`admin/` 的半成品无害，但 `src/**` 的半成品会**直接让构建失败** | `publish-scope.mjs:4-11` |
| 为什么必须 `--untracked-files=all` | 否则 git 会把**整个未跟踪目录**折叠成一条 `public/`，导致新上传的媒体文件根本不会被暂存 | `publish-scope.mjs:62-64`（`09b0634` 实测踩到） |
| 演练模式 | `ADMIN_PUBLISH_DRY_RUN=1` 时 `DRY_RUN_PUBLISH` 为真：照常 commit，但跳过 push 并 `git reset --soft HEAD~1` 撤销提交 | `server.mjs:74,1306-1311` |

> 🔴 **给 agent 的推论**：如果你用文本工具改了 `src/styles/variables.styl`、`worker/index.mjs`、`admin/*.mjs`、`README.md`、`AGENTS.md` 等**范围外**文件，**面板的发布按钮不会提交它们**。必须用 git 命令逐个 `git add -- <file>` 后自己提交（并遵守第 1.4 节第 1 条：不要 `git add -A`）。

### 10.4 回滚手段（三条独立路径）

| # | 手段 | 适用场景 | 怎么做 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | **文件级恢复（面板快照）** | 改坏了某个配置/文章/媒体，想回到面板写入前 | 「体检 / 备份」页 → 找快照 → 「恢复 xxx」。**恢复前还会给「当前版本」再打一份快照**，所以恢复错了还能再恢复回来 | `admin/backups.mjs:184`、`admin/README.md:470-479` |
| 2 | **提交级回滚（git revert）** | 某次提交把站点搞坏了，且被后续提交压在下面 | 「体检 / 备份」页的「回滚该提交」或 `POST /api/revert {sha}`；它走 `git revert --no-edit` + 同样的 fetch/rebase/push 流程，**不改写历史** | `server.mjs:1331-1363`、`admin/README.md:391` |
| 3 | **Cloudflare 版本回滚** | CI 部署出的版本有问题（或 Worker 自身出问题） | Cloudflare 控制台 → Workers & Pages → `my-blog` → Deployments → 回滚到上一个版本 | 需在控制台操作（**需确认**具体界面文案随 CF 版本变化） |

补充：`revert` 遇到冲突时**不会硬来**，会留下冲突现场并提示手工处理（`server.mjs:1338-1345`）。

### 10.5 本地手动部署（不走 CI）

```bash
pnpm build                    # 出 dist/
pnpm exec wrangler deploy     # 首次会打开浏览器授权登录 Cloudflare
```

`README.md:953-960` 记录了这两条，并说明首次授权后会打印 `https://my-blog.<你的子域>.workers.dev`。

### 10.6 发布链路上的「需确认」

| 项 | 为什么 |
| --- | --- |
| GitHub Actions 最近一次运行的真实状态 | 面板 `/api/ci` 依赖匿名 GitHub API；本次未启动面板、也未查 GitHub，**未实测** |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 是否已配置 | 证据文件 `github.secretsReadable: 403`（GitHub 不允许匿名读 Secrets） |
| Cloudflare 侧部署历史与版本号 | 仓库无文件记录，控制台侧信息 |

---

## 11. 开发工作流、门禁与已知坑

### 11.1 这一章解决什么问题

提交前必须跑什么、跑不过时先查什么、以及在**本机环境**下有哪些工具层面的坑（npx 被执行策略挡、PowerShell 读编码、端口占用）。

### 11.2 三条门禁（提交前必须全绿）

| # | 门禁 | 命令 | 本次实测（2026-10-11，本机 Node v26.7.0） |
| --- | --- | --- | --- |
| 1 | 类型检查 | `tsc --noEmit --isolatedDeclarations`（`package.json:16`） | ✅ **exit 0**（无输出）。因为本机 `npx` 可能被执行策略挡，我用的是等价命令 `node node_modules/typescript/bin/tsc --noEmit --isolatedDeclarations` |
| 2 | Lint / 格式 | `biome ci src`（CI 口径）或 `pnpm lint`（`biome check --write ./src ./scripts`，`package.json:23`） | ✅ **exit 0**：`Checked 320 files in 143ms. No fixes applied.`（2026-10-11 复跑实测；文档早先记录的 315 是 `764ffbe` 加新组件之前的数字）。等价命令 `node node_modules/@biomejs/biome/bin/biome ci src`；本地 biome 版本 2.5.12，与 `package.json:100` 一致 |
| 3 | 构建 | `pnpm build`（`package.json:13`，8 步链路） | ✅ **2026-10-19 完整 8 步已跑通**：`pnpm build` → **exit 0 / `30 page(s) built`**（2026-10-11 为 29 页、此前 28 页，页数随文章数变化）；历史上 `704baad`/`89a4246`/`bc3f0b2`/`5123b6d` 的验收标准是「astro build 28 页」 |

`pnpm build` 的完整链路（`package.json:13`）：

```text
npx tsx scripts/generate-github-card-data.ts   # 1) GitHub 卡片数据
npx tsx scripts/generate-lqips.ts             # 2) LQIP 占位图数据 → src/constants/lqips.json
npx tsx scripts/generate-vndb-covers.ts       # 3) VNDB 封面（默认 no-op，见 CLAUDE.md:89）
astro build                                    # 4) 站点构建 → dist/（29 页；随文章数变化）
npx tsx scripts/prune-pio-assets.ts           # 5) 删 dist/ 里没用到的看板娘资源（两者都关时删掉整个 pio，约 15 MiB）
npx tsx scripts/subset-fonts.ts               # 6) 本地字体子集化
npx tsx scripts/minify-inline-scripts.ts      # 7) 内联脚本压缩
npx tsx scripts/run-pagefind.ts               # 8) Pagefind 搜索索引
```

> 第 5 步很重要：**Astro 会无条件把整个 `public/` 拷进 `dist/`**，所以「看板娘关掉了但产物里还有 15 MiB」是正常现象，靠 `prune-pio-assets.ts` 清（`CLAUDE.md:91`）。

### 11.3 `重建依赖.cmd`（本地构建炸了先跑它）

| 项 | 事实 | 依据 |
| --- | --- | --- |
| 解决的问题 | 本地 `node_modules` 与 `pnpm-lock.yaml` 不一致 → 典型报错 `require is not defined`（栈里出现 `picomatch` / `vite@8.3.4` 的 module-runner） | `README.md:987` |
| 编码 | **GBK（代码页 936）**，脚本内 `chcp 936` | 实测（`read` 工具会报 `invalid UTF-8 text`） |
| 仓库自动探测 | 判定标准：目录里**同时**有 `package.json` + `wrangler.jsonc` + `src\config`；会依次尝试脚本所在目录、上级 1/2/3 层、当前目录、第一个命令行参数 | `重建依赖.cmd` 的 `:try` 子过程 |
| 做的事 | 检查 node / pnpm（缺 pnpm 时 `npm i -g pnpm`）→ **删除 `node_modules`** → `pnpm install --frozen-lockfile` | 同上 |
| 日志 | 写到 `logs\rebuild-deps-<yyyyMMdd-HHmmss>.log`（GBK 内容、ASCII 文件名），**只保留最新 10 个**；失败时自动用记事本打开 | 同上（`skip=10` 的删除循环） |
| 影响范围 | **只影响本机本地构建**，与线上站点、GitHub Actions 无关（脚本自己打印这句话） | 同上 |
| 现存的真实日志 | `logs/rebuild-deps-20261011-124509.log`（已被 `.gitignore:20` 忽略） | 实测存在 |

### 11.4 构建可复现性（M4 修复后的约定）

| 项 | 事实 | 依据 |
| --- | --- | --- |
| 曾经的病 | 构建不可复现：`Math.random()` 生成的 id + 构建时间戳 → **每次构建有 18 个文件不同** | 提交 `bc3f0b2` 正文（M4） |
| 修法 | 稳定哈希 / 固定 id；`SiteInfo` 支持 `SOURCE_DATE_EPOCH` | `bc3f0b2`；`src/components/widget/SiteInfo.astro:54-61` |
| 现在的行为 | `SOURCE_DATE_EPOCH`（秒）> 0 时用它算构建时间，否则回退当前时间；**页面显示的构建时间信息本身不变**，只是允许外部钉死 | `SiteInfo.astro:54-62` |
| 验证口径 | 钉死 epoch 后「28 页逐字节一致」 | `bc3f0b2` |
| 行为变化提示 | 产物里 Navbar 播放器的 id 由随机变固定 | `bc3f0b2` |

想复现可复现构建：

```powershell
$env:SOURCE_DATE_EPOCH = "1760000000"
pnpm build
```

### 11.5 本机工具坑（都是实测踩过的）

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| `npx` 被执行策略挡住 | `npx tsx ...` 直接失败（Windows 上的 PowerShell 执行策略 / 应用控制） | 用 **`node node_modules/... `** 直接调二进制：`node node_modules/@biomejs/biome/bin/biome`、`node node_modules/typescript/bin/tsc`、`node node_modules/tsx/dist/cli.mjs`。本次两条门禁就是这么跑通的 |
| PowerShell 读 UTF-8/GBK 会乱码 | `Get-Content` 输出中文乱码；`read` 工具读 GBK 的 `.cmd` 直接报错 | **用 node 读**：`node -e "console.log(require('fs').readFileSync('f','utf8'))"`；GBK 文件用 `new TextDecoder('gbk')` |
| 起过 `admin/server.mjs` 忘了关 | 再起时报 `EADDRINUSE`；老进程仍占着端口，`?token=` 也是旧的 | 面板已经给了可读提示（`admin/server.mjs:2486-2493`：提示「可能已有一个管理面板在运行」并给出换端口命令）。处理：① 直接用已开着的那个窗口；② 任务管理器结束 `node.exe`；③ 换端口 `node admin/server.mjs --port=8800`。**用完记得关**，避免留下占端口的后台进程 |
| `dist/` 是陈旧产物 | 用陈旧 `dist/` 判断「某文件是否被引用」会得到错误结论 | 判断产物类问题前先 `pnpm build`；或明确标注「基于旧 dist，未重建」 |
| `git status` 折叠未跟踪目录 | 默认只显示 `public/` 一行，看不到里面新增的媒体文件 | 一律加 `--untracked-files=all`（`-uall`）；面板代码就是必须带它（`publish-scope.mjs:62-64`） |
| 手工 `git add -A` | 见 10.3 与第 12.8 节 | 逐个路径 `git add -- <paths>` |

### 11.6 开发服务器

| 命令 | 地址 | 备注 |
| --- | --- | --- |
| `pnpm dev` / `pnpm start` | `http://localhost:4321` | 改代码热更新 |
| `pnpm preview` | 预览 `dist/` 产物 | 不热更新 |
| `pnpm check` | `astro check` 诊断 | 与 `tsc` 不是一回事（`package.json:11,16`） |
| `pnpm new-post <文件名>` | 生成文章模板 | 注意 3.8 节的 `slug` 与未加引号的 `title` |
| `pnpm lqips` | 重新生成 `src/constants/lqips.json` | 手改那个 JSON 会被覆盖 |
| `pnpm admin` | 等价 `node admin/server.mjs` | `package.json:20` |

---

## 12. 关键决策与踩坑史（WHY）

### 12.1 这一章解决什么问题

**这一章最重要。** 下面每一条都是真实发生过的「现象 → 原因 → 处理」，来源是 `git log` 的提交正文与代码注释。知道 WHY，才不会把刻意的设计当成 bug「修回去」。**看到反直觉的写法（比如一个 `min()` 被换成了静态值、`lowSpec: true` 而不是把 blur 设 0），先来这里找原因。**

### 12.2 远程随机壁纸与背景视频被移除

| 项 | 内容 |
| --- | --- |
| 现象 | 首页会拉第三方资源；背景视频 36.4 MB 托管在主题作者的服务器上 |
| 原因 | ① 远程资源不可控（第三方挂掉 = 首页变慢/丑）；② 36 MB 视频对国内加载极不友好；③ CSP 为了它不得不放行 `media-src https:` |
| 处理 | `588d320`：`backgroundWallpaper.playerEnable: true → false`，**移除** `playerUrl` 里的远程地址（改成注释形式的本地方案示例，`backgroundWallpaper.ts:60-62`）。`2bf015b`：确认首页已无 `t.alcy.cc` 引用 |
| 现状（实测） | `backgroundWallpaper.ts:8` `playerEnable: false`；`dist/` 里 `t.alcy.cc` 命中 **0**；CSP 的 `media-src` 已收紧为 `'self' blob:`（`1940c1c`） |
| 遗留物 | `coverImageConfig.ts:34-38` 的 `randomCoverImage.apis` 里**仍保留** `https://t.alcy.cc/pc` 等三条外链，但 `enable: false`（`:32`）。**这是刻意保留的可选项**，不是漏删 |
| 想恢复 | 把视频放进 `public/assets/videos/`，取消 `backgroundWallpaper.ts:62` 的注释；随机封面把 `coverImageConfig.ts:32` 改 `true`。**恢复时记得同步 CSP**（视频需要 `media-src`，远程图需要 `img-src https:`，后者已在） |

### 12.3 内容宽度：`min(px, vw)` 与「兜底不能用 `min()`」

| 项 | 内容 |
| --- | --- |
| 需求 | 内容宽度随屏幕自适应，且面板可调 |
| 实现 | 实际宽度 = `min(contentWidth px, contentWidthVw vw)`，默认 `min(1600px, 94vw)`（`siteConfig.ts:73-74`），由 `Layout.astro:493-494` 以**内联 CSS 变量**注入 `<html>`（内联优先于 `:root`，所以面板改完推送即生效） |
| 踩到的坑 | 兜底值若也写 `min(1600px, 94vw)`，**Astro 的 Lightning CSS 会把它简化成裸 `94vw`、丢掉 1600px 上限**，2560px 屏会算出 2406px |
| 处理 | `src/styles/variables.styl:170` 的兜底改成**静态 1280px**，自适应交给内联变量。提交 `704baad` 的验收原文：「产物 CSS 兜底为静态 1280px、无裸露 vw」 |
| 效果（提交正文） | 1920px 屏 → 1600px；1440px 屏 → 1354px；1280px 屏 → 1203px；始终保留约 6% 边距 |
| 面板字段 | `site.contentWidth`（600-2400）、`site.contentWidthVw`（60-100） | `admin/settings.mjs:33-34` |
| ⚠️ 给 agent 的警告 | **不要把 `variables.styl:170` 的静态兜底「优化」成 `min(...)`**，也不要在别处再写一份 `min(px, vw)` 的兜底 —— 同一个压缩器副作用会再来一次。改这两个变量的唯一正确入口是 `siteConfig.ts` + 面板 |

### 12.4 低配模式：必须「移除 `backdrop-filter` 属性」，不能把模糊设 0

| 项 | 内容 |
| --- | --- |
| 现象 | 作者 i7-10875H 核显一打开网页就占约 30% |
| 第一次尝试（不够） | `2bf015b`：把 `banner.navbar.blur` 12→0、`overlay.blur` 10→0、`fullscreen.navbar.blur` 12→0、关掉 `fullscreen.blurRamp`、关掉 `waves`、关掉 `wallpaperModeSwitchable`（省 33KB/页）。**实测核显占用 30% → 20%**，仍偏高 |
| 真正的原因 | 源码里 23 处 `backdrop-filter` 大多是**硬编码值**（导航栏下拉面板用 `--navbar-panel-blur`、浮动按钮 `blur(12px)`、横幅 `blur(8px)`）；而且 **`backdrop-filter` 只要存在就会强制生成合成层**，滚动/动画时每帧重新合成 —— **把模糊半径调成 0 并不会移除这个图层** |
| 处理 | `89a4246`：新增 `src/config/perfConfig.ts`（`lowSpec: true`）+ `src/styles/low-spec.css` + `Layout.astro` 在 `<html>` 上按 `lowSpec` 追加 `low-spec` 类（`Layout.astro:165`、`:48`、`:51`）。CSS 做两件事：① `.low-spec *` 设 `backdrop-filter: none !important`（**含 `-webkit-` 前缀**）；② 停掉装饰性无限循环动画（`animate-spin-slow`/`animate-spin`/`animate-pulse`/回落箭头/kenburns/GitHub 卡片 waiting 脉冲） |
| 关键注释（原话） | 「把模糊半径调成 0 也**不会**移除这个图层，必须直接去掉 `backdrop-filter` 属性才有效」 | `perfConfig.ts:4-6`、`low-spec.css:5-7` |
| 关闭方式 | `src/config/perfConfig.ts:20` 改 `lowSpec: false`（一行恢复） |
| ⚠️ 给 agent 的警告 | 不要「优化」成 `backdrop-filter: blur(0)` 或 `filter: blur(0)`；不要删 `!important`（上游组件用的是内联/高优先级样式）；`::before`/`::after` 也要覆盖（`low-spec.css:12-14`） |

### 12.5 Live2D 看板娘为什么关闭

| 项 | 内容 |
| --- | --- |
| 现象 | 首页**无条件**引入 `<script src="/_astro/Live2DWidget...js">`，体积 **651 KB**；看板娘是常驻动画（呼吸/眨眼/动作循环），对核显是持续占用 —— 与「打开网页核显就 30%」吻合 |
| 隐蔽点 | `pioConfig` 里 Spine 已关，但 `live2dWidgetConfig.enable` 仍是 `true`，所以 `scripts/prune-pio-assets.ts` 也不会清理 `dist/` 里的 Live2D 资源 |
| 处理 | `5123b6d`：`live2dWidgetConfig.enable: true → false`（纯配置）。验收：产物首页不再出现 Live2D 脚本标签，首页少下载约 651 KB，并去掉一个持续运行的动画循环 |
| 现状 | `pioConfig.ts:6` 与 `:88` **都是 `false`** → `prune-pio-assets` 会删掉整个 `dist/pio`（约 15 MiB） |
| ⚠️ 给 agent 的警告 | 面板里**没有** Live2D 开关：原先误标为「性能 · Live2D 看板娘」的那一项已改名为 **`perf.spine`**，它**实际控制的是 `spineModelConfig.enable`**（见 4.4 节）（名实已相符，可放心使用）。要开/关 Live2D 只能改 `pioConfig.ts:88`，并预期 651 KB + 常驻动画回归 |

### 12.6 CSP 漏放 `esm.sh` 导致评论区整体打不开

| 项 | 内容 |
| --- | --- |
| 现象 | 文章页评论区加载不出来，滚到评论区也是空白 |
| 两个原因 | ① **主因**：giscus 用 `import("https://esm.sh/giscus")` 注册 `<giscus-widget>` 自定义元素，而 **动态 import 属于脚本加载**，被 CSP 的 `script-src` 直接拦掉 → 自定义元素从未注册；② 次因：Swup 换页后没有重新初始化（原实现只 `querySelector` 一次并长期持有引用，换页后节点已被替换、引用失效） |
| 处理 | ① `46cd957`：CSP 增加 `https://esm.sh`（worker + `_headers` 两份都改），并把 Swup 换页重新初始化、主题观察器去重、加载失败可读告警一并修好；② `d34f995`：**改为自托管** —— 下载 giscus@1.6.0 es2022 bundle 到 `public/vendor/giscus-1.6.0.mjs`（25 KB，核验「零外部 import、零裸包依赖」），`Giscus.astro:68` 改成 `import("/vendor/giscus-1.6.0.mjs")`，CSP **移除** `esm.sh` 回到纯第一方，`/vendor/*` 加 1 年 immutable 缓存 |
| 现状（实测） | 两份 CSP 都不含 `esm.sh`；`public/vendor/giscus-1.6.0.mjs` 存在（25318 字节）；`dist/` 里有 5 个文件引用 `/vendor/giscus-1.6.0.mjs` |
| ⚠️ 给 agent 的警告 | 看到 `dist/vendor/giscus-1.6.0.mjs` 第 1 行的 `/* esm.sh - giscus@1.6.0 */` **不要以为 CSP 还需要 esm.sh**（那只是上游打包器的 banner 注释）。要升级 giscus 必须走 1.4 节第 4 条的整包替换流程 |

### 12.7 `cancelled` 被误报为 CI 失败，且红条不消失

| 项 | 内容 |
| --- | --- |
| 现象 | 面板顶部一直挂着红色「CI 部署失败：4f95dd9」，但该 run 实际是 `completed/cancelled`（推送太快被新提交取代），之后的运行都是成功 |
| 两个原因 | ① `FAILURE_CONCLUSIONS` 含 `"cancelled"`，被取消被当成失败；② `lastFailure = runs.find(...)` 只要历史上出现过失败就永远返回它，不看其后是否有成功 |
| 处理 | `e861438`：失败集合移除 `cancelled`；改为记录最近成功与最近失败的下标，**仅当「失败比任何成功都更新」时才返回 `lastFailure`** |
| 现状 | `admin/ci.mjs:39`：`FAILURE_CONCLUSIONS = {failure, timed_out, action_required, startup_failure, stale}` |
| ⚠️ 给 agent 的警告 | 快速连续推送时看到 `cancelled` **不要当故障排查**（那是 `concurrency.cancel-in-progress` 的正常行为，`.github/workflows/deploy.yml:15`）。要判断「这次推送是否成功」，看最新一次 run 的结论，不要看历史里有没有 cancelled |

### 12.8 两个 git 坑：`git add -A` 吞在制品 + `git status` 折叠未跟踪目录

| 项 | 内容 |
| --- | --- |
| 现象 A | `publish()` 用 `git add -A`，把工作区所有改动一起提交推送。**实际已造成影响**：16:07-16:08 的 4 个「chore: 通过管理后台更新内容」提交里混进了当时正在写的 `admin/ci.mjs`（284 行）、`admin/server.mjs` 中间态，以及约 20 个 media webp 文件。`admin/` 的半成品无害，但 **`src/**` 的半成品会直接让构建失败**，Actions 一失败部署就挂 |
| 处理 A | `09b0634`：新增 `admin/publish-scope.mjs`，`PUBLISH_SCOPE` 白名单 + `stageForPublish()` 只 `git add -- <范围内路径>`（分批 50，覆盖新增/修改/删除）；范围外改动**不静默丢弃**，回传给界面明确提示 |
| 现象 B | 不带 `--untracked-files=all` 时，git 会把**整个未跟踪目录**折叠成一条 `public/`，于是新上传到 `public/assets` 的媒体文件**根本不会被暂存**（隔离测试里那个音乐封面就漏掉了） |
| 处理 B | 一律 `git status --porcelain -z --untracked-files=all`（`publish-scope.mjs:68`）；`-z` 用 NUL 分隔，能安全处理带空格/单引号/非 ASCII 的文件名（音乐封面里就有） |
| ⚠️ 给 agent 的警告 | ① 你自己提交时**不要** `git add -A`/`git add .`/`git commit -a`；② 检查工作区时**不要**只看 `git status` 的折叠输出；③ 如果你改了 `PUBLISH_SCOPE` 之外的路径（`worker/`、`admin/`、`src/styles/`、文档），**面板发布按钮不会提交它** |

### 12.9 媒体 Range 畸形值打死面板进程（C1 + M3）

| 项 | 内容 |
| --- | --- |
| 现象 | 前端拖动试听进度条（或手工构造畸形 Range）→ **整个面板进程 exit 1** |
| 原因链 | `createReadStream` 的越界参数会**同步抛** `ERR_OUT_OF_RANGE` → 冒到最外层 `catch` → 此时响应头已经发出 → 第二次 `writeHead` 抛 `ERR_HTTP_HEADERS_SENT` → 无人接管 → 进程退出 |
| 复现证据（实测，面板已修前的记录） | `%TEMP%\ff-final-repro.txt`：`Range: bytes=99999999999999-` 与 `bytes=5-1` 都导致 `面板进程: 已死亡（exitCode=1）❌`，stderr 是 `ERR_HTTP_HEADERS_SENT at sendJson (...server.mjs:1179)`（**日志原文，行号属当时那一版代码**，不要按现在的 `server.mjs` 去找） |
| 处理（`bc3f0b2`） | 新增 `parseByteRange()`（`server.mjs:1446-1467`）与 `streamFile()`（`:1475-1486`）：非法/越界 → `416` + `Content-Range: bytes */<size>`；start/end 一律夹到 `[0, size-1]`；`stream.on("error")` 兜底 `res.destroy()`；`sendJson` 与最外层 `catch` **先判 `headersSent`**；`res.on("close")` 销毁流避免 fd 泄漏 |
| 同时修掉 | **M3**：`bytes=0-99999999999999` 曾返回 `206` + `Content-Length` 谎报 100 TB 却给 0 字节；以及既有 bug：`bytes=-N` 应返回**最后 N 字节** |
| 现状（实测） | 修复后同组用例：`bytes=0-100` → `206` + 101 字节；`bytes=abc` → 忽略该头返回 `200` 全量；面板存活 |
| ⚠️ 给 agent 的警告 | `parseRange` 的「非法 → 忽略头返回 200」是**刻意的**（`worker/index.mjs:194-198` 同样如此）；`/media-file` 的 416 分支（`server.mjs:2009-2020`）注释解释了为什么不能把 start/end 直接丢给 `createReadStream`；不要为了「简洁」把这两层兜底删掉 |

### 12.10 `/api/save-post` 的 `originalSlug` 越界，真的删掉了 `README.md`（M2）

| 项 | 内容 |
| --- | --- |
| 现象 | 保存文章时可以传 `originalSlug`，它参与两件事：**删掉改名前的旧文件**、打快照 |
| 原因 | 旧实现只校验了 `slug`，**没校验 `originalSlug`** → `originalSlug="../config/navBarConfig"` 能删 `src/config` 下任意 `.md`，更宽的越界可以删仓库内任意 `.md` |
| 真实后果 | 复现时**真的删掉了仓库根 `README.md`**；后来用面板快照 + git 校验恢复（**逐字节一致**，71588 字节） |
| 处理 | `bc3f0b2`：`originalSlug` 与 `slug` 用**同一套正则** `POST_SLUG_RE = /^[A-Za-z0-9._-]+$/`（`server.mjs:117,1737-1740`）；并给 `/api/post` 的 `slug` 也补了正则（`M1`：原来会 500 且回显内部路径） |
| ⚠️ 给 agent 的警告 | 任何「会被拼进文件路径」的参数（slug、originalSlug、repoPath、id、rel、dir、filename）都**必须**先过格式/白名单校验，再做 `safeResolve`/`resolveInside`。这是本仓库反复踩过的一条线（`1940c1c` 也修了 `/api/restore` 的 `rel` 越界） |

### 12.11 路径穿越与上传白名单（`1940c1c`）

| 项 | 内容 |
| --- | --- |
| 现象 | `/api/restore` 的 `rel` 未校验（可越界读/写）；`safeResolve` 少了 `path.sep`（`../` 或同名前缀兄弟目录能绕过）；上传只按扩展名粗判，`.html`/`.svg`（可携带脚本）能传进站点目录 |
| 处理 | ① `safeResolve` 补 `path.sep`（`server.mjs:559-566`）；② 新增 `resolveInside`（先 resolve 再按绝对路径比较目录白名单，`:573-582`），`/media-file`、`/api/delete-media`、`/api/extract-audio`、`/api/upload` 全部改用它；③ `UPLOAD_EXT` 按目录细分白名单（`:154-160`），拒绝 `.html`/`.svg`；④ 访问令牌改 `timingSafeEqual` 恒定时间比较（`:585-591`） |
| 验证口径 | 安全回归 16 项全过（穿越读/删除/恢复、上传 `.html`/`.svg` 均被拒，正常上传/删除/读取/体检/设置仍可用） | `1940c1c` 正文 |
| ⚠️ 给 agent 的警告 | 新增任何「按路径读写」的接口时，**必须**用 `resolveInside(rel, [允许的前缀])`，不要自己 `path.join(REPO_ROOT, rel)` |

### 12.12 端口占用不再抛栈（`05b5c94`/`36869ea`）

| 项 | 内容 |
| --- | --- |
| 现象 | 面板已有一个实例在跑，再启动会抛未捕获的 `EADDRINUSE` 栈 |
| 处理 | `server.on("error")` 里识别 `EADDRINUSE`，打印可读提示（「可能已有一个管理面板在运行…或换个端口 `--port=8800`」）并 `process.exit(1)` | `server.mjs:2486-2493` |
| 备注 | 仓库历史里出现过成对提交（`05b5c94` 与 `36869ea` 内容相近），说明作者曾把同一修复提交两次；**读历史时不要以为漏了一个修复** |

### 12.13 面板发布了一篇坏 frontmatter 的文章，CI 红在 `published: Expected type "date"`（本次修复）

| 项 | 内容 |
| --- | --- |
| 现象 | 面板里发新文章 → 约 1 分钟后 GitHub Actions 失败：`src/content/posts/<slug>.md:0:0` + `published: Expected type \`"date"\`, received \`"string"\`` |
| 根因 | frontmatter 写成 `published: "2026-10-11"`。YAML 里**加了引号就是字符串**，而 `src/content.config.ts` 的 `posts` schema 是 `z.date()`；Astro 只在「不带引号的 `YYYY-MM-DD`」时才把它解析成日期。注意 `published: 2026-10-11 10:30`（带时间但**没秒**）也会掉进同一个坑 |
| 为什么没被拦住 | 当时的体检**完全不看 frontmatter**（唯一的文章检查只查 `title`/`published` 是否存在、日期是否以 `YYYY-MM-DD` 开头 —— 而它的正则 `["']?([^"'\n]+)` 会**吃掉引号**，所以这个坑恰好穿过）。坏数据被推上去，CI 才红 |
| 修复 | 体检新增两项（9.11 节）：`content-frontmatter`（YAML 层速查，秒级，直接给「第几行 / 哪个字段 / 怎么改」）+ `content-schema`（跑**真实的** `astro build`，用真实 schema 校验并把报错翻成中文）。`publish()` 一见到 error 就拦住（`blocked: true`，不执行任何 git 命令），`message` 与面板「发布日志」都直接列出「文件 → 字段 → 怎么改」 |
| 关键约束 | **不许另写一套平行 schema**：字段名与类型只有 `src/content.config.ts` 一个来源；YAML 层只查「与 schema 无关」的通用坑（引号 / 日期写法 / 列表写法 / YAML 语法），字段与类型一律由真实构建判定。新增体检项时按附录 E.2 第 12 行同步 |
| 实测 | 10 类坏 frontmatter 全部在发布前被拦住（含本次事故的原文），4 篇真实文章零误报；失败用例约 6 秒、成功用例约 12～13 秒；跑不起来（没装依赖 / 超时 90 秒）只给 warning，**不阻断发布也不静默通过** |
| **复发（同一事故第二次）** | 用户在那篇文章里加了一行下载链接、在面板里保存，引号**又回来了** —— 因为这次只修了「发现」，没修「**产生**」。详见 9.12 节 |
| **根修** | `admin/post-frontmatter.mjs` 取代了旧 `stringifyPost()`：① 日期由写入路径保证是**不带引号**的 `YYYY-MM-DD`（非法日期 400，不落盘）；② 只替换「值真的变了」的字段行，其余行（注释 / 顺序 / 引号风格 / 块标量 / 块列表 / 面板不认识的字段）**逐字节保留**（顺便修掉「保存一次正文就丢 `lang`/`comment`/`series`/`author`」与「块列表 tags 被写成空」）；③ 读（表单回填）与写共用同一套行模型。实测：4 篇真实文章原样保存后整文件逐字节不变；反向用例（`published: "2026-10-11"` 的文章）保存后变成不带引号；夹具里 5 类坏/新/改场景 + 真实 `astro build`（35 页）全绿 |

> **这一节的教训**（写给下一个 agent）：**「拦住坏数据」不等于「不再产生坏数据」**。当年的修法把体检加厚了一层（很有价值，也留住了），但写入端那个 `typeof v === "string" ? '"' + v + '"'` 一直在原处 —— 用户下一次点保存就会复发。修「症状会重现」的 bug 时，必须找到**它被产生出来的那一行代码**。

---

## 13. 审计与安全基线

### 13.1 这一章解决什么问题

告诉下一个 agent：**哪些东西已经被审计过、别再重复怀疑**；哪些是**已修缺陷**（不要「重新发现」再修一遍）；以及**哪些还没测**（别把「没测」说成「没问题」）。

### 13.2 已确认没有问题的清单

| 项 | 结论 | 证据来源 | 本次是否复核 |
| --- | --- | --- | --- |
| 面板受保护路由的未认证访问 | 父会话记录：「**32 个受保护路由 × 6 种凭据 = 364 条断言全部 403**」 | `%TEMP%\ff-admin-auth-test.mjs`（脚本按源码自动提取路由） | ⚠️ **部分复核 + 数量不一致**，见 13.5 节 |
| SSRF 防护 | **87/87 拦截** | `%TEMP%\ff-ssrf-test.mjs` | ✅ **本次逐行清点 = 87 条**（A 段 40 条私有主机 + A 段 16 条公网主机 + B 段 15 条协议/主机 + C 段 7 目标 ×2 + 2 条重定向检查 = 87），与记录一致 |
| 路径穿越 | 父会话记录「**32 组载荷全挡**」 | 同上脚本第 11 节 | ⚠️ 该脚本里实际是 **15 组**穿越读取 × 2 条断言 = 30 条；「32 组」可能来自其它测试文件（`ff-cc*.mjs`，本次未逐一清点）→ **需确认** |
| 上传扩展名白名单 | 成立 | `admin/server.mjs:154-160`（实测：5 个目录各自的 `UPLOAD_EXT` 正则，仅图片/音频/`.lrc`） | ✅ |
| 头像上传的**魔数校验** | 成立（新增能力，本次实测） | `admin/avatar.mjs` 的 `sniffImageFormat`：把文本/PHP 改名成 `.png`（含 `a.php.png`）一律 400 且不落盘；落盘扩展名取真实格式。38 条模块级断言 + 21 条 HTTP 断言全绿（夹具仓库，未碰真实头像） | ✅ |
| 产物内链 / 图片 / 图标零缺失 | 父会话记录 | `%TEMP%\ff-dist-check.mjs` | ⚠️ 部分复核：`dist/` 30 个 HTML（2026-10-19 新增文章后）、`dist/404.html`、`dist/vendor/giscus-1.6.0.mjs` 都在；**未跑完整内链扫描** |
| CSP 两份一致 | 成立 | 实测：`worker/index.mjs:31` 与 `public/_headers:32` 都是 **407 字符**且逐字节相同；两份都不含 `esm.sh`、都含 `giscus.app` | ✅ |
| 面板只监听 127.0.0.1 | 成立 | `admin/server.mjs:2495` | ✅ |
| 备份/日志/产物不入库 | 成立 | `.gitignore:2,5,8,20,23`（`dist/`、`public/vndb-covers/`、`.astro/`、`logs/`、`admin-backups/`） | ✅ |
| 门禁全绿 | `tsc --noEmit --isolatedDeclarations` exit 0；`biome ci src` 320 文件 0 问题（2026-10-11 复跑；此前记录 315） | 本次实测 | ✅（2026-10-11 复跑：`tsc` exit 0、`biome ci src` 0、`astro build` 28 页、`node scripts/check-docs-sync.mjs` exit 0；`admin/announcement-draft.mjs` 另跑 `biome check` 0 finding） |
| **`/api/announcement-draft` 未认证访问** | 成立（新增能力，实测） | 未带凭据 `GET` → **403**；`?token=` / `x-admin-token` / Cookie 三种凭据都能过；非法 `since` / `limit` → 400，语法合法但不存在的 sha → 400 | ✅（本次 52 条 HTTP 断言全绿，见 13.5 节） |
| **`/api/announcement-draft` 是只读的** | 成立（新增能力，实测） | 整轮请求（含 403/400/405/200 各种分支）前后：`git status --porcelain -z --untracked-files=all` **逐字节不变**、`git rev-parse HEAD` 不变、`announcements.json` 的 sha256 不变、`admin-backups/` 不新增文件 | ✅ |

### 13.3 已修缺陷清单（**不要重新修**）

来源：提交 `bc3f0b2`（`fix(security): 修复审计发现的 1 critical + 2 high + 6 中危 + 5 低危问题`）正文、`secfix-msg.txt`、`1940c1c`。

| 编号 | 级别 | 缺陷 | 修法（现状） |
| --- | --- | --- | --- |
| **C1** | Critical | `/media-file` 畸形 Range 打死面板进程 | `parseByteRange` + `streamFile` + 所有出口判 `headersSent`（12.9 节） |
| **M3** | 中危 | `bytes=0-99999999999999` 返回 206 + 谎报 100 TB `Content-Length` | 同 C1：一律夹到 `[0, size-1]` |
| **H1** | High | Worker 4 条响应路径丢失**全部**安全头（裸域 301 / legacy 301 / 媒体非 2xx / 异常兜底），与「等价于 `_headers`」的声明不符 | 新增 `withSecurityHeaders()` 收口所有出口（`worker/index.mjs:97-115`） |
| **H2** | High | **25 个 POST 路由**坏 body 一律 500 且回显内部异常（`Cannot read properties of null…`） | `httpError()` + `publicErrorText()` + `readBody` 抛 400 + `POST_BODY_FIELDS` 字段白名单 |
| **M1** | 中危 | `/api/post` 的 slug 未校验 → 500 且回显内部路径 | 400 + slug 正则 |
| **M2** | 中危 | `/api/save-post` 的 `originalSlug` 未校验 → 可删仓库内任意 `.md`（**真的删过 `README.md`**） | 同 slug 正则（12.10 节） |
| **M4** | 中危 | 构建不可复现（`Math.random()` id + 构建时间戳 → 每次 18 个文件不同） | 稳定哈希 / 固定 id + `SOURCE_DATE_EPOCH`（11.4 节） |
| **M5** | 中危 | `/api/ci` 每次发约 10 个 GitHub 请求打爆匿名配额，且限流被显示成 `pending` | 1 次 `actions/runs` 按 `head_sha` 归并 + 识别 403/429 与 `x-ratelimit-remaining` → `rateLimited`（8.6 节） |
| **M6** | 中危 | 预览的 Markdown 链接未过滤协议（`javascript:` 存活） | 新增 `safeMarkdownUrl()` |
| **L1** | 低危 | legacy 跳转大小写敏感 | 改大小写不敏感（`worker/index.mjs:84-90`） |
| **L4** | 低危 | friends 抓取的**模块级** meta 缓存串页 | 改为每请求独立 |
| **L5** | 低危 | 图标重定向用 `follow`，会把请求打到内网 | 改 `manual` 并**每跳**重新校验（`admin/friends.mjs`） |
| **L6** | 低危 | `save-lyrics` 没有快照（唯一漏掉的一处） | 补 `snapshotBefore`（`server.mjs:1928`） |
| **L7** | 低危 | `/api/logout` 免认证 | **保留**免认证，但写明设计原因（`server.mjs:1633-1634`） |

> 编号口径提醒：`bc3f0b2` 的标题说「1 critical + 2 high + 6 中危 + 5 低危」= 14 项，但正文实际列出 **16 个编号**（C1/M3 合并、L7 额外）。父任务给 agent 的清单只列了 12 个（缺 M3、L7）。**以本表为准（15 行，含 C1 与 M3 分列）**，口径差异已在 13.6 节记录。

修完的验证口径（`bc3f0b2` 正文）：Lead 独立复现 C1/H2/M2/M1 共 11 项全通过（含「打完畸形 Range 后面板仍活着」）；子任务 11 个测试文件 / 201 条断言全绿（测试文件在 `%TEMP%`，**未入库**）；`tsc` 0 错误；`biome ci src` 0；`astro build` 28 页；`README.md` 与 HEAD 逐字节一致。

### 13.4 仍未覆盖 / 未验证（**别把「没测」当「没问题」**）

| # | 未覆盖项 | 说明 |
| --- | --- | --- |
| 1 | **真实 Cloudflare 边缘未做系统测试** | 本次只有 4 条实测（200 / 404 / 206 Range / 301），且来自父 agent 的一次性采集。未测：大文件 Range 边界、`If-None-Match` 304、并发、`HEAD`、`405`、`416` 的线上表现、边缘缓存 TTL 实际行为 |
| 2 | **多文件批次写入的原子性** | 面板多处「一次请求改多个文件」（如 `/api/settings` 批量改同一文件的多字段、`/api/save-post` 同时写新文件+删旧文件）**没有事务语义**：中途失败可能留下部分写入。现有的兜底是「每个文件写前快照 + 写后回读校验 + 单文件失败立即用原文回滚」 |
| 3 | `admin/index.html` 其余 `innerHTML` 未逐一做浏览器级验证 | 已知修过的是「媒体列表文件名补 `escapeHtml`」（`1940c1c`）、CI 横幅外部文本 `escapeHtml`（`admin/README.md:458`）。其余渲染点未逐个在浏览器里做过注入验证 |
| 4 | 真实 GitHub 侧状态未验证 | 分支保护、Secrets 是否配置、最近 Actions 结果：全为 403 或未查询（8.7 节） |
| 5 | 线上 CSP 全文未逐字节比对 | 证据文件把 CSP 值截断了（`…style-src 'self' 'unsafe-inli…`）；只能确认**前缀一致**，完整比对需 `curl -I` 复测 |
| 6 | `pnpm build` 本次未跑 | 见 11.2 第 3 条；`dist/` 是否为当前 HEAD 的产物**未确认** |
| 7 | 面板端到端流程本次未复跑 | 未启动 `admin/server.mjs`（原因：`ff-admin-auth-test.mjs` 第 12 节包含**真实上传请求**，会写 `public/assets/` 下的文件，违反本次「只改两个文件」的约束），因此 `/api/*` 的运行时行为以源码与历史记录为准 |
| 8 | `friends-fetch` 的 DNS 重绑定窗口 | 设计上明确不覆盖（9.7 节） |
| 9 | **「更新公告草稿」的中文质量没做过人工润色验证** | 它只做「英文首词 → 中文动词」的机械映射（见 9.7 边界），产出必然需要人改；本次只验证了结构与转义，没有、也无法验证「读起来像不像人写的」——这正是草稿必须经人确认才保存的原因 |
| 10 | 草稿在**前端**的交互只做了静态校验 | `admin/index.html` 的语法（`vm.Script`）、id 唯一性、`$()` 引用完整性都是静态检查；「点按钮 → 表单被填 → 保存 → 发布」这条完整点击流没有跑浏览器自动化（无浏览器驱动依赖可用） |

### 13.5 审计脚本与断言数量的核对（含不一致说明）

| 脚本（`%TEMP%`，未入库） | 父会话概述 | 本次逐行清点 | 差异说明 |
| --- | --- | --- | --- |
| `ff-admin-auth-test.mjs` | 「32 个受保护路由 × 6 种凭据 = 364 条断言全部 403」 | 脚本从源码提取 **33 条** `/api` 路由（32 条在 switch 内 + `/api/logout`）；断言总数 **488 条**，其中「必须 403」的 **330 条**（§1 无凭据 33×2=66；§2 错令牌 33×3=99；§3 伪造 Cookie 33×5=165） | 两个数字都对不上：`32 × 6 = 192 ≠ 364`；脚本结构也数不出 364。**结论：路由数 33（其中 32 个受保护）可信；「364」需以实际运行脚本的输出为准 → 标注需确认**。注：这是**父会话当时的清点**；新增 `/api/avatar` 后为 34 条（33 个受保护），再新增 `/api/announcement-draft` 后为 35 条（34 个受保护），**再新增 `/api/reveal`（路径徽章的「打开所在文件夹」）后为 36 条（35 个受保护）**，再新增 `/api/health`（启动器就绪探针，2026-10-28）后为 **37 条（36 个受保护）**，见 9.3 节 |
| `ff-draft-unit.mjs`（本次新增，`%TEMP%`，未入库） | —— | **136 条断言全绿**：提交解析（各种 Conventional 形态 / 空 subject / 超长行 / 多行 body / 合并提交 / RS 伪造记录）、分组与排序、去重、Markdown 转义（`#` `*` 反引号 HTML 标签）、`parseDraftQuery` 全部参数分支、日期与 id 生成；外加 `admin/index.html` 的 `vm.Script` 语法检查、id 唯一性、`$("…")` 引用完整性 | ✅ 一致（本次实跑） |
| `ff-draft-e2e.mjs`（本次新增，`%TEMP%`，未入库） | —— | **52 条断言全绿**：真实起 `node admin/server.mjs --port=8799 --no-open`，验证未认证 403 / 非法参数 400 / 不存在的 sha 400 / POST 405 与带字段 400 / 正常 200（固定 `since=2d0b39e` 让标题稳定为「更新：新增 1 项」）/ 空区间 `hasDraft:false` / `?token=` 认证 / 既有 `/api/announcements` 未被破坏；并做只读验证（见 13.2 那两行） | ✅ 一致（本次实跑） |
| `ff-ssrf-test.mjs` | 「87/87 拦截」 | **87 条**（40+16+15+14+2） | ✅ 一致 |
| `ff-final-repro.mjs` / `.txt` | 「媒体 Range 畸形值曾打死面板进程」 | 复现记录完整：`bytes=99999999999999-`、`bytes=5-1` → `exitCode=1`；修复后同组用例存活 | ✅ 一致 |
| `ff-cc2/3/4.mjs`、`ff-determinism.mjs`、`ff-dist-check.mjs`、`ff-config-check.mjs`、`ff-worker-*.mjs`、`ff-xss-proof.mjs`、`ff-ci-check.mjs` 等 | 分散在 `bc3f0b2`、`1940c1c`、`f040d66` 的验收段落里 | 本次**未逐一清点** | 「201 条断言全绿」「路径穿越 32 组」这类总数以这些脚本为准 → **需确认** |

> 为什么没有复跑：这些脚本需要先启动 `admin/server.mjs`（占端口、且 `ff-admin-auth-test.mjs` 含真实上传写盘），与本次「不修改其它文件」的约束冲突。**要复跑，请在一个干净的工作区副本里做**（先 `git status --short --untracked-files=all` 留底，跑完再对一遍）。

### 13.6 我读出来的「文档/历史与代码不一致」汇总

| # | 位置 | 不一致 | 影响 |
| --- | --- | --- | --- |
| 1 | `admin/settings.mjs:60` | `perf.live2d` 的 `within: "pioConfig"` 实际解析到 `spineModelConfig` 块（4.4 节，已实测） | 面板那个开关控制错了对象（**功能缺陷**）→ **已修：改名 `perf.spine` + `within: "spineModelConfig"`**（见 4.4 状态行） |
| 2 | `README.md` 第 8.3 节标题、第 5 节目录树注释 | 写「**九个**页签」，实际 **10 个**（`admin/index.html:213-222`） | 误导阅读者 |
| 3 | `d34f995` 提交正文 | 声称「遍历产物…`esm.sh` 命中数为 **0**」，实测 `dist/` 全文搜索有 **1 处**（`dist/vendor/giscus-1.6.0.mjs:1` 的 banner 注释 `/* esm.sh - giscus@1.6.0 */`） | 数字口径不同（引用 vs 注释文本），但会让人以为有残留依赖 |
| 4 | `src/config/siteConfig.ts:311` | `mal.clientId` 的值里**以一个制表符开头**（`"\t0ef34371450f9c6c809deaadec6aa8f3"`），实测确认 | 可能让 MAL API 鉴权失败；**需确认**是否为有意为之（看起来是复制粘贴带入） |
| 5 | `bc3f0b2` 标题 vs 正文 | 标题说 14 项（1+2+6+5），正文列了 16 个编号（含 M3、L7）；父任务转述的清单只有 12 个（缺 M3、L7） | 编号口径混乱，容易漏读已修项（13.3 节已列表归正） |
| 6 | `AGENTS.md` / `CLAUDE.md` | 多处与现状不符（2.5 节：`--isolatedDeclarations`、build 步骤、`Firefly-Docs` 目录不存在、Vercel 部署、"lint 只针对 ./src"） | 上游文件，**不要照抄** |
| 7 | `bc3f0b2` 正文 | 说「25 个 POST 路由」坏 body 会 500；实测 `POST_BODY_FIELDS` 是 **31** 条、POST 可执行的 switch 路由也多于 25 | 属历史快照口径，不影响修复本身 |
| 8 | 父任务描述 | 说 `src/config` 有「14 个」文件、`admin/` 有「9 个页签」 | 实测分别是 23 个 `*Config.ts`（含 `backgroundWallpaper.ts` 共 25 个 `.ts`、31 个文件）与 10 个页签 |

---

## 附录 A：快问快答（27 条）

| # | 问题 | 答案（含位置） |
| --- | --- | --- |
| 1 | **想加一个友链，改哪？** | 优先：面板「友链」页 → 新增（写 `src/config/friends.json`，`admin/friends.mjs`）。手工：直接编辑 `src/config/friends.json`，字段见 `friendsConfig.ts:9` 与 `admin/README.md:535-544`（`title` ≤60 字、`siteurl` 只允许 http(s)、`imgurl` 必填、`weight` -999~999）。图标要放进 `public/friends/` 再填路径（**面板不能上传到这个目录**） |
| 2 | **想调页面宽度 / 内容宽度，改哪？** | 面板「站点设置」：`site.pageWidth`（rem，50-200）、`site.contentWidth`（px，600-2400）、`site.contentWidthVw`（%，60-100）。手工等价位置：`siteConfig.ts:71,73,74`。⚠️ **不要动 `variables.styl:170` 的 1280px 静态兜底**（12.3 节） |
| 3 | **构建失败先查什么？** | ① 本地 `node_modules` 是否与 lockfile 一致 → 跑 `重建依赖.cmd`（11.3）；② 面板「体检」页看 10 项检查（JSON 合法性、歌单/文章引用、**文章 frontmatter（YAML 速查 + 真实构建）**、站内链接、密钥、大文件、配置矛盾、git 状态，`admin/doctor.mjs:79-345`、9.11 节）；③ 看你改的是不是 `src/config/*.ts` 这种一改就可能破语法的地方；④ 跑三条门禁（11.2）定位是类型、lint 还是构建 |
| 4 | **面板起不来？** | 先看是不是 `EADDRINUSE`（提示已写在 `server.mjs:2468-2470`）：① 用已经开着的那个窗口；② 结束任务管理器里的 `node.exe`；③ 换端口 `node admin/server.mjs --port=8800`。注意默认端口是 **8799**（`server.mjs:72`），别名里写的 8899 只是示例 |
| 5 | **评论区空白？** | 按 12.6 节的排查顺序：① 浏览器控制台有没有 **CSP 报错**（要改就改 `worker/index.mjs:31`，改 `_headers` 无效）；② `public/vendor/giscus-1.6.0.mjs` 是否真的部署上去了（`Giscus.astro:68` 的 import 是否 200）；③ `commentConfig.ts:57,59,63` 的 `repo` / `repoId` / `categoryId` 是否与 GitHub Discussions 配置一致；④ Swup 换页后重新初始化是否还在（`Giscus.astro:85-91`） |
| 6 | **音乐不能拖进度条 / 不能边下边播？** | 这是 Workers 静态资源不处理 `Range` 的固有问题，必须靠 Worker：确认 `wrangler.jsonc:11` 的 `run_worker_first: true` 还在、`worker/index.mjs:59-61` 的 `/assets/music/` 分支还在。`README.md:988` 有同样的问答 |
| 7 | **想新增一个导航菜单项？** | **只能改 `src/config/navBarConfig.ts`**（面板不支持新增，`admin/nav.mjs:99`）。在 `getDynamicNavBarConfig()` 里加项，**必须写显式 `id`**，否则面板读不到它（`navBarConfig.ts:17-130`）。加完可以再用面板做隐藏/改名/排序 |
| 8 | **想改站点标题 / 副标题 / 主题色？** | 面板「站点设置」：`site.title`、`site.subtitle`、`site.description`、`site.keywords`、`navbar.title`、`theme.hue`、`theme.defaultMode`（`admin/settings.mjs:26-37`）。等价位置 `siteConfig.ts:45-66,114` |
| 9 | **文章链接 404 / 我换了文件名？** | URL 由文件路径决定（3.4 节）。重命名 = 旧链接失效；Worker 只处理 `/blog/*` 的历史跳转（`worker/index.mjs:84-90`），不会自动给任意旧 URL 兜底。要保留旧链接就在 `worker/index.mjs` 的 `legacyRedirect()` 里加规则 |
| 10 | **想给文章配图，放哪？** | 三种都行（3.5 节）：放进 `src/content/posts/images/` 然后正文写 `./images/xxx.png`（面板上传走这里）；封面可放 `src/assets/...`（走优化）；站点级图片放 `public/assets/images/` 并用 `/assets/images/...` 引用。**动图必须放 `public/`** |
| 11 | **想改主页横幅文字？** | 面板「站点设置」：`wallpaper.title`（主标题）、`banner.subtitles`（副标题，每行一条）。等价位置 `backgroundWallpaper.ts:75,79-84`。打字机开关在 `:87-98` |
| 12 | **想开/关某个页面（相册、动态、打赏…）？** | 面板「站点设置 → 页面开关」（`pages.*`，从 `siteConfig.ts:10-41` 的 `resolvePageToggles` 动态读取）。等价位置 `siteConfig.ts:14-40`；也可用环境变量 `PUBLIC_PAGES_<KEY>`（`page-toggle-utils.ts:18-44`）。**关掉页面会同时隐藏对应导航项并返回 404**（`siteConfig.ts:9` 注释） |
| 13 | **想改 CSP 放行一个新域名？** | 改 `worker/index.mjs:31`（**唯一生效处**），并**同步**改 `public/_headers:32` 保持一致；在旁边的注释里写清为什么放行（`public/_headers:13-23` 就是先例）。改完建议先临时改成 `Content-Security-Policy-Report-Only` 观察，再正式生效 |
| 14 | **换了域名要改哪几处？** | 四处：`siteConfig.ts:51`、`wrangler.jsonc:17-26`、`worker/index.mjs:16-17`、`public/.well-known/security.txt`（7.5 场景 B） |
| 15 | **面板点了「发布」，线上没变？** | ① 看返回的 message 里有没有「**已跳过**」——你改的文件可能在 `PUBLISH_SCOPE` 之外（10.3）；② 看 Actions 是否成功（面板 CI 横幅）；③ 等约 1 分钟；④ 确认 `git push` 真的成功（面板会提示「已推送到 GitHub」）；⑤ 若是 HTML 缓存问题，确认没有在 Cloudflare 加了「Cache Everything」类规则（6.7 第 4 条） |
| 16 | **面板红条说 CI 失败？** | 点击展开看「是哪个 job 的哪个 step 挂了」（9.6）。若结论是 `cancelled`，那是并发取消、**不是失败**（12.7）；红条本应自动消失（`e861438` 之后）——若仍挂着，检查 `admin/ci.mjs:39` 的失败集合与 `ciStatus()` 的「失败 vs 成功谁更新」逻辑有没有被改回去 |
| 17 | **想回滚某次改动？** | 三条路（10.4）：文件级用面板快照「恢复」；提交级用「回滚该提交」（`git revert`，不改写历史）；部署级用 Cloudflare 控制台回滚 Worker 版本 |
| 18 | **误删了文件想恢复？** | 面板「体检 / 备份」页找快照恢复；如果面板也没快照，用 git：`git log --diff-filter=D --name-only` 找到删除它的提交，再 `git checkout <sha>^ -- <path>` |
| 19 | **本地报 `require is not defined`（栈里有 `picomatch`/`vite`）？** | 跑 `重建依赖.cmd`（删 `node_modules` + `pnpm install --frozen-lockfile`，日志进 `logs/`）。等价手工命令：删 `node_modules` 后 `pnpm install --frozen-lockfile`（11.3、`README.md:987`） |
| 20 | **想让看板娘回来 / 想关掉毛玻璃？** | 看板娘：改 `pioConfig.ts:88`（Live2D）或 `:6`（Spine）——⚠️ 面板那个「性能 · Live2D」开关控制的是 Spine（4.4 节）。毛玻璃：`perfConfig.ts:20` 的 `lowSpec` 改 `false` 恢复全部玻璃态；只想调某一处 blur 就改 `backgroundWallpaper.ts:169,179,196`（但注意 12.4 节：改半径不等于去掉合成层） |
| 21 | **想加一首歌？** | 面板「音乐」页上传（自动抽封面/歌词并写 `src/config/music-playlist.json`）。手工：文件放 `public/assets/music/`，在 `music-playlist.json` 加一条（字段 `name/artist/url/cover/lrc`，实测样例带 `?v=<哈希>`）。单曲建议 ≤ 10 MB（Cloudflare 单资源上限 25 MiB，`musicConfig.ts:11`） |
| 22 | **提交前该跑什么？** | 三条门禁（11.2）：`tsc --noEmit --isolatedDeclarations`、`biome ci src`、`pnpm build`（28 页）。若无法用 `npx`，用 `node node_modules/...` 等价命令。**改了两个门禁都不会覆盖的文件（如 `worker/`、`admin/`、文档）时，更要手动跑，因为 CI 不检查它们** |
| 23 | **想换站点头像？** | 面板「站点设置 → 站点头像」→「上传新头像…」（支持 png/jpg/jpeg/webp/avif/gif，≤25 MB；静态大图自动缩到最长边 512px，动图/GIF 不缩）。它会**另存新文件**并改写 `profileConfig.ts:14` 的 `avatar`，原头像保留，可「恢复默认」（9.8 节）。手工等价：把图片放进 `public/assets/images/`，再改 `profileConfig.ts:14` 为 `/assets/images/<文件名>`（动图**必须**走 public，见 3.5 节红线） |
| 24 | **面板能上传友链图标吗？** | **不能**。`public/friends/` 只在 `/media-file` 的**只读**白名单里（`MEDIA_READ_DIRS`），请手工放文件再填路径（9.7 节） |
| 25 | **我加了新功能，怎么让回访的老访客知道？** | 面板「公告」页顶部「**从最近改动生成更新公告草稿**」：留空起始点 = 自「上次公告」之后（取最后一次改动 `announcements.json` 的提交），也可手填「提交 sha / 天数（如 30）/ 日期 2026-10-01」。点「生成草稿」→ 它会读 `git log`（**只读**）把 `feat:` / `fix:` / `perf:` 分成「新增 / 修复 / 优化」填进下面的表单（`chore:` / `docs:` / 合并提交跳过），**不会自动发布**：确认/删减后点「保存」，再去「发布」页推送即可上线（想让它顶掉首访弹窗就手动勾「固定为弹窗公告」，同时改「弹窗版本号」）。细节与边界见 9.9 节 |
| 26 | **发布后 CI 红了，但本地看着没事？（`published: Expected type "date", received "string"`）** | 多半是文章 frontmatter 的**类型**问题，最常见就一个：日期被引号包住 —— `published: "2026-10-11"` 在 YAML 里是**字符串**，而 schema 要日期（9.11 节、12.13 节）。**面板现在会在发布前就拦住它**：体检页看 `content-frontmatter`（YAML 速查，秒级，直接告诉你「第几行、哪个字段、怎么改」）与 `content-schema`（跑一次真实 `astro build`，报「期望 date / 实际 string」）。修法：**去掉引号**写成 `published: 2026-10-11`；改完再点「体检」→ 全绿再发。要本地复现 CI 的报错就跑 `node node_modules/astro/bin/astro.mjs build` |
| 27 | **为什么我在面板里保存一篇文章，日期就变成 `published: "2026-10-11"` 了？（面板自己写出来的坏数据）** | 这是**写入路径**的 bug，不是你的操作问题：旧的面板保存时会用模板字符串重写整份 frontmatter，**给每个字符串值无条件加引号**（日期在表单里就是一个字符串），所以每次保存都会把日期变成 YAML 字符串 → 构建报 `published: Expected type "date", received "string"`。同一个 bug 还会顺手删掉表单里没有的字段（`lang` / `comment` / `series` / `author`）并把块列表 `tags:` 写空。**已修**：`admin/post-frontmatter.mjs` 改成「只改真正变了的字段、其余行逐字节保留」，日期由写入路径保证是**不带引号的 `YYYY-MM-DD`**（非法日期 400 不落盘）。完整根因、规则与实测见 **9.12 节**；如果是**历史遗留**的坏文件，面板下次保存那一篇时会顺手规整并在提示里说明（不会偷偷批量改你的文件，也可用体检的 `content-frontmatter` 逐篇查） |

---

## 附录 B：「需确认」清单汇总（按章节）

> 规则：以下内容**无法**从仓库文件或 `%TEMP%\project-evidence.json` 核实，正文相应位置都标了「需确认」。不要把它们当成事实复述。

| # | 章节 | 需确认项 | 为什么无法验证 |
| --- | --- | --- | --- |
| 1 | 6.3 / 7.4 | NS 主机名（父 agent 记录为 `gordon/karina.ns.cloudflare.com`） | 证据文件 `dns.zhihaisblog.top/NS` = `{"error":"TypeError"}`；仓库内 `grep gordon\|karina` 无命中 |
| 2 | 6.3 / 7.4 | A/AAAA/CAA/DS/TXT/MX 记录、RDAP 注册数据 | 证据文件 DNS 段全部 `TypeError`、`rdap` 段 `SyntaxError` |
| 3 | 6.7 | SSL/TLS 模式、Always Use HTTPS、缓存规则、DNSSEC DS 算法、CAA、Bot Fight/Rocket Loader 等 | 纯 Cloudflare 控制台状态，仓库无对应文件 |
| 4 | 7.4 | 阿里云账号/持有人/实名状态/到期日/自动续费/转移锁/是否存在重复解析 | 仓库无凭据、无截图、RDAP 采集失败；**父任务要求不得编造账号或备案号** |
| 5 | 7.3 | 是否需要 ICP 备案 | 属合规判断，仓库内无任何可核实证据（**本文不作断言**） |
| 6 | 8.7 | 分支保护是否开启、两个 Secret 是否已配置、最近 Actions 结果 | 证据文件 `branchProtection: 403`、`secretsReadable: 403`；本次未查询 GitHub |
| 7 | 13.2 / 13.5 | 「32 个受保护路由 × 6 种凭据 = 364 条断言」与「路径穿越 32 组载荷」 | 脚本逐行清点为 33 路由 / 488 断言（其中 330 条是 403 断言）、单脚本穿越载荷 15 组；与概述对不上，且未复跑脚本。**本次新增 `/api/avatar` 后路由总数为 34（33 个受保护）；再加 `/api/announcement-draft` 与 `/api/reveal` 后为 36（35 个受保护），见 9.3 节** |
| 8 | 13.4 | 真实 Cloudflare 边缘的系统测试、多文件批次写入原子性、`admin/index.html` 其余 `innerHTML` 的浏览器级验证 | 本次未做（原因见 13.4/13.5） |
| 9 | 13.4 | 线上 CSP 全文逐字节一致性 | 证据文件把 CSP 值截断，只能确认前缀 |
| 10 | 11.2 | `pnpm build` 本次是否通过 / `dist/` 是否是当前 HEAD 的产物 | 未重建（`dist/` 已被 gitignore） |
| 11 | 13.6 #4 | `siteConfig.ts:311` 的 `mal.clientId` 前导制表符是否为有意 | 只能确认字符存在，无法确认作者意图 |
| 12 | 10.6 | Cloudflare 部署历史/版本回滚界面文案 | 控制台侧信息 |

---

## 附录 C：交付前自查（本文档的证据）

### C.1 文档里的路径是否真实存在（抽查 ≥20 个）

用一条 PowerShell 脚本对 **89 个**路径做 `Test-Path`（仓库根为基准），结果：**缺失 0 个**。抽查清单（全部为 True）：

```text
admin\server.mjs                   admin\index.html                  admin\README.md
admin\publish-scope.mjs            admin\nav.mjs                     admin\settings.mjs
admin\doctor.mjs                   admin\backups.mjs                 admin\ci.mjs
admin\zip.mjs                      admin\friends.mjs                 admin\import-doc.mjs
admin\media-compress.mjs           admin\audio-meta.mjs
worker\index.mjs                   wrangler.jsonc                    astro.config.mjs
package.json                       pnpm-lock.yaml                    pagefind.yml
biome.json                         tsconfig.json                     .gitignore
.npmrc                             postcss.config.mjs                svelte.config.js
vercel.json                        pnpm-workspace.yaml               _frontmatter.json
.github\workflows\deploy.yml       .github\dependabot.yml
public\_headers                    public\_redirects                 public\vendor\giscus-1.6.0.mjs
public\friends                     public\assets\music               public\assets\images
public\assets\music\cover          public\assets\music\lrc           public\pio
public\gallery                     public\favicon                    public\.well-known\security.txt
src\content.config.ts              src\config\siteConfig.ts          src\config\navBarConfig.ts
src\config\nav-overrides.json      src\config\perfConfig.ts          src\config\announcements.json
src\config\friends.json            src\config\music-playlist.json    src\config\FooterConfig.html
src\styles\low-spec.css            src\styles\variables.styl         src\layouts\Layout.astro
src\components\comment\Giscus.astro  src\components\widget\SiteInfo.astro
src\utils\display-settings-utils.ts  src\utils\page-toggle-utils.ts  src\utils\site-config-utils.ts
src\types\navOverrides.ts          src\constants\lqips.json          src\content\spec\announcement.md
scripts\new-post.js                scripts\new-dynamic.js            scripts\generate-lqips.ts
scripts\generate-vndb-covers.ts    scripts\generate-github-card-data.ts
scripts\prune-pio-assets.ts        scripts\subset-fonts.ts           scripts\minify-inline-scripts.ts
scripts\run-pagefind.ts            scripts\site-root.ts              scripts\compress-music.mjs
scripts\quarantine-bad-posts.mjs
重建依赖.cmd                        启动管理面板.cmd                   README.md
AGENTS.md                          CLAUDE.md                         CONTRIBUTING.md
CREDITS.md                         LICENSE                           UPSTREAM-README.md
logs\rebuild-deps-20261011-124509.log   dist                           dist\404.html
dist\vendor\giscus-1.6.0.mjs       admin-backups                     node_modules
```

额外核对：`_friends_patch.json` 与 `WorkSpace_tmp_friends.json`（历史上误提交过、后由 `4459395` 删除）**现在都不存在** ✅。

**自动扫描的完整口径**（脚本从本文档反引号片段里抽路径再 `Test-Path`，共读出 207 个路径类 token，其中 107 个「像文件/目录」）：

| 结果 | 数量 | 说明 |
| --- | --- | --- |
| 解析为仓库内真实路径且存在 | **71** | 例如 `admin/server.mjs`、`worker/index.mjs`、`src/config/navBarConfig.ts`、`public/vendor/giscus-1.6.0.mjs`、`dist/vendor/giscus-1.6.0.mjs`、`logs/rebuild-deps-20261011-124509.log` |
| 不是仓库路径（通配简写 / URL 前缀 / 占位示例 / 仓库外） | **36** | 逐类已核对，**没有一个是真正写错的路径**：① 通配简写 `src/config/{announcements,friends,music-playlist}.json`；② URL 前缀 `/posts/hello-world/`、`/blog/`、`/archive/`、`/_astro/`、`/pagefind/`、`/cover/`、`/page/N/`；③ 占位示例 `assets/images/foo.webp`、`./images/xxx.png`、`src/content/posts/wo-de-di-yi-pian.md`（`new-post` 的示例输出）、`posts/a/b.md`；④ 仓库外 `%TEMP%\project-evidence.json`、`%TEMP%\ff-*.mjs`（已单独确认这些文件在 `%TEMP%` 下真实存在）；⑤ **刻意引用其不存在**的目录 `Firefly-Docs/`、`Firefly-docs/`（2.5 节就是要说明它们不存在）、`public/vndb-covers/`（`.gitignore:5` 里被忽略的生成目录，当前确实不存在）、`public/assets/videos/`（3.9/12.2 节说的「想恢复视频就放这里」） |

### C.2 `/api/*` 路由表与 `admin/server.mjs` 实际注册数量一致

**统计方式**（脚本化，可复现）：

```js
const cases = [...new Set([...src.matchAll(/case\s+"(\/api\/[^"]+)"/g)].map(m => m[1]))];   // → 36
const preSwitch = [...new Set([...src.matchAll(/(?:route|pathname)\s*===\s*"(\/api\/[^"]+)"/g)].map(m => m[1]))]; // → ["/api/logout"]
// 并集去重 → 37
```

| 口径 | 数字 |
| --- | --- |
| switch 内 `case "/api/..."` | 36 |
| switch 之外前置处理 | 1（`/api/logout`） |
| **唯一 `/api/*` 路由总数** | **37** ← 本文 9.3 节表格逐行列出，数量一致 |
| `POST_BODY_FIELDS` 登记 | 35（未登记的是 `/api/post` 与 `/api/logout`：前者只读 query、后者在 switch 之前处理，都没有 POST body 语义） |
| 非 `/api` 的 case | 1（`/media-file`，本文 9.3 节第 15 行同样列出） |

### C.3 frontmatter 字段与 `src/content.config.ts` 一致

逐个核对 `src/content.config.ts:64-90`（`posts`）→ 本文 3.3 节列出 **23 个字段**，与 schema 的行一一对应（`title, published, updated, draft, description, image, tags, category, lang, pinned, author, sourceLink, licenseName, licenseUrl, comment, password, passwordHint, series, seriesOrder, prevTitle, prevSlug, nextTitle, nextSlug`）。

另三个集合也已核对：`spec`（无字段，`:96`）、`dynamic`（`published/pinned/location`，`:101-105`）、`projects`（10 个含 `link[]` 子结构，`:110-130`），见 3.3 节的第二张表。

### C.4 配置地图覆盖 `src/config` 下全部 `*Config.ts` 与关键 JSON

| 口径 | 数量 | 本文覆盖 |
| --- | --- | --- |
| `*Config.ts` | **24** | ✅ 4.2 节表格 24 行逐行覆盖 |
| 非 `*Config.ts` 的 `.ts` | **2**（`backgroundWallpaper.ts`、`index.ts`） | ✅ 4.2 节首行与末行 |
| 关键 JSON | **4**（`announcements.json`、`friends.json`、`music-playlist.json`、`nav-overrides.json`） | ✅ 4.1 节表 + 4.2 节对应 `*Config.ts` 行的「面板」列 |
| 面板可编辑白名单 | 15（`server.mjs:86-111`） | ✅ 4.1 节表 |
| 站点设置字段 | 33 条 def / 5 个文件（实测 `readSettings` 返回 44 个键，含 11 个 `pages.*`） | ✅ 4.1 节表 + 4.2 节「面板」列 |

复现命令：`Get-ChildItem src/config -Filter *Config.ts | Measure-Object` → 24（2026-10-11 复测；`pnpm check-docs` 的第 3 组也按 24 校验）。

### C.5 `AGENTS.md` 只多了指针段落

| 项 | 值 |
| --- | --- |
| 改动方式 | 在文件**最前面**插入 5 行指针（引用块）+ 1 行空行分隔，其余 **34 行原样保留** |
| 实测 diff | `git diff --numstat -- AGENTS.md` → **`6  0  AGENTS.md`**（新增 6 行、删除 **0** 行） |
| 复核方式 | `git diff --numstat -- AGENTS.md`（`-` 列必须为 0）；`git diff -- AGENTS.md | Select-String '^-'` 应为空 |

### C.6 工作区只多了两个文件

`git status --porcelain --untracked-files=all` 应只显示：

```text
?? docs/PROJECT-CONTEXT.md
 M AGENTS.md
```

（任务开始时 `git status --porcelain --untracked-files=all` 输出为**空** —— 工作区本来是干净的，所以上面的两行就是全部改动。）

---

## 附录 D：给下一个 agent 的收尾提醒

1. **先读第 2 章再动手**；改动前用 `git status --porcelain --untracked-files=all` 留底。
2. **只改该改的地方**：日常 = 第 ③ 类（内容与配置）；改上游文件（第 ① 类）要写清理由并跑三条门禁。
3. **提交用白名单**：`git add -- <显式路径>`；绝不用 `git add -A`。
4. **发布用面板**（会自动体检 + 只暂存 `PUBLISH_SCOPE`）；改了范围外文件就自己 `git` 提交。
5. **看到反直觉的写法先来第 12 章找原因**（`min()` 兜底、`lowSpec` 去属性、`cancelled` 不算失败、Range 非法忽略头、`_headers` 是文档……都是刻意的）。
6. **不确定就标「需确认」**，不要把它写成结论 —— 本文档就是这么做的。

---

## 附录 E：新增功能时的同步契约（防漂移）

> 这一节只回答一个问题：**「我加了功能，除了代码还要动什么？」**
> 一句话规则：**代码改了、面板没改、文档没改 = 漂移。** 漂移不会当场报错，它只会在几周后以「agent 按旧文档改错地方」的形式爆炸（E.3 有三个真实例子）。

### E.1 三处同步原则

任何一个「网站新功能」都可能要同时改三处，缺一处就是漂移：

```text
① 代码实现        src/**、worker/**、admin/*.mjs
      ↕ 必须一致
② 管理面板        admin/index.html（页签 / 表单）、admin/settings.mjs 的 SETTINGS_DEFS、
                  admin/server.mjs 的 CONFIG_FILES / POST_BODY_FIELDS
      ↕ 必须一致
③ 文档与 README    docs/PROJECT-CONTEXT.md（本文档）、README.md、admin/README.md
```

两条自检（用它判断「这个功能要不要进面板」）：

- 它是**内容 / 配置数据**吗（站点标题、歌单、友链、公告、页面开关…）→ 就该有面板入口；面板里没有，说明缺了一块（E.3 事故 1 就是这么来的）。
- 它**会写盘**吗 → 必须挂上第 9.5 节的写入安全链（白名单 → 类型/范围校验 → 写前快照 → 回读校验），并在 9.3 路由表的「写盘 / 写前快照」两列如实登记。

### E.2 「加什么 → 必须同步哪里」对照表

「检查器」列 = `pnpm check-docs` 能不能自动抓到；⚠️ 表示只覆盖其中一部分。

| # | 改动的类型 | 必须同步的文件与章节 | 检查器 |
| --- | --- | --- | --- |
| 1 | **新增 `src/config` 字段**（尤其要能被面板调） | ① 本文档 4.2 配置表（该文件行的「控制什么 / 关键字段 / 面板」列）；② `admin/settings.mjs` 的 `SETTINGS_DEFS`（要能被面板调就必须加 def；条数变了要同步 4.1、9.4、2.3 里写的「33 条」）；③ 若是数据类（JSON）→ 加到 `admin/server.mjs:86-111` 的 `CONFIG_FILES` 白名单（当前 15 个）；④ 必要时同步 `src/types/*.ts` 与 `src/config/index.ts` 的导出 | ⚠️ 部分（`*Config.ts` 文件数 ↔ 4.2 表、`SETTINGS_DEFS` 条数 ↔ 文档声明、`src/config` 总文件数；**字段语义不覆盖**） |
| 2 | **新增 / 改名 / 删除 `/api/*` 路由** | ① 本文档 9.3 路由全表（37 条，逐行列出，含「写盘 / 写前快照」列）；② `POST_BODY_FIELDS`（`admin/server.mjs:1543`，**接受 POST body 就必须登记**；只读的 GET 接口也建议登记空数组，这样「带字段 POST」会 400 而不是静默执行）；③ 面板前端的调用点（`admin/index.html` 内联 JS）；④ 既有约定：**除 `/api/logout` 外未认证一律 403**（`admin/server.mjs:1657-1660`）；⑤ 用户向说明（`README.md` 第 8 章 / `admin/README.md`） | ✅（路由总数 + 9.3 表格逐行集合；POST 登记与 403 行为不检查） |
| 3 | **新增面板页签** | ① 本文档 9.4 页签清单（当前 11 个）；② `admin/README.md` 的功能表；③ `README.md` 第 8 章 | ✅（`data-tab` 去重数 + 9.4 表格） |
| 4 | **新增页面 / 路由（`src/pages/**`）** | ① `siteConfig.pages` 页面开关（`src/config/siteConfig.ts:10-41` + `:358`；关掉会同时隐藏导航项并返回 404）；② `navBarConfig.ts` 的 `getDynamicNavBarConfig()` —— **新增菜单项只能改它**，且必须写显式 `id`（`nav-overrides.json` 只能隐藏 / 改名 / 排序，面板不支持新增）；③ 本文档第 2 章目录树 + 第 3 章相关内容；④ `README.md` 特性表 | ❌（页面 / 路由清单不在检查范围，改完必须人工核对文档第 2 / 3 章） |
| 5 | **新增内容集合或 frontmatter 字段** | ① `src/content.config.ts`（schema 是唯一权威）；② 本文档 3.2 集合表 + 3.3 `posts` 全字段表（当前 23 个）；③ `admin/server.mjs` 的文章解析 / 校验；④ 面板编辑器（`admin/index.html` 文章页、`admin/import-doc.mjs`） | ✅ `posts` 字段集合 ↔ 3.3 表（其它集合、解析与编辑器不覆盖） |
| 6 | **新增构建步骤（`package.json` 的 `build`）** | ① 本文档 11.2 的 8 步链路与「8 步」说法（§1.3 也有一处）；② `CLAUDE.md` / `AGENTS.md` 里的构建说明（上游文件，改动要就地标注「本仓库修正」） | ✅（步骤序列逐条比对 + 三处「N 步」声明，含 `CLAUDE.md`） |
| 7 | **新增 `public/vendor/` 类自托管资源** | ① 缓存规则：`worker/index.mjs:122-129` 与 `public/_headers:38-45`（两边都要写）；② CSP（自托管一般不用放行，除非是 worker / iframe / wasm）；③ 本文档第 5 / 6 章 | ⚠️ 部分（只保证 CSP 三处一致；缓存规则要人看） |
| 8 | **新增第三方脚本 / 样式来源** | ① `worker/index.mjs:31` 的 CSP（**唯一生效处**）；② `public/_headers:32` 必须与它**逐字节一致**；③ 本文档 6.4 的 CSP 全文 + 逐条放行说明（写清为什么放行）；④ 按来源选指令：`script-src` / `style-src` / `connect-src` / `frame-src` / `img-src` | ✅（三处 CSP 逐字节一致 + 文档声明的字符数） |
| 9 | **面板新增会写盘的能力** | ① `admin/README.md`（接口说明 + 安全链）；② 本文档第 9 章（9.3 表格的「写盘 / 写前快照」列、9.5 写入安全链）；③ `PUBLISH_SCOPE`（`admin/publish-scope.mjs`）—— 若它写的是**提交范围之外**的路径（`worker/`、`admin/`、`src/styles/`…），要么把路径纳入 `PUBLISH_SCOPE`，要么在 10.3 明说「面板发布不会提交它」 | ⚠️ 部分（`PUBLISH_SCOPE` 逐条 ↔ 10.3；「写盘 / 快照」列不检查） |
| 10 | **删除功能（必须反向清理）** | 按 1–9 反向删：文档段落、面板入口（`index.html` 的页签 / 按钮）、`SETTINGS_DEFS` 条目、`CONFIG_FILES` 白名单、CSP 放行、缓存规则、构建步骤、`navBarConfig.ts` 菜单项、`PUBLISH_SCOPE` 前缀。删完跑 `pnpm check-docs`，数字 / 清单对不上就会报 ❌ | ⚠️ 部分（「该删的忘了删」会被数字抓到；「不该删的删错了」抓不到） |
| 11 | **面板新增展示项 / 接口（只要涉及文件）** | ① **必须复用 `admin/index.html` 的 `filePathBadge()`**（复制 / 已复制反馈 / 打开所在文件夹只有这一份实现，别各页抄一遍）；② 要显示的路径**必须由后端返回**（`fs.readdir` / `git status --porcelain -z` / 实际写入路径 / 快照目录），或按站点约定拼好后**当场 `stat` 核对**，**前端不许自己拼路径**；③ 后端 `stat` 过之后要如实带上 `exists`（不存在就标 ⚠️ 并隐藏「打开文件夹」按钮）；④ 新增 `/api/*` 字段/路由按第 2 行同步（路由数、9.3 表、`POST_BODY_FIELDS`）；⑤ 本文档 9.10 节的覆盖表 + `admin/README.md` 的「路径徽章」一节 | ❌（人工核对；`pnpm check-docs` 只保证路由/页签/配置/字段的数字与清单） |
| 12 | **新增 / 修改体检项、内容校验规则** | ① **绝对不许另写平行 schema**：字段名与类型的唯一来源是 `src/content.config.ts`；「类型对不对」必须交给**真实构建**（`admin/content-check.mjs` 的 `content-schema`：`node node_modules/astro/bin/astro.mjs build`），YAML 层只允许查「与 schema 无关的通用坑」（引号把值变字符串 / 日期写法 / 列表写法 / YAML 语法）；② 本文档 9.11 节（新检查项要写清「查什么、什么级别、怎么修」）+ 9.3 / 9.4 / 2.3 / 附录 A 第 3 条里的「N 项」计数；③ `admin/README.md` 的「体检（发布前的安全闸）」表 + `README.md` 第 8 章面板表；④ 若有新的写盘产物，必须在 9.3 的「写盘」列如实登记（当前 `content-schema` 写 `.astro/doctor-build/`，**不覆盖 `dist/`**）；⑤ 跑不起来 / 超时必须降级成 `warn`，**既不阻断发布也不静默通过** | ⚠️ 部分（`check-docs` 不数体检项；改写「N 项」的措辞会变成人工核对） |
| 13 | **新增 / 修改任何「会写文章 frontmatter」的代码**（`/api/save-post`、新建、导入、批量脚本…） | ① **日期字段（`published` / `updated`）必须落盘成不带引号的 `YYYY-MM-DD`** —— 加引号就是 YAML 字符串，而 schema 是 `z.date()`，构建必炸（9.11 / 9.12 / 12.13 记录了这个事故**发生过两次**）；② **不许重写用户没编辑的字段**：值没变的行（注释 / 顺序 / 引号风格 / 块标量 / 块列表 / 面板不认识的字段）必须逐字节保留，「保存一次就丢 `lang`/`comment`/`series`」是旧 bug（9.12）；③ 读（表单回填）与写必须共用 `admin/post-frontmatter.mjs` 的同一套行模型，**不要各写一套 YAML 解析**；④ 加校验要**在写盘之前**失败（400），不要先写坏再让发布时被体检拦住（「拦住坏数据」≠「不再产生坏数据」）；⑤ 同步本文档 9.12 + `admin/README.md` 的「文章编辑器：保存时 frontmatter 怎么处理」；⑥ 改完至少跑：反向用例（`published: "2026-10-11"` 的文件保存后不带引号）+ 「只改正文 → frontmatter 逐字节不变」+ 夹具里真实 `astro build` 成功 | ❌（人工核对；`check-docs` 只保证路由 / 页签 / 配置 / 字段的数字与清单，不检查写入语义） |

| 14 | **新增 / 替换音乐等大体积媒体** | ① **先压缩再发布**：面板「音乐」页「一键压缩全部音乐」；`/api/publish` 会拦截 >160kbps / >12MB 的 mp3（详见 9.14）；② 上传按内容哈希去重，改名重传同内容会被 409；③ 本文档 9.14 节 + `admin/README.md` 的「音乐」「一键压缩」两节；④ 换同名声源后 `?v=` 内容哈希由压缩脚本同步，别手改；⑤ `PUBLISH_SCOPE` 已覆盖 `public/assets` | ❌（人工核对；`check-docs` 不检查媒体体积，也不检查 git 历史是否膨胀） |

> 补充（2026-10-11）：新增 `src/config` 下的**数据文件（JSON）**同样会改变 §4.1 与 §2.3 的文件计数，
> 必须同步；`pnpm check-docs` 的第 3 组会直接报出来。
>
> 补充（2026-10-11）：给 `src/config/feature-tour.json` 的条目加 `href` 时，**必须按第 4 组的思路先确认
> 目标真的存在**：① 目标路径在 `dist/` 下能找到产物（`/x/` → `dist/x/index.html`，`/x.xml` → `dist/x.xml`）；
> ② 带 `#锚点` 时目标 HTML 里真的含该 `id`/`name`；③ 该页面没有被 `siteConfig.pages` 关掉
> （关掉的页面产物是 `/404/` 跳转 stub，跳过去等于跳 404）。**宁可不给 `href`，也不要编一个不存在的链接**，
> 演示不了的能力保持普通文本即可。`pnpm check-docs` **不检查**这项，属于人工核对范围。

> 补充（2026-10-11）：面板显示的路径统一为**正斜杠**（`src/content/posts/x.md`），Windows 反斜杠在 UI 入口已归一化；
> `PUBLISH_SCOPE` 已包含 `src/constants`（LQIP 等构建产物数据须随文章一起发布）。

> 补充（2026-10-11）：**改 `admin/server.mjs` 会让本文档里所有 `server.mjs:行号` 锚点漂移**（第 13 行那条
> 「日期引号」修复让文件从 2536 行变成 2535 行）。数字与清单由 `pnpm check-docs` 兜底，**行号不兜底** ——
> 改动后请顺手更新你动过的那几行锚点，或在核对时按关键词（如 `case "/api/save-post"`）检索而不是按旧行号跳。

### E.3 为什么光靠「记得更新」不行（三个真实历史事故）

| # | 事故 | 漂移是怎么产生的 | 为什么长期没人发现 |
| --- | --- | --- | --- |
| 1 | **`perf.live2d` 开关控制错了对象**（本文档 4.4 / 13.6 #1）—— **已修（改名 `perf.spine`）**，记录保留为教材 | `admin/settings.mjs` 里写了 `within: "pioConfig"`，而 `pioConfig.ts` 里**根本没有这个块** —— 正则先命中第 1 行 import 里的 `"../types/pioConfig"`，再吃到它后面第一个 `{`，也就是 `spineModelConfig` 的块。于是那个 label 写着「Live2D」的开关，实际读写的是 **Spine** | 代码能跑、面板不报错，两项又恰好都是 `false`（表现一致）。**两个月后**才有人读代码发现；一旦有人只开其中一项，行为就和开关名对不上 |
| 2 | **`README.md` 写「九个页签」，实际 10 个** | 面板先加了 `publish` 页签：`admin/index.html` 改了，`README.md` 第 8 章与目录树注释没跟着改 | 页签数没人天天数；直到本文档逐个数 `data-tab` 才发现（9.4 的注记） |
| 3 | **上游 `AGENTS.md` / `CLAUDE.md` 的构建链路漏了 3 步、`pnpm lint` 目标写错、`Firefly-Docs/` 目录不存在** | 上游说明是按另一个版本的主题写的；本仓库改过构建脚本（加了 github-card / minify / pagefind 三步）却没回头改说明 | 新 agent 照抄「7 步链路」就会漏跑生成步骤（`CLAUDE.md` 里写着 `pnpm lint` 只针对 `./src`）；`Firefly-Docs/` 在本仓库**根本不存在**，按它去找文档必然扑空 |

同一类事故还有两个（本文档 12.6 / 12.8）：CSP 漏放行 `esm.sh` 让**评论区整个打不开**；`git add -A` 把在制品（半成品 `admin/ci.mjs` + 约 20 个 webp）一起推上生产。

它们的共同点：**漂移是「静默」的** —— 代码不会因为文档写错而报错，构建也不会。所以必须先用一道机器门禁（E.4）把能算的数字钉死，再由人补语义（E.5）。

### E.4 用法：`pnpm check-docs`

```bash
pnpm check-docs                                                  # = node scripts/check-docs-sync.mjs
node scripts/check-docs-sync.mjs                                 # 等价（npx 被执行策略挡时用这条）
node scripts/check-docs-sync.mjs --doc docs/PROJECT-CONTEXT.md  # 指定其它文档副本
```

- **什么时候跑**：加功能 / 加配置 / 加路由 / 加页签 / 加页面之后，以及**提交前** —— 它是「改完功能后的第 4 条门禁」（前三条见 11.2）。
- **它检查什么**（8 组，全部从**代码**算出来，再和文档比对）：
  1. `/api/*` 路由数（`admin/server.mjs` 的 `case` + switch 外前置处理）↔ §1.3 / §9.3 表格逐行；
  2. 面板页签数（`admin/index.html` 的 `data-tab` **去重**）↔ §1.3 / §9.4 表格；
  3. `src/config` 的 `*Config.ts` / `.ts` / 文件总数 ↔ §4.1 口径表、§4.2 表格逐行、§2.3 目录树；
  4. `SETTINGS_DEFS` 条数（`admin/settings.mjs`）↔ §4.1 / §9.4 / §2.3，并校验附录 A 提到的设置 id 真实存在（对全篇残留的旧 id 只打一条 `ℹ️` 提示，不计失败）；
  5. `posts` frontmatter 字段（`src/content.config.ts`）↔ §3.3 表格逐行 / 附录 C.3；
  6. `package.json` 的 `build` 步骤 ↔ §1.3 / §11.2 代码块逐条 / `CLAUDE.md`；
  7. `PUBLISH_SCOPE` 前缀（`admin/publish-scope.mjs`）↔ §10.3 代码块逐条；
  8. CSP 在 `worker/index.mjs`、`public/_headers`、§6.4 正文**三处逐字节一致**（含文档声明的 407 字符）。
- **输出格式**：每组先打印代码事实（`·` 行），再逐条打印 `✅ / ❌`；不符时给可操作指令 ——
  `代码里是 X，文档里写的是 Y，请更新 docs/PROJECT-CONTEXT.md:<行号>（§章节）`。
- **退出码**：`0` = 全部一致；`1` = 至少一项 ❌（可直接用于提交前脚本）；`2` = 参数错误或文档读不到。
- **容错**：`⚠️` = 文档里找不到这条声明（措辞改了或整段被删）。它**不算失败**（退出码仍为 0），但会出现在末尾的「未覆盖」汇总里 —— 看到 ⚠️ 要么把文档措辞改回去，要么同步更新检查器里的锚点。
- **零依赖、只读**：只用 `node:` 内置模块；不联网、不写文件、不执行被测代码。

**改完功能的 60 秒自查**（机器能查的交给机器，剩下的照这张纸）：

1. 跑 `pnpm check-docs` → 期望退出码 0（若有 ❌，按它给的行号改文档；⚠️ 则按 E.4 的说明处理）。
2. 对照 E.2 找到你这个改动落在哪几行，逐条勾掉「必须同步」的项。
3. 动了 CSP？`public/_headers` 同步了吗？§6.4 的逐条说明补了吗？
4. 动了 `package.json` 的 `build`？§1.3、§11.2、`CLAUDE.md` 同步了吗？
5. 动了面板 / `worker/` / 文档这类 `PUBLISH_SCOPE` 之外的路径？**面板发布按钮不会提交它们**（10.3），自己 `git add -- <显式路径>` 后提交。
6. 跑三条门禁（11.2）→ 全绿。

### E.5 检查器覆盖不到的部分（语义漂移仍需人读文档）

`pnpm check-docs` 只能比**数字与清单**。以下必须人工判断：

- **说明性文字是否仍然成立**：数字没变、含义变了（字段默认值 / 取值范围 / 影响描述），或者「该怎么做」的步骤已经过时。
- **`README.md` / `admin/README.md` / `AGENTS.md` 的正文**：只有 `CLAUDE.md` 的构建步骤数被覆盖。用户向文档最容易长期说谎（E.3 事故 2）。
- **配置字段的语义与面板开关的真实行为**：`SETTINGS_DEFS` 的 `within` 到底指向哪个配置块、label 与行为是否一致 —— E.3 事故 1 是纯语义漂移，任何数字比对都抓不到。
- **9.3 表格的「写盘 / 写前快照」列、`POST_BODY_FIELDS` 登记、缓存规则**（`worker/index.mjs` 与 `public/_headers` 的 `Cache-Control`）：脚本不检查。
- **CSP 是否「该放行的都放行了」**：脚本只保证三处副本一致；漏放行（评论区打不开）与多余放行都发现不了。
- **设计判断**：这个新功能**应该**有面板入口吗？应该纳入 `PUBLISH_SCOPE` 吗？应该写进 `README.md` 吗？—— 脚本回答不了，只能靠 E.1 的两条自检。
- **不在本文档里的声明**：`README.md` 的行数 / 章节数、`admin/README.md` 的功能表、面板页签的**实际行为**等，脚本一概不看。

