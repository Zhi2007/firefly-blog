# 栀海的博客

一个中文个人博客：**Astro 7 + Firefly 主题**（Firefly 又 fork 自 Fuwari），构建产物是纯静态文件，托管在 **Cloudflare Workers 静态资源**上（`dist/` + 一个很小的 Worker 脚本）。

- 线上地址：**<https://www.zhihaisblog.top>**
- 裸域 `zhihaisblog.top` 会在 Worker 里 **301** 跳到主域（保留路径与查询串），见 `worker/index.mjs` 顶部的 `CANONICAL_HOST` / `APEX_HOST`
- 旧的 `*.workers.dev` 地址仍然可用（`wrangler.jsonc` 注释里记着它）
- 关于我：<https://www.zhihaisblog.top/about/>；源码：<https://github.com/Zhi2007/firefly-blog>

## 1. 项目简介

| 层 | 技术 | 版本（取自 `package.json`） | 干什么 |
| --- | --- | --- | --- |
| 静态站点框架 | Astro | `astro` **7.3.2** | 页面路由、内容集合（Content Collections）、构建 `dist/` |
| 交互组件 | Svelte | `svelte` **^5.57.0**（+ `@astrojs/svelte` 9.0.1） | 搜索、翻页、设置面板等需要 JS 的岛屿（islands） |
| 样式 | Tailwind CSS | `tailwindcss` **^4.3.3**（+ `@tailwindcss/vite`） | 原子化样式；另有 self-written CSS/Stylus 在 `src/styles/` |
| 页面转场 | Swup | `@swup/astro` **^1.8.0** | 站内跳转不整页刷新（配置见 `astro.config.mjs`） |
| 站点托管 | Cloudflare Workers（静态资源） | `wrangler` **^4.127.1** | 上传 `dist/` 为静态资源，全球 CDN、自动 HTTPS |
| 边缘逻辑 | 自写 Worker | `worker/index.mjs` | 裸域 301、旧地址 301、音乐 Range、安全头、异常兜底 |
| 站内搜索 | Pagefind | `pagefind` **^1.5.2** | 构建后对 `dist/` 建静态索引，前端零后端搜索 |
| 类型 / 代码检查 | TypeScript + Biome | `typescript` **^6.0.3**、`@biomejs/biome` **2.5.12** | `pnpm check` / `pnpm type-check` / `pnpm lint` / `pnpm format` |
| 构建工具 | Vite | `vite` **8.3.4**（`devDependencies` 里钉死） | Astro 底层打包器；钉版本是为了避开 `require is not defined` |

- 运行时要求：**Node `>=22.23.0`**、包管理器 **pnpm**（`packageManager: pnpm@11.22.0`，`preinstall` 会拦住 npm/yarn）。
- 站点自身配置：`src/config/siteConfig.ts` 的 `site_url: "https://www.zhihaisblog.top"`，`title: "栀海的博客"`，`subtitle: "记录技术、折腾与随想"`。

## 2. 特性一览

下表每一项都能在仓库里找到出处（配置文件 + 字段），不是宣传语。

| 特性 | 现状 / 由谁控制 |
| --- | --- |
| 主页横幅（banner 壁纸 + 主/副标题 + 打字机） | `src/config/backgroundWallpaper.ts` → `mode: "banner"`、`common.homeText`（`title` / `subtitle` 数组 / `typewriter`） |
| 桌面 + 移动各 6 张随机壁纸 | `backgroundWallpaper.ts` → `src.desktop`（`assets/images/DesktopWallpaper/d1..d6.avif`）、`src.mobile`（`m1..m6.avif`），数组即"每次刷新随机一张" |
| 壁纸轮播 / 水波纹 / 渐变过渡 | `backgroundWallpaper.ts` → `common.carousel`（默认 `enable: false`）、`common.waves`、`common.gradient` |
| 全屏壁纸布局与下滑模糊渐变 | `backgroundWallpaper.ts` → `fullscreen.layout: "classic"`、`fullscreen.blurRamp.enable.{desktop,mobile}` |
| 首页横幅下方社交图标（GitHub / B 站 / RSS） | `backgroundWallpaper.ts` → `common.homeText.links`（`linksEnable: true`） |
| 深浅色主题 + 主题色相 | `siteConfig.ts` → `themeColor: { hue: 250, defaultMode: "system" }` |
| 显示设置面板（🎨，可切换主题色/壁纸模式/樱花等） | `src/config/displaySettingsConfig.ts` → `enable: true`；各分项 `themeColorSwitchable` / `wallpaperModeSwitchable` / `sakuraSwitchable` … |
| 樱花特效（Web Worker 渲染） | `src/config/effectsConfig.ts` → `sakuraConfig.enable`（**当前 `false`**）；前端开关见 `displaySettingsConfig.sakuraSwitchable` |
| 页脚时间进度（今日 / 本月 / 本年） | `effectsConfig.ts` → `timeProgressConfig.enable: true`；组件挂在 `sidebarConfig.ts` 的 `leftComponents`（`type: "timeProgress"`） |
| 切换标签页时轮播标题 | `effectsConfig.ts` → `tabTitleConfig.enable: true`、`titles`、`intervalMs` |
| 公告：首访弹窗 + 公告页 + 导航入口 | `src/config/announcementConfig.ts` → `modal.enable: true`、`modal.storageKey: "zhi-blog-announcement-version"`；数据在 `src/config/announcements.json` |
| 文章置顶 | 文章 frontmatter `pinned: true`（`src/content.config.ts` 的 `posts` schema） |
| 文章加密（密码 + 密码提示） | 文章 frontmatter `password` / `passwordHint`；渲染在 `src/pages/posts/[...slug].astro` 里的 `EncryptedPost` 组件 |
| 文章系列（series / seriesOrder） | frontmatter `series` / `seriesOrder`；导航组件 `src/components/misc/SeriesNav.astro` |
| 文章封面 + LQIP 模糊占位图 | `src/config/coverImageConfig.ts`（`enableInPost` / `enableInPostOverlay` / 随机封面 API）；占位数据由 `scripts/generate-lqips.ts` 生成到 `src/constants/lqips.json` |
| 音乐播放器（悬浮左下角，可收起） | `src/config/musicConfig.ts` → `floating.enable: true`、`position: "bottom-left"`；歌单 `src/config/music-playlist.json` |
| **主页功能导览**（首页中间栏顶部，可翻页；**当前已关闭**） | 5 页 / 19 条功能，新访客一进站就知道本站有什么；其中 14 条带 `href`，渲染成可 Tab 聚焦的真链接，直接跳到真的能演示它的页面或锚点（`/search/`、`/friends/`、`/announcement/`、`/rss.xml`、`/sitemap-index.xml`，以及文章页目录/评论区锚点），其余 5 条当前没有产物可演示，保持为普通文本、不做成假链接；上一页/下一页/圆点、←/→ 键盘、触摸滑动（滑动那一下不会误触发链接）；默认不自动轮播。数据 `src/config/feature-tour.json`（可在面板「配置」页编辑），开关 `src/config/featureTourConfig.ts`。**当前 `feature-tour.json` 的 `enable` 为 `false`，首页不渲染这个部件**（代码与数据保留，改回 `true` 即可恢复） |
| 歌词逐行高亮 | `musicConfig.ts` → `showLyrics: true`；每首歌的 `lrc` 指向 `public/assets/music/lrc/*.lrc`（带时间戳才逐行高亮） |
| 音频边下边播 / 拖动进度条 | `worker/index.mjs` 为 `/assets/music/*` 实现 `206` / `ETag` / `HEAD` / `416`（Workers 静态资源本身不处理 Range） |
| 看板娘（Live2D） | `src/config/pioConfig.ts` → `live2dWidgetConfig.enable: true`，模型 `/pio/models/live2d/snow_miku/model.json`；Spine 是 `spineModelConfig.enable: false` |
| 站内搜索（Pagefind） | `navBarConfig.ts` → `navBarSearchConfig.method: NavBarSearchMethod.PageFind`；索引由 `scripts/run-pagefind.ts` 生成，排除规则 `pagefind.yml` |
| 文章内搜索 | 文章正文上方的搜索栏（`src/components/features/PostSearch.svelte`，挂在文章页正文前）：输入关键字高亮全部匹配，Enter 跳到第一个/下一个，Shift+Enter 上一个，Esc 清除；用 CSS Custom Highlight API，**不修改文章 DOM**（不会破坏 Shiki / KaTeX）；旧浏览器退化为「当前匹配外框」但仍可计数与跳转；加密文章暂不显示 |
| Giscus 评论（基于 GitHub Discussions） | `src/config/commentConfig.ts` → `type: "giscus"`，`repo: "Zhi2007/my-blog"`、`mapping: "pathname"` |
| 文章列表布局（列表 / 网格、移动端默认网格） | `siteConfig.ts` → `postListLayout.defaultMode: "list"`、`mobileDefaultMode: "grid"`、`grid.*` |
| 分类/标签快捷导航栏 | `siteConfig.ts` → `categoryBar: true`、`categoryStyle: "rectangle"`、`tagStyle: "pill"` |
| 数学公式（KaTeX + mhchem） | `astro.config.mjs` → `remarkMath` + `rehypeKatex`（`katex/dist/katex.mjs`）、`import "katex/dist/contrib/mhchem.mjs"` |
| Mermaid / PlantUML 图表 | `astro.config.mjs` → `remarkMermaid` / `rehypeMermaid`（配置 `src/config/mermaidConfig.ts`）、`remarkPlantuml` / `rehypePlantuml`（`src/config/plantumlConfig.ts`） |
| 代码块（折叠 / 行号 / 语言徽章 / 复制按钮） | `src/config/expressiveCodeConfig.ts` → `pluginCollapsible.enable: true`（>15 行折叠）、`pluginLanguageBadge.enable: true` |
| RSS / Atom / 站点地图 / robots / llms.txt | `src/pages/rss.xml.ts`、`atom.xml.ts`、`@astrojs/sitemap`（`astro.config.mjs` 里按 `siteConfig.pages` 过滤）、`robots.txt.ts`、`llms.txt.ts` |
| Cloudflare Web Analytics（无 Cookie 统计） | `src/config/analyticsConfig.ts` → `cloudflareWebAnalytics.token`；组件 `src/components/analytics/` |
| 沉浸阅读（文章页右下角按钮） | `siteConfig.ts` → `post.immersiveReading.{enable,defaultOn,tocEnabled,tocPosition}` |
| 页脚自定义内容 + 开源署名 | `src/config/FooterConfig.html`（页脚链接）与 `/announcement/` 公告页的完整致谢 |

> 关闭某项功能最省事的入口：管理面板的「站点设置 / 配置」页（详见 `admin/README.md`），或者直接改上表对应的配置文件后重新构建。

## 3. 快速开始

### 前置要求

| 要求 | 说明 |
| --- | --- |
| Node.js **≥ 22.23.0** | `package.json` 的 `engines.node`；低于这个版本可能有构建报错 |
| pnpm | `package.json` 的 `packageManager` 声明为 `pnpm@11.22.0` |
| 必须用 pnpm | `package.json` 的 `preinstall` 是 `npx only-allow pnpm`，用 npm/yarn 安装会直接失败 |
| ffmpeg（可选） | 只有跑音乐压缩（`pnpm compress-music` / 面板「一键压缩」）才需要；脚本会依次查 `FFMPEG_PATH`、`PATH`、常见安装位置 |
| git（可选） | 用管理面板的「发布」页提交并推送时需要本机 git 凭据 |

### 从 clone 到本地预览

```bash
# 1) 克隆仓库（换成你自己的 fork 地址也行）
git clone https://github.com/Zhi2007/firefly-blog.git
cd firefly-blog

# 2) 安装依赖（必须 pnpm；首次会下载几百 MB，视网络需要几分钟）
pnpm install

# 3) 启动开发服务器（改代码即时热更新）
pnpm dev
#    默认地址 http://localhost:4321

# 4) 生产构建（完整链路见下一节；产出在 dist/）
pnpm build

# 5) 本地预览构建产物（用 dist/，不再热更新）
pnpm preview
```

> 首次 `pnpm install` 是几百 MB 的量级（含 sharp、workerd、esbuild 等二进制）；`pnpm-workspace.yaml` 里用 `allowBuilds` 放行了 `esbuild` 与 `workerd` 的安装脚本。首次 `pnpm build` 大约 1–3 分钟（图片越多、字体子集化越慢）。

如果本地构建报 `require is not defined` 或 picomatch 相关错，见 [第 11 节 FAQ](#11-常见问题-faq)，或直接双击根目录的 `重建依赖.cmd`。

## 4. 常用命令

全部来自 `package.json` 的 `scripts`（名字一字不差）。

| 命令 | 作用 | 什么时候用 |
| --- | --- | --- |
| `pnpm dev` | `astro dev`，起开发服务器（默认 <http://localhost:4321>），热更新 | 日常写作、调样式、改配置后马上看效果 |
| `pnpm start` | 与 `pnpm dev` 完全相同（`astro dev` 的别名） | 习惯用 `npm start` 那种写法时 |
| `pnpm build` | 完整生产构建（8 步链路，见下） | 上线前、本地验证产物、`wrangler deploy` 之前 |
| `pnpm preview` | `astro preview`，用构建产物起一个本地服务器 | 想确认"线上形态"（不含 Worker 的边缘逻辑）时 |
| `pnpm check` | `astro check`，Astro/TS 诊断（.astro、.svelte、内容集合类型） | 改完 `.astro` / 组件后，比 `type-check` 更贴合模板 |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations`（含 `scripts/`） | 改 `src/**`、`scripts/**` 的纯 TS 逻辑 |
| `pnpm lint` | `biome check --write ./src ./scripts`（自动修安全项） | 提交前统一风格；注意它只覆盖 `src` 与 `scripts` |
| `pnpm format` | `biome format --write ./src ./scripts` | 只想排版、不想动 lint 规则时 |
| `pnpm new-post <文件名>` | 用 `scripts/new-post.js` 在 `src/content/posts/` 生成带 frontmatter 的 `.md`，中文文件名会转拼音 slug | 想用命令行而不是面板发文 |
| `pnpm new-dynamic <内容>` | 用 `scripts/new-dynamic.js` 在 `src/content/dynamic/` 生成带时间戳的动态（`published` 用 `siteConfig.timezone`） | 发一条"说说"式短动态 |
| `pnpm new-d` | `pnpm new-dynamic` 的短别名（同一个脚本） | 同上，少敲几个字 |
| `pnpm admin` | `node admin/server.mjs`，起本地管理面板 | 不想敲命令、想用浏览器管内容 |
| `pnpm lqips` | `npx tsx scripts/generate-lqips.ts`，重算模糊占位图数据到 `src/constants/lqips.json` | 换了封面图/壁纸、想让 LQIP 跟着更新 |
| `pnpm github-cards` | `npx tsx scripts/generate-github-card-data.ts`，抓 GitHub 仓库信息到 `src/constants/github-card-data.json` | 文章里用了 `::github{repo="…"}` 卡片、想刷新卡片数据 |
| `pnpm compress-music` | `node scripts/compress-music.mjs`（直跑）+ 参数 | 音频/封面太大，要压体积。**不带参数 = 真的压缩音频并改写歌单**，见 [第 9 节](#9-音乐系统) |
| `pnpm astro` | `astro` 本体透传（`pnpm astro --help` 等） | 需要用 Astro CLI 的其它子命令时 |
| `pnpm preinstall` | `npx only-allow pnpm`，包管理器守卫 | 不需要手动跑；它由 pnpm 在 `install` 前自动执行 |

### `pnpm build` 的完整链路

`package.json` 里 `build` 是这一条（顺序即执行顺序）：

```json
"build": "npx tsx scripts/generate-github-card-data.ts && npx tsx scripts/generate-lqips.ts && npx tsx scripts/generate-vndb-covers.ts && astro build && npx tsx scripts/prune-pio-assets.ts && npx tsx scripts/subset-fonts.ts && npx tsx scripts/minify-inline-scripts.ts && npx tsx scripts/run-pagefind.ts"
```

| 步骤 | 脚本 | 做什么 / 产物 |
| --- | --- | --- |
| 1 | `scripts/generate-github-card-data.ts` | 扫描 `src/content/**/*.{md,mdx}` 里的 `::github{repo="…"}` 指令，把仓库信息写进 `src/constants/github-card-data.json` |
| 2 | `scripts/generate-lqips.ts` | 用 sharp 给图片算极小模糊占位图，写进 `src/constants/lqips.json`（跳过 `public/favicon/**`、`public/pio/**`、`public/assets/images/effects/**`、`public/assets/music/**` 等目录） |
| 3 | `scripts/generate-vndb-covers.ts` | 下载 VNDB 封面到 `public/vndb-covers/`（已 gitignore、已存在则跳过）。本站 `siteConfig.vndb.downloadCovers: false`，所以这一步是空转 |
| 4 | `astro build` | 渲染全部页面到 `dist/`，同时把 `public/` 原样拷进去 |
| 5 | `scripts/prune-pio-assets.ts` | 按开关删掉 `dist/` 里用不到的看板娘资源。Astro 会把整个 `public/` 原样拷进 `dist/`，所以这里按 `live2dWidgetConfig.enable` / `spineModelConfig.enable` 清理：本站 Spine 关着 → 删 `dist/pio/models/spine` 与 `dist/pio/static`（Live2D 是开的，`dist/pio/models/live2d` 保留）；Live2D 也关掉时还会删 `dist/pio/models/live2d` 与没人引用的客户端 chunk `_astro/Live2DWidget.astro_astro_type_script*`；两个都关则整个 `dist/pio` 被删除（约 15 MiB） |
| 6 | `scripts/subset-fonts.ts` | 扫 `dist/` 所有 HTML，收集真正用到的字符，为标记 `subset: true` 的本地字体生成轻量 woff2 子集 |
| 7 | `scripts/minify-inline-scripts.ts` | Astro 不会压缩 `is:inline` 脚本，这一步用 esbuild 过一遍 `dist/` 里的内联 JS |
| 8 | `scripts/run-pagefind.ts` | 对真实站点根目录跑 `pagefind --site <root>`，索引输出到 `<root>/pagefind` 并随站点一起部署（排除选择器在 `pagefind.yml`） |

> 站点根目录由 `scripts/site-root.ts` 决定：有 `dist/client` 就用它（Cloudflare Pages 形态），否则用 `dist`（本仓库的实际形态）。

示例输出（形态如下；**页数会随文章数变化**——本仓库当前 `dist/` 里有 30 个 `.html`，所以是 `30 page(s) built`；耗时随机器与图片数量变化）：

```text
▶ src/pages/index.astro
  └─ /index.html
...
▶ src/pages/posts/[...slug].astro
  └─ /posts/hello-world/index.html
[build] 30 page(s) built in 12.4s
[build] Complete!

Running Pagefind v1.5.2
Running on directory dist
Found 30 files matching **/*.{html}
Indexed 9 pages
```

> 上例是**格式示意**：本机沙箱环境跑 `astro build` 时会因为本地 `node_modules` 与 lockfile 不一致而报 `require is not defined`（picomatch），所以这里给出的不是本次实跑日志；页数 30 与 `dist/` 的实际 `.html` 数量一致。修复办法见 FAQ。

## 5. 目录结构

```text
firefly/
├── admin/                     # 零依赖本地管理面板（Node 内置模块，无 npm 依赖）
│   ├── server.mjs             # HTTP 服务：路由、认证、读写文件、调用 git/pnpm
│   ├── index.html             # 单页面 UI（11 个页签，内联 JS/CSS）
│   ├── import-doc.mjs         # .docx/.txt/.md → Markdown（自己读 ZIP + inflateRaw）
│   ├── audio-meta.mjs         # 从 mp3/flac/m4a 读 ID3/Vorbis/ilst 标签、封面、歌词
│   ├── doctor.mjs             # 体检 10 项：JSON 合法性、引用、文章 frontmatter（YAML 速查 + 真实构建）、站内链接、密钥、大文件、配置矛盾、git
│   ├── content-check.mjs      # 文章 frontmatter 两层校验：YAML 速查（秒级）+ 真实 astro build（唯一权威）
│   ├── post-frontmatter.mjs   # 保存文章时的 frontmatter 读写共用模型：日期不带引号、没编辑的行逐字节保留
│   ├── settings.mjs           # 「站点设置」白名单表单：正则定位 + 写前快照 + 回读校验
│   ├── nav.mjs                # 导航菜单隐藏/改名/排序 → 只写 nav-overrides.json
│   ├── backups.mjs            # 写前快照（admin-backups/）与恢复
│   ├── media-compress.mjs     # 批量转 WebP（只新增 .webp，不删原图）
│   ├── zip.mjs                # 快照导出 ZIP（store 模式，不压缩）
│   └── README.md              # 面板详细用法（本文件只做索引）
├── admin-launcher/            # 单窗口桌面启动器（C# / .NET Framework，零第三方依赖）
│   ├── FireflyAdminLauncher.cs # 隐藏 node + Chrome/Edge --app 窗口 + 后台日志 + 在线重启
│   ├── build.cmd              # 编译到根目录 firefly-admin.exe（exe 被 gitignore）
│   └── README.md              # 使用 / 构建 / 自检 / 排查
├── public/                    # 原样拷贝进 dist/ 的静态文件
│   ├── _headers / _redirects  # ⚠️ 见 FAQ：run_worker_first 之后已不生效，只是文档
│   ├── assets/music/          # 本地歌单：音频 + cover/ + lrc/（另有 README.md 说明）
│   ├── assets/images/         # 头像、广告位、打赏码等站点级图片
│   ├── favicon/               # 站点图标（siteConfig.favicon 指向 firefly-32.png）
│   ├── pio/                   # 看板娘模型（Live2D snow_miku；Spine 未启用）
│   └── gallery/               # 相册图片
├── scripts/                   # 构建期脚本（tsx/node 直跑，不是浏览器代码）
│   ├── generate-github-card-data.ts / generate-lqips.ts / generate-vndb-covers.ts
│   ├── prune-pio-assets.ts / subset-fonts.ts / minify-inline-scripts.ts / run-pagefind.ts
│   ├── site-root.ts           # 统一的「站点根目录」判定（dist 或 dist/client）
│   ├── new-post.js / new-dynamic.js   # pnpm new-post / new-dynamic
│   ├── compress-music.mjs     # 音乐/封面压缩 + 歌单 ?v= 哈希同步
│   └── quarantine-bad-posts.mjs       # 把有问题的文章挪走的应急脚本
├── src/
│   ├── pages/                 # 文件路由：index、archive、categories、tags、series、posts/[...slug]、rss.xml.ts、atom.xml.ts、404.astro …
│   ├── layouts/               # Layout.astro（HTML 外壳）、MainGridLayout.astro（栅格+侧栏+导航+壁纸+页脚）
│   ├── components/            # 按域拆分：analytics/ comment/ common/ controls/ features/ layout/ misc/ pages/ widget/
│   ├── config/                # 全部可调配置（见第 7 节）＋ announcements.json / music-playlist.json / nav-overrides.json
│   ├── content/               # 内容集合：posts/（文章 + images/）、spec/（about/announcement/friends/guestbook）、dynamic/、projects/
│   ├── types/                 # 配置与数据的 TS 类型定义（与 src/config 一一对应）
│   ├── utils/                 # 纯函数工具：排序、日期、加密、图片、LQIP、TOC、i18n 辅助等
│   ├── plugins/               # 15 个 remark/rehype 插件：mermaid、plantuml、图片网格、wiki 链接、GitHub 卡片、外链、邮箱保护…
│   ├── i18n/                  # i18nKey.ts + translation.ts + languages/（zh_CN、en、zh_TW、ja、ko、ru）
│   ├── styles/                # 全局样式：main.css、markdown.css、变量（variables.styl）、各功能样式
│   ├── assets/                # 会被 Astro 优化管线的图片（走 import 引用，与 public/ 二选一）
│   ├── constants/             # 构建期生成/手写的常量：lqips.json、icons-data.json、github-card-data.json
│   ├── icons/                 # 本地图标存放目录（当前只有 .gitkeep）
│   ├── workers/               # sakura.worker.ts（樱花特效的 Web Worker 源码）
│   └── content.config.ts      # ✅ 文章 frontmatter 的 schema（第 6 节的唯一依据）
├── worker/
│   └── index.mjs              # Cloudflare Worker 入口（裸域 301、旧地址 301、音乐 Range、安全头）
├── .github/workflows/deploy.yml   # push 到 main → 构建 → wrangler 部署
├── wrangler.jsonc             # Worker 名称、入口、静态资源目录、路由（两个 custom_domain）
├── astro.config.mjs           # Astro 集成与 Markdown 插件链（KaTeX、Mermaid、sitemap、swup…）
├── pagefind.yml               # Pagefind 索引时忽略的选择器
├── 启动管理面板.cmd            # Windows 双击启动管理面板（等价 node admin/server.mjs）
├── 重建依赖.cmd                # Windows 双击重建 node_modules（修复本地构建报错，日志写 logs/）
├── package.json / pnpm-lock.yaml / pnpm-workspace.yaml / tsconfig.json / biome.json
├── postcss.config.mjs / svelte.config.js / vercel.json / .npmrc
├── README.md / README.en.md / UPSTREAM-README.md / CREDITS.md / LICENSE
└── AGENTS.md / CLAUDE.md / CONTRIBUTING.md / _frontmatter.json
```

## 6. 写一篇文章

文章就是 `src/content/posts/` 下的一个 `.md` 文件（内容集合 `posts` 的 loader 是 `**/*.{md,mdx}`）。文件名决定 URL：`src/pages/posts/[...slug].astro` 用 `entry.id` 去掉扩展名作为路径，所以 `src/content/posts/hello-world.md` → `/posts/hello-world/`。

### 6.1 frontmatter 字段表

字段以 **`src/content.config.ts`** 的 `posts` schema 为准（下表逐项核对过）。**日期字段叫 `published`，不是 `pubDate`。**

| 字段 | 类型 | 必填 | 默认值 | 说明 | 示例 |
| --- | --- | --- | --- | --- | --- |
| `title` | string | **是** | — | 文章标题 | `title: 我的第一篇博客` |
| `published` | date | **是** | — | 发布日期；`YYYY-MM-DD` 最省事 | `published: 2026-10-11` |
| `updated` | date | 否 | — | 更新日期，配合 `siteConfig.post.showLastModified` 显示"上次编辑" | `updated: 2026-10-20` |
| `draft` | boolean | 否 | `false` | 草稿标记 | `draft: true` |
| `description` | string | 否 | `""` | 摘要，出现在列表、搜索结果、OG 卡片 | `description: 记录一次部署踩坑` |
| `image` | string | 否 | `""` | 封面图路径；填 `"api"` 会用随机封面 API（需 `coverImageConfig.randomCoverImage.enable: true`） | `image: ./images/cover.png` |
| `tags` | string[] | 否 | `[]` | 标签数组 | `tags: [Cloudflare, 折腾]` |
| `category` | string \| null | 否 | `""` | 分类 | `category: 折腾` |
| `lang` | string | 否 | `""` | 该篇语言覆盖（站点默认 `zh_CN`） | `lang: en` |
| `pinned` | boolean | 否 | `false` | 置顶 | `pinned: true` |
| `author` | string | 否 | `""` | 作者覆盖（默认用 `profileConfig.name`） | `author: 栀海` |
| `sourceLink` | string | 否 | `""` | 转载来源链接 | `sourceLink: https://example.com/post` |
| `licenseName` | string | 否 | `""` | 该篇的许可名称 | `licenseName: CC BY-NC-SA 4.0` |
| `licenseUrl` | string | 否 | `""` | 许可链接 | `licenseUrl: https://creativecommons.org/licenses/by-nc-sa/4.0/` |
| `comment` | boolean | 否 | `true` | 该篇是否开评论（`false` = 关闭） | `comment: false` |
| `password` | string | 否 | `""` | 文章密码；非空则正文加密，需输入密码才展示 | `password: "1234"` |
| `passwordHint` | string | 否 | `""` | 密码提示语 | `passwordHint: 生日` |
| `series` | string | 否 | `""` | 系列名（同名归到同一系列） | `series: 建站记` |
| `seriesOrder` | number | 否 | — | 系列内顺序 | `seriesOrder: 2` |
| `prevTitle` / `prevSlug` | string | 否（内部用） | `""` | 上一篇导航，由主题/工具写入 | — |
| `nextTitle` / `nextSlug` | string | 否（内部用） | `""` | 下一篇导航，由主题/工具写入 | — |

两个容易踩的点：

1. `pnpm new-post` 生成的模板里会写一行 `slug: xxx`，但 **schema 里没有 `slug` 字段**（会被忽略），真正决定 URL 的是文件路径。
2. 上表里"否"的字段都有默认值，所以只写 `title` + `published` 也能构建成功；但 `description` 为空会让列表和搜索结果没有摘要，建议都填。

### 6.2 一篇完整示例文章

保存为 `src/content/posts/my-first-post.md`：

````markdown
---
title: 我的第一篇博客
published: 2026-10-11
description: 用示例把标题、列表、代码块、表格、图片、公式和 Mermaid 都过一遍。
tags: [随笔, 示例]
category: 随笔
image: ./images/my-first-post-cover.png
pinned: false
draft: false
comment: true
series: 建站记
seriesOrder: 1
---

这里写正文。下面的写法都能直接用。

## 二级标题

正文支持 `**加粗**`、`*斜体*`、`[链接](https://astro.build)`、行内代码 `` `pnpm build` ``。

### 三级标题

> [!NOTE]
> 这是 GitHub 风格的提示框（`siteConfig.post.rehypeCallouts.theme: "github"`）。

## 列表

- 无序列表第一项
- 无序列表第二项
  - 嵌套一项

1. 有序列表第一项
2. 有序列表第二项

## 代码块

```bash
pnpm install
pnpm dev
```

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

## 表格

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 本地开发 |
| `pnpm build` | 生产构建 |

## 图片

文章自带图片放在 `src/content/posts/images/`，用相对路径引用：

![封面示例](./images/my-first-post-cover.png)

站点级图片放在 `public/`，用绝对路径引用：

![站点图标](/favicon/firefly-32.png)

## 数学公式（KaTeX）

行内公式：$E = mc^2$。

块级公式：

$$
\int_{0}^{1} x^{2}\,dx = \frac{1}{3}
$$

## Mermaid 图（构建时渲染成静态 SVG）

```mermaid
flowchart LR
  A[写作] --> B[pnpm build]
  B --> C[git push]
  C --> D[Actions 部署]
```
````

> 关于图片的两种放法（都有仓库依据）：
> - **文章自带图片** → `src/content/posts/images/`，正文里用 `./images/xxx.png`、frontmatter 的 `image` 也这么写（现有文章 `src/content/posts/hello-world.md` 用的就是 `image: ./images/cover-demo.png`）。管理面板把"文章图片"的引用前缀固定成 `./images/`（`admin/server.mjs` 的 `MEDIA_URL_PREFIX["post-images"]`）。
> - **站点级图片** → `public/`，用 `/` 开头的路径引用（如 `profileConfig.avatar: "/assets/images/avatar-zhi.webp"`、`siteConfig.favicon` 的 `/favicon/firefly-32.png`）。
> - 需要 Astro 自动优化（WebP/AVIF、响应式）的图片才放 `src/assets/`，用 `import` 引用；`public/` 与远程 URL 不经过优化管线（`backgroundWallpaper.ts` 与 `profileConfig.ts` 注释都写明了这点）。

### 6.3 用 Word / txt 写，再用面板导入

管理面板的「文章」页有个 **「从 Word / txt 导入」** 按钮（`POST /api/import-document`），能把 `.docx` / `.txt` / `.md` 转成 Markdown 填进编辑器：

| 项目 | 说明 |
| --- | --- |
| 支持扩展名 | `.docx`、`.txt` / `.text`、`.md` / `.markdown`（前端 `accept` 与后端 `TEXT_KINDS` 一致） |
| 不支持 | 旧版 `.doc`（二进制格式），会提示"请在 Word 里另存为 .docx" |
| 体积上限 | 25 MB（前端与后端都拦，`MAX_IMPORT_BYTES`） |
| 编码 | 自适应：先按 UTF-8 严格解码，失败或出现替换字符就按 **GBK** 解码（记事本另存的 txt 常见），并给出一条警告 |
| 图片 | `.docx` 里的图片会被抽出来写进 `src/content/posts/images/`，文件名形如 `<slug>-img1.png`，正文里自动替换成 `./images/<slug>-img1.png` |
| 已知取舍 | 列表**统一渲染成无序列表**（`- `），有序列表的编号会丢；下划线、字体颜色、删除线等内联样式不保留；文本框/嵌入对象/公式会被跳过，跳过数量汇总成警告 |
| 设计取舍 | 导入**只填编辑器和图片**，**不会自动保存文章**，需要你自己检查后点「保存」（格式转换一定有误差，必须过一眼） |

完整说明与请求/响应示例见 [`admin/README.md`](./admin/README.md)。

## 7. 配置指南

所有配置都在 `src/config/`，类型定义在 `src/types/`（一一对应），统一从 `src/config/index.ts` 导出。改完 `.ts` 配置要**重新构建**（或让 `pnpm dev` 热更新）才生效。

| 配置文件 | 改它能达成什么 |
| --- | --- |
| `siteConfig.ts` | 站点标题/副标题/描述/关键词/域名、主题色相与默认明暗、页面宽度、卡片样式、favicon、导航栏外观、建站日期、时区、分类栏与标签样式、文章列表布局与分页、文章页各项（提醒框主题、分享、相关推荐、OG 图、沉浸阅读）、各第三方（B 站/Bangumi/VNDB/MAL）、图像优化、RSS 内容模式、页面开关 `pages` |
| `profileConfig.ts` | 头像、博主名字、签名、社交链接（图标 + 是否显示文字） |
| `navBarConfig.ts` | 导航菜单项（增删改都在这；每项建议写显式 `id`）与搜索方式 |
| `sidebarConfig.ts` | 侧边栏开关/位置/平板显示哪侧，以及左、右、移动端底部三组组件的顺序与开关 |
| `backgroundWallpaper.ts` | 壁纸模式、桌面/移动壁纸列表、主页横幅文字与打字机、轮播、水波纹、渐变、横幅/全屏各自的导航栏透明与模糊配置 |
| `displaySettingsConfig.ts` | 前台 🎨 设置面板总开关与每个可切换项（主题色、布局、卡片样式、壁纸模式、水波纹、樱花…） |
| `effectsConfig.ts` | 樱花特效参数、页脚时间进度、切换标签页时的标题轮播 |
| `commentConfig.ts` | 评论系统类型与各自参数（本站用 Giscus） |
| `analyticsConfig.ts` | GA / Clarity / Umami / 51la / Cloudflare Web Analytics |
| `musicConfig.ts` | 播放器入口（导航栏/侧边栏/悬浮）、播放模式、音量、歌词、Meting 在线歌单 |
| `announcements.json` | 公告数据（列表 + 固定弹窗公告），由 `announcementConfig.ts` 导入 |
| `music-playlist.json` | 本地歌单数据，由 `musicConfig.ts` 导入 |
| `nav-overrides.json` | 面板写的导航覆盖（隐藏/改名/排序），由 `navBarConfig.ts` 的 `applyNavOverrides()` 应用 |
| `FooterConfig.html` | 页脚（版权行上方）的自定义 HTML |

### 7.1 `siteConfig.ts`

```ts
export const siteConfig: SiteConfig = {
	// 站点标题
	title: "栀海的博客",

	// 站点副标题
	subtitle: "记录技术、折腾与随想",

	// 站点 URL（主域是 www；裸域 zhihaisblog.top 由 Worker 301 跳到这里）
	site_url: "https://www.zhihaisblog.top",
```

```ts
	// 主题色
	themeColor: {
		// 主题色的默认色相，范围从 0 到 360。例如：红色：0，青色：200，蓝绿色：250，粉色：345
		hue: 250,
		// 默认模式："light" 亮色，"dark" 暗色，"system" 跟随系统
		defaultMode: "system",
	},
```

```ts
	// 分页配置
	pagination: {
		// 每页显示的文章数量
		postsPerPage: 10,
	},
```

- 改 `title` / `subtitle` / `description` / `keywords`：影响页头、SEO、OG 卡片与侧边栏站点信息。
- 改 `site_url`：影响 canonical、RSS/Atom、站点地图、`rehypeExternalLinks` 的内外链判定；**换域名时必须同步改**（见 FAQ）。
- 改 `themeColor.hue`：全站主题色（访客还能用 🎨 面板临时改，存本地）。
- 页面开关集中在文件顶部的 `resolvePageToggles({...})`，设为 `false` 的页面会返回 404 并自动隐藏对应导航项（`friends: false`、`guestbook: true`、`dynamic/projects/gallery/booknav/bilibili/bangumi/vndb/mal/sponsor: false`）。

### 7.2 `profileConfig.ts`

```ts
	avatar: "/assets/images/avatar-zhi.webp",

	// 名字（页脚版权、文章作者、OG 卡片等处都会用到）
	name: "栀海",

	// 个人签名
	bio: "记录技术、折腾与随想",
```

```ts
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/Zhi2007",
			showName: true,
		},
```

- 改 `avatar`：头像路径。注释里写明三种写法：`/` 开头走 `public`（不优化、动图必须这样）、不以 `/` 开头走 `src`（自动优化但会失去动画）、或远程 URL。当前用的是 `public/assets/images/avatar-zhi.webp`（动态 WebP）。**一般不用手改这一行**：面板「站点设置 → 站点头像」上传新图时会自动把它指向新文件（另存新文件、不覆盖原图，见第 8.4 节示例 D）。
- 改 `name` / `bio`：页脚版权、文章作者、OG 卡片、侧边栏资料卡。
- 改 `links`：社交图标（支持 `showName` 控制是否显示文字），图标集已预装 `fa7-brands`、`fa7-regular`、`fa7-solid`、`material-symbols`、`simple-icons` 等。

### 7.3 `navBarConfig.ts`

```ts
	// 公告（独立页面，见 src/pages/announcement.astro）
	links.push({
		id: "announcement",
		name: "公告",
		url: "/announcement/",
		icon: "material-symbols:campaign",
	});
```

```ts
// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};
```

```ts
export const navBarConfig: NavBarConfig = applyNavOverrides(
	getDynamicNavBarConfig(),
	normalizeNavOverrides(navOverridesJson),
);
```

- 改 `getDynamicNavBarConfig()` 里的 `links.push(...)`：新增/删除/调整**一级或子级菜单项**（这是唯一能新增菜单项的地方）。
- 每项都写了显式 `id`（如 `home`、`articles`、`links-github`）——面板的隐藏/改名/排序靠它对应；`LinkPresets` 里还有 `pageKey`（如 `friends`），页面关掉时该菜单项会自动消失。
- 改 `navBarSearchConfig.method`：切换站内搜索实现（当前 Pagefind）。
- 最后的 `applyNavOverrides(...)`：把 `nav-overrides.json` 的覆盖应用到菜单上（空覆盖 = 原样返回）。

### 7.4 `sidebarConfig.ts`

```ts
	// 侧边栏位置：
	// left: 仅显示左侧边栏
	// right: 仅显示右侧边栏
	// both: 双侧边栏，1280px以上同时显示左右，769-1279px根据tabletSidebar配置显示其中一侧
	position: "both",

	// 平板端(769-1279px)显示哪侧侧边栏，仅position为both时生效
	tabletSidebar: "left",
```

```ts
		{
			// 组件类型：时间进度（今日 / 本月 / 本年）
			type: "timeProgress",
			// 是否启用该组件
			enable: true,
			// 组件位置
			position: "top",
			// 是否在文章详情页显示
			showOnPostPage: true,
		},
```

```ts
			// 组件专属配置
			specificConfig: {
				// 折叠阈值：当分类数量超过>5个时自动折叠
				collapseThreshold: 5,
			},
```

- 改 `enable` / `position`：整个侧边栏的逻辑；`position: "both"` 时 `tabletSidebar` 决定平板显示哪侧。
- 三组组件列表：`leftComponents` / `rightComponents` / `mobileBottomComponents`，**数组顺序即渲染顺序**（但 `position: "top"` 的会优先于 `"sticky"`）。
- 每项可写 `enable`、`showTitle`、`showOnPostPage`、`hideOnNonPostPage`、`specificConfig`。当前公告与音乐组件在侧边栏是 `enable: false`（公告只在导航栏+弹窗、音乐改成左下角悬浮）。

### 7.5 `backgroundWallpaper.ts`

```ts
	// 壁纸模式："banner" 横幅壁纸，"fullscreen" 全屏壁纸，"overlay" 覆盖透明，"none" 纯色背景无壁纸
	mode: "banner",
```

```ts
		// 主页横幅主标题
		title: "栀海的博客",
```

```ts
			// 主页横幅副标题：开启打字机后会循环显示下面这几条
			subtitle: [
				"记录技术、折腾与随想",
				"把踩过的坑写下来，下次少踩一次",
				"代码、音乐，还有一点生活",
				"欢迎随便逛逛～",
			],
```

```ts
		// 壁纸遮罩暗度，让横幅文字显示更清晰，0-1之间，值越大越暗
		dimOpacity: 0.2,
```

- 改 `mode`：整站壁纸形态（也可让访客用 🎨 面板切，前提是 `displaySettingsConfig.wallpaperModeSwitchable: true`）。
- 改 `common.homeText`：首页横幅主标题、副标题数组、打字机速度、标题下方的链接图标。
- 改 `src.desktop` / `src.mobile`：壁纸图片数组（数组 = 每次刷新随机一张；也可以换成随机图 API 的 URL，注释里有例子）。注释明确建议**不要命名为 `d1-d6` / `m1-m6`**，以免以后被示例图覆盖。
- `playerEnable: false` 表示背景视频已关闭（原远程视频地址已移除）；`common.carousel.enable` 默认也是 `false`。

### 7.6 `displaySettingsConfig.ts`

```ts
		// 生产环境建议默认关闭，只在开发调试环境开启用来预览效果
		enable: true,
```

```ts
		// 壁纸模式切换开关
		wallpaperModeSwitchable: true,
```

```ts
		// 全屏壁纸/透明覆盖模式参数调节开关
		// 设为 false 关闭所有滑块，或用对象形式单独控制每个滑块
		overlaySwitchable: {
			opacity: true,
			blur: true,
			cardOpacity: true,
		},
```

- 改 `enable`：前台是否显示 🎨 设置面板；**打开后设置面板及其依赖会打进客户端产物，约 +33 KB/页**（文件注释原话），首屏 JS 变多。生产环境想省体积可以关掉，只在本地调试时开。
- 也可用环境变量覆盖：`PUBLIC_DISPLAY_SETTINGS=true`（注释里写明"环境变量优先级更高"，取值 `true/1/on/yes` 开、`false/0/off/no` 关）。
- 各分项开关：主题色、列表布局、卡片边框/跟随主题、壁纸模式、全屏布局、水波纹、渐变、横幅标题、壁纸轮播、透明度/模糊/卡片透明度滑块、樱花。关掉某一项 = 前台不出现该控件（但已保存的访客偏好仍会生效）。

### 7.7 `effectsConfig.ts`

```ts
export const sakuraConfig: SakuraConfig = {
	// 是否启用樱花特效
	enable: false,
```

```ts
export const timeProgressConfig: TimeProgressConfig = {
	enable: true,
	title: "时间进度",
```

```ts
export const tabTitleConfig: TabTitleConfig = {
	enable: true,
	titles: ["喂，别走啊 👀", "快回来看看嘛", "页面还在，人没了？"],
	intervalMs: 2500,
};
```

- `sakuraConfig`：樱花特效参数（数量、尺寸、透明度、水平/垂直速度、层级）；当前 `enable: false`，打开后会启用 `src/workers/sakura.worker.ts` 的 Worker。
- `timeProgressConfig`：页脚/侧边栏的今日·本月·本年进度（按访客本地时区算），`showRemaining` 控制是否显示"还剩"。
- `tabTitleConfig`：切到别的标签页时轮播的标题与间隔。

### 7.8 `commentConfig.ts`

```ts
	// 评论系统类型: none, twikoo, waline, giscus, disqus, artalk，默认为none，即不启用评论系统
	type: "giscus",
```

```ts
	//giscus评论系统配置
	giscus: {
		// 设置 Giscus 评论系统仓库
		repo: "Zhi2007/my-blog",
		// 设置 Giscus 评论系统仓库ID
		repoId: "R_kgDOVCbYDg",
```

- 改 `type`：切换评论系统（`none` 关闭）；`waline` / `twikoo` / `artalk` / `disqus` 各自有独立配置块，未启用的块不影响站点。
- Giscus 的关键字段是 `repo` / `repoId` / `category` / `categoryId` / `mapping`（本站用 `pathname`）/ `inputPosition` / `lang` / `loading`。
- 单篇文章可以用 frontmatter 的 `comment: false` 关掉评论。

### 7.9 `analyticsConfig.ts`

```ts
	// Cloudflare Web Analytics（免费、无 cookie）
	// token 获取：Cloudflare 控制台 → Web Analytics → Add a site → 复制 JS 片段里 data-cf-beacon 的 token
	cloudflareWebAnalytics: {
		token: "67aa9433062f4bfda024d65f7f1bfb40",
	},
```

```ts
	// Google Analytics ID
	googleAnalyticsId: "",
	// Microsoft Clarity ID
	microsoftClarityId: "",
```

- 本站实际启用的是 **Cloudflare Web Analytics**（其余 ID 都是空串，等于关闭）。
- 想换统计工具：填 `googleAnalyticsId` / `microsoftClarityId` / `umamiAnalytics.websiteId` / `la51Analytics.Id` 之一即可；`umamiAnalytics` 还能开会话回放（`replays.enabled`）。

### 7.10 `musicConfig.ts`

```ts
	// 悬浮播放器：固定在页面左下角，随页面滚动始终可见；右上角圆钮可收起成一个小圆钮
	floating: {
		enable: true,
		position: "bottom-left",
	},
```

```ts
	// 使用方式："meting" 使用 Meting API（在线歌单），"local" 使用本地音乐列表
	mode: "local",
```

```ts
	// 本地歌单：数据在 src/config/music-playlist.json
	local: {
		playlist,
	},
```

- 改 `floating.enable` / `position`：左下角悬浮播放器开关与位置；`showInNavbar` 控制导航栏入口；`showInSidebar` 是旧的侧边栏组件（当前 `false`）。
- 改 `mode`：`"local"` 用仓库里的歌单，`"meting"` 用在线 Meting API（配置在同文件的 `meting` 块里，含 `api` / `server` / `type` / `id` 与 `fallbackApis`）。
- 改 `volume` / `playMode` / `showLyrics`：默认音量、播放模式、是否显示歌词。
- 加歌最省事的方式是管理面板的「音乐」页（见第 8 节）。

### 7.11 `announcements.json`

```json
[
	{
		"id": "pinned-site-notice",
		"pinned": true,
		"title": "站点公告 · 免责声明 · 侵权处理",
		"published": "2026-10-10",
		"version": "2026-10-10",
		"type": "info",
		"content": "本站已从旧版主题迁移到 Firefly 主题……",
		"links": [
			{ "text": "查看全部公告与开源致谢", "url": "/announcement/" }
		]
	}
]
```

- 字段：`id`（必填、只允许字母数字与 `. _ -`）、`title`、`published`（`YYYY-MM-DD`）、`content`、`type`（`info` / `success` …）、`links[]`（`text` / `url` / 可选 `external`）、`pinned`、`version`。
- `pinned: true` 的那条是"固定公告"：首访弹窗永远展示它；**只能有一条**（体检会报错）。想让所有访客重新看到弹窗，改它的 `version`（或 `id`）——`announcementConfig.modal.storageKey` 记录的正是这个版本号。
- 列表按日期倒序展示；不勾 `pinned` 的公告只进公告页列表。
- **加完功能想告诉回访的老访客**：不用手写 JSON —— 面板「公告」页顶部点「**从最近改动生成更新公告草稿**」，它会读 `git log`（只读）把 `feat:` / `fix:` / `perf:` 整理成中文草稿填进表单（`chore:` / 合并提交自动跳过），你确认或删减后点「保存」，再去「发布」页推送即可上线。规则、接口与边界见 [`admin/README.md`](./admin/README.md) 的「更新公告草稿」一节。

### 7.12 `music-playlist.json`

```json
	{
		"name": "All Eyes On Me",
		"artist": "T.T. STAR; Sunnie; Chaerin; ZENA",
		"url": "/assets/music/all-eyes-on-me.mp3?v=54166e81",
		"cover": "/assets/music/cover/all-eyes-on-me.jpg?v=87cd90ef",
		"lrc": "/assets/music/lrc/all-eyes-on-me.lrc"
	}
```

- 每条记录 5 个字段：`name`（歌名）、`artist`（歌手，可用 `;` 分隔多人）、`url`（音频，`/assets/music/` 下）、`cover`（封面，`cover/` 下，可省略）、`lrc`（歌词，`lrc/` 下，可省略）。
- `?v=` 是**文件内容哈希**，用于破缓存；换了文件就必须换哈希（面板/压缩脚本会自动同步）。详见 [第 9 节](#9-音乐系统)。
- 手动加歌：把音频放进 `public/assets/music/`，封面放 `cover/`、歌词放 `lrc/`，再在这个 JSON 里加一条。单曲建议 ≤ 10 MB（Cloudflare 单个静态资源上限 25 MiB，`musicConfig.ts` 注释写明）。
- **加歌防重复 / 防仓库膨胀**：面板上传会按文件内容哈希去重；上传 >160kbps 的音频会提示「先压缩再发布」并跳过自动发布；`/api/publish` 也会拦住还没压缩的 mp3（`force` 可跳过）。原因是 git 历史不可变：先提交原始大文件再压缩覆盖，两代文件都会永久留在 `.git` 里。详见 `docs/PROJECT-CONTEXT.md` 9.14。

### 7.13 `nav-overrides.json`

```json
{
	"hidden": [],
	"order": [],
	"renamed": {}
}
```

- 三个字段的含义（类型定义在 `src/types/navOverrides.ts`）：`hidden` 隐藏哪些菜单项 id（分组子项全隐藏时整组一起隐藏）、`order` 自定义顺序（未提到的项保持原相对顺序）、`renamed` 把 id 改成新显示名（只改显示名，`url`/`icon`/子菜单都不动）。
- 由 `navBarConfig.ts` 末尾的 `applyNavOverrides()` 在构建时应用；**三个字段都为空 = 完全不影响现有行为**。
- ⚠️ 面板只能**隐藏 / 改名 / 排序**：**新增菜单项必须改 `navBarConfig.ts`**（每项都要有显式 `id`，否则面板读不到它）。

### 7.14 `FooterConfig.html`

```html
<div class="text-xs leading-relaxed opacity-80">
	<a
		class="underline decoration-dotted hover:text-(--primary)"
		target="_blank"
		rel="noopener"
		href="https://github.com/Zhi2007">GitHub</a
	>
```

- 这是页脚（版权行上方）的自定义 HTML 片段，直接改就能改页脚链接。
- 文件顶部注释写明：**页脚下方的 "Powered by Astro & Firefly" 是主题作者要求的署名，请勿删除**；开源项目的完整致谢在 `/announcement/` 公告页与首访弹窗里。
- 面板的「配置」页把它列为可编辑文件之一，所以也可以不改代码直接改。

## 8. 管理面板

`admin/` 是一个**零依赖**的本地 Node 服务（只用 `node:http`、`node:fs`、`node:crypto`、`node:zlib`）。详细用法见 [`admin/README.md`](./admin/README.md)，这一节只讲"怎么启动、有什么、怎么做几件具体的事"。

### 8.1 三种启动方式

| 方式 | 命令 / 操作 | 会看到什么 |
| --- | --- | --- |
| **Windows 双击（推荐）** | 双击项目根目录的 **`firefly-admin.exe`** | 只出现**一个**无标签栏的 Chrome / Edge 窗口；node 在后台隐藏运行，关窗口即停。顶栏可「刷新界面 / 重启后台」，侧栏「后台」页看日志 |
| Windows 双击（旧） | 双击项目根目录的 `启动管理面板.cmd` | 黑窗口先检查 Node 与 `admin\server.mjs`，然后启动服务并自动开浏览器；调试/备用 |
| 命令行 | `node admin/server.mjs` | 终端打印仓库、分支、访问地址（含 `?token=`），并自动打开浏览器 |
| 命令行（自定义） | `node admin/server.mjs --port=8899 --no-open` | 换端口 8899、不自动开浏览器；也可以只加 `--no-open` 用默认端口 |
| 通过 pnpm | `pnpm admin` | 等价于 `node admin/server.mjs` |

默认端口 **8799**（`admin/server.mjs` 的 `PORT = argValue("port", process.env.ADMIN_PORT || 8799)`），也可以用环境变量 `ADMIN_PORT` 覆盖。**窗口/终端关掉服务就停了。**

> `firefly-admin.exe` 的源码在 `admin-launcher/`，重新编译跑 `admin-launcher\build.cmd`（只需 Windows 自带 .NET Framework）。exe 是构建产物，不提交仓库。

### 8.2 认证机制

- 服务只 `listen(PORT, "127.0.0.1")`，局域网与公网都访问不到。
- 默认每次启动生成**一次性令牌**（`randomBytes(16)`），启动信息里的地址形如 `http://127.0.0.1:8799/?token=<hex>`；启动器会通过 `ADMIN_TOKEN` 注入**固定令牌**（在线重启后不失效）。
- 打开页面时令牌被换成 **HttpOnly + SameSite=Strict 的会话 Cookie**（值是用本次令牌做 HMAC-SHA256 的签名，用 `timingSafeEqual` **恒定时间比较**）；页面脚本读不到这个 Cookie。手动 `node admin/server.mjs` 重启后旧 Cookie 自动失效；启动器重启则保持有效。
- 页面加载后会立刻用 `history.replaceState` 把地址栏里的 `?token=` **抹掉**，不留在浏览器历史里；静态页本身也认会话 Cookie，所以 **F5 / 「刷新界面」不会再 403**。
- 接口同时兼容 `X-Admin-Token` 请求头与 `?token=`（`<audio>` 试听、ZIP 下载这类走 URL 的请求需要），`/api/logout` 清除 Cookie。
- 如果看到"认证失败（403）"，用**带令牌的地址**重新打开即可（手动启动时令牌每次都会变）。

### 8.3 十一个页签能做什么

| 页签 | 能做什么 |
| --- | --- |
| **概览** | 看仓库/分支/未提交改动、最近提交、最近一次 GitHub Actions 部署状态、本地是否装了 pnpm；按钮：启动本地预览、本地构建、类型检查 |
| **文章** | 列表 / 新建 / 编辑 / 删除；标题、日期、摘要、标签与分类（带候选下拉，可新增）、封面（可直接上传）、草稿、置顶、密码；Markdown 正文 + 实时预览 + 实时字数；**从 Word / txt 导入**。每篇显示真实文件路径 `src/content/posts/<文件名>` 与它的 URL；编辑器里显示当前文件、图片目录与正文引用到的图片 |
| **公告** | 增删改公告（标题、日期、类型、正文、按钮链接）；勾「固定为弹窗公告」的那条成为首访弹窗；改「弹窗版本号」让所有访客重新看到一次；**「从最近改动生成更新公告草稿」**（读 `git log` 把 `feat:` / `fix:` / `perf:` 整理成中文草稿填进表单，**只产草稿、不自动发布**） |
| **音乐** | 上传音频/封面/歌词并加入歌单；编辑歌曲信息、调整播放顺序、本地试听；数据写 `src/config/music-playlist.json`；一键压缩（先试算 / 只压封面 / 音频+封面）；上传按内容去重、高码率会提示先压缩（发布前会拦住未压缩的 mp3） |
| **媒体** | 按目录查看文章图片、音乐、封面、歌词、头像；上传（可多选）、复制路径、删除；批量转 WebP（默认先试算，只新增 `.webp`，不删原图）。每条显示 `public/assets/...` 下的真实仓库路径 + 体积。**换站点头像请去「站点设置 → 站点头像」**：这里只放文件，不会改配置 |
| **配置** | 直接编辑 `src/config/*` 的白名单文件（含 `FooterConfig.html`、`announcements.json`、`music-playlist.json`） |
| **站点设置** | 可视化表单：站点标题/副标题/描述/关键词/主域/建站日期、页面宽度、导航栏标题、主题色相与默认明暗、卡片样式、博主名字/签名/头像、壁纸模式与暗度、主页横幅标题与副标题（每行一条）、显示设置面板各项开关、页面开关、导航菜单（隐藏/改名/排序）。顶部还有**站点头像**卡片：缩略图 + 「上传新头像…」+「恢复默认」（另存新文件、不覆盖原图、可回滚；见 8.4 示例 D）。表单按用途分了 7 组，每项一张卡片（标题 + 说明 + 控件），写入位置收在「写进 …」折叠里；页面开关用中文名 + 原 key 展示。所有写入前自动备份，写完回读校验，不一致立即回滚 |
| **体检 / 备份** | 一键体检（10 项：JSON 合法性、歌单引用、公告完整性、**文章 frontmatter**、**文章 schema（跑真实 `astro build`）**、站内链接、疑似密钥、异常大文件、配置矛盾、Git 状态）；写前快照列表 + 一键恢复 + 导出 ZIP + **保留份数可调（任意正整数）**；CI 部署状态（失败时全页红色横幅 + 一键回滚该提交） |
| **发布** | 同步状态（待推送/落后远端/最后提交时间/最近部署结果）、自动同步开关、一键 `commit + push`、从 GitHub 拉取同步、查看部署状态与完整日志；**推送前自动体检，有 error 会拦住**；工作区干净但本地有未推送提交时，点「立即发布」会直接推送这批提交（不造空提交）—— 文章 frontmatter 写错（例如日期被引号包住 `published: "2026-10-11"`，会让 CI 报 `Expected type "date", received "string"`）现在会在发布前被拦下，并直接告诉你「改哪个文件、哪个字段、怎么改」 |
| **后台** | 后台状态（PID / 端口 / 运行时长 / 是否启动器托管）；实时后台日志（2 秒自动刷新、复制、📂 打开日志文件）；「重启后台」（仅 `firefly-admin.exe` 托管时可用，保留端口和登录状态，页面自动重连）；「刷新界面」 |

拖拽上传的落点按当前页签判断（音乐页 → `public/assets/music/`；媒体页 → 下拉框选中的目录；其它页 → `src/content/posts/images/`）。

**面板会写明文件存在哪（路径徽章）**：文章列表显示 `src/content/posts/<文件名>`（文件名同时决定 URL `/posts/<文件名>/`），编辑器显示当前文件与它引用的图片，媒体页显示 `public/assets/...`，公告 / 歌单 / 友链 / 导航 / 站点设置 / 头像 / 备份 / 发布页各自显示自己的数据文件与「写进哪个文件的哪个块」；每条路径都能**一键复制**（复制后按钮显示 2 秒「已复制」），Windows 上还可以点 📂「打开所在文件夹」直接定位到文件。这些路径都来自后端真实读取（`fs.readdir` / `git status` / 实际写入路径），文件不存在时会明确标 ⚠️，不会给出一个编造的位置。约定见 [`admin/README.md`](./admin/README.md) 的「路径徽章」一节与 `docs/PROJECT-CONTEXT.md` 第 9.10 节。

### 8.4 四个操作示例

**示例 A：发一篇带封面和标签的文章**

1. 双击 `启动管理面板.cmd`，浏览器里打开自动弹出的地址（带 `?token=`）。
2. 进「文章」页 → 点「新建文章」。
3. 填「文件名（slug）」，例如 `my-first-post`（它决定 `src/content/posts/my-first-post.md`，也就决定 URL `/posts/my-first-post/`）。
4. 点「上传封面…」选图片：文件会进 `src/content/posts/images/`，封面字段自动填成 `./images/xxx`（若已有正文，单张图片也会顺手填成封面）。
5. 填标题、日期、摘要；标签与分类用带候选下拉的输入框（可以直接新增一个）。
6. 在编辑器里写 Markdown，右侧实时预览、下方实时字数。
7. 点「保存」——写入文章文件，**保存前会自动把原文件快照到 `admin-backups/`**。
8. 若「发布」页的**自动同步**开着，这一步已经自动提交并推送；否则去「发布」页点「**立即发布**」。
9. 到「发布」页看部署状态（GitHub Actions 约 1 分钟；失败会有红色横幅）。

**示例 B：换一条首页公告，并让所有访客重新看到弹窗**

1. 进「公告」页，新建或编辑公告：标题、日期、类型（info/success…）、正文、按钮链接。
   - 刚加完功能、只想告诉大家"更新了什么"？点上方「**从最近改动生成更新公告草稿**」：留空起始点 = 自上次公告之后，也可手填天数（如 `30`）或提交 sha；它会读 `git log`（**只读**）把 `feat:` / `fix:` / `perf:` 分成「新增 / 修复 / 优化」填进表单并给出提示。**它只产草稿**：确认/删减后再点「保存」，然后照下面第 4 步发布。
2. 勾选「**固定为弹窗公告**」——固定公告只能有一条，勾了它，首访弹窗就展示它（其余公告只进公告页列表）。
3. 把「**弹窗版本号**」改成新的值（例如今天的日期）。访客浏览器里存的正是这个版本号（`announcementConfig.modal.storageKey = "zhi-blog-announcement-version"`），**只改内容不改版本号，老访客不会再看到**。
4. 保存 → 发布。
5. 想验证：用无痕窗口打开站点，约 0.6 秒后（`modal.delayMs: 600`）会弹出新公告。

**示例 C：上传一首歌并让它带歌词**

1. 进「音乐」页，把 `.mp3` 直接拖到页面上（会自动进 `public/assets/music/`）。
2. 上传时面板会读音频自带的标签（MP3 的 ID3v2 `TIT2`/`TPE1`/`APIC`/`USLT`/`SYLT`、FLAC 的 Vorbis Comment、M4A 的 `ilst`）：歌名/歌手自动回填，内嵌封面写进 `cover/`，歌词写进 `lrc/`，并**直接加进歌单**。
3. 如果内嵌歌词只有纯文本（没有时间戳），面板会读取音频时长后**按长度平均铺开**成 LRC，提示里会标注是"粗略同步"。
4. 想要**逐行高亮**：把带时间戳的 `.lrc` 拖进音乐页（或点「从音频重新提取」重新读标签），替换掉那份粗略版本。
5. 在列表里点本地试听确认（试听走 `/media-file?token=…&path=…`：`<audio>` 标签只能把令牌放 URL 里）。
6. 保存 → 发布。若线上还是旧音频/旧封面，见 FAQ 的"缓存"一条：用面板或压缩脚本同步 `?v=` 内容哈希。

**示例 D：换一张站点头像**

1. 进「站点设置」页，最上面就是**站点头像**卡片：左边是当前头像缩略图，右边是路径 + 体积。
2. 点「**上传新头像…**」选图片（`png` / `jpg` / `jpeg` / `webp` / `avif` / `gif`，≤ 25 MB）。面板会自动等比缩小到最长边 512px（**动图与 GIF 不缩**，避免丢帧）、去掉 EXIF，然后另存为 `public/assets/images/avatar-<内容哈希>.<格式>`。
3. 确认后它会**顺手改写 `src/config/profileConfig.ts` 的 `avatar` 字段**，页面上的头像立刻指到新文件 —— 原头像 `avatar-zhi.webp` **不会被覆盖**，随时可以点「**恢复默认**」切回去（已上传的图也不会被删）。
4. 到「发布」页推送。头像和配置都在面板的提交范围里（`public/assets`、`src/config`），不会出现"换了头像但没提交"。
5. 想手改也行：把图片放进 `public/assets/images/`，再把 `profileConfig.ts:14` 的 `avatar` 改成 `/assets/images/<文件名>`（动图必须走 `public`，见第 7.2 节）。

> 更细的说明（表格字段、拖拽规则、体检项、快照目录结构、压缩参数白名单等）都在 [`admin/README.md`](./admin/README.md)，这里不重复维护。

## 9. 音乐系统

### 9.1 数据在哪

| 文件 / 目录 | 内容 |
| --- | --- |
| `src/config/music-playlist.json` | 歌单（唯一的"数据源"，播放器只读它） |
| `src/config/musicConfig.ts` | 播放器行为（悬浮位置、模式、音量、播放模式、歌词开关）+ `local.playlist` 引用上面的 JSON |
| `public/assets/music/*.mp3` | 音频 |
| `public/assets/music/cover/*` | 封面图 |
| `public/assets/music/lrc/*.lrc` | 歌词 |

### 9.2 歌单记录结构（真实示例）

```json
{
	"name": "All Eyes On Me",
	"artist": "T.T. STAR; Sunnie; Chaerin; ZENA",
	"url": "/assets/music/all-eyes-on-me.mp3?v=54166e81",
	"cover": "/assets/music/cover/all-eyes-on-me.jpg?v=87cd90ef",
	"lrc": "/assets/music/lrc/all-eyes-on-me.lrc"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 歌名（列表与播放器显示） |
| `artist` | string | 是 | 歌手；多人可用 `;` 分隔（现网数据里就是这么写的） |
| `url` | string | 是 | 音频地址，`/assets/music/` 下；`?v=` 是**内容哈希**，用于破缓存 |
| `cover` | string | 否 | 封面地址，`cover/` 下；没有就显示默认样式（歌单里有歌确实没有 `cover`，如 `enchanted love`） |
| `lrc` | string | 否 | 歌词地址，`lrc/` 下；缺省则该曲无歌词 |

关于 `?v=`：它是文件内容的短哈希（`compress-music.mjs` 里用 `createHash` 算前 8 位）。Worker 对 `/assets/music/` 下的音频给 `max-age=86400`、封面给 `max-age=604800`（`worker/index.mjs` 的 `serveMedia`），所以**文件名不变、内容变了**时必须换 `?v=`，否则浏览器和 CDN 会继续用旧缓存。

### 9.3 歌词：`.lrc`

- 播放器读的是 **`.lrc` 文件**（不是音频内嵌标签）。
- **只有带时间戳的行**（形如 `[00:12.34]歌词`）才能逐行高亮与滚动；纯文本歌词只能被"按长度平均铺开"成粗糙时间轴（面板导入时会明确提示是粗略同步）。
- 内嵌在音频里的歌词不会被压缩脚本保留（脚本注释原话：`内嵌在音频里的歌词（TXXX/USLT）不会被保留：请先确认每首歌都有 .lrc 文件`）。

### 9.4 一键压缩（音乐 / 封面）

```bash
# 先看会处理哪些文件、预计省多少（推荐每次都先跑）
node scripts/compress-music.mjs --dry-run

# 只压封面（PNG→JPEG，最长边限制 600px）
node scripts/compress-music.mjs --covers

# 音频 + 封面一起处理
node scripts/compress-music.mjs --all

# 其它参数：目标码率（默认 128k）、强制重编、指定目录
node scripts/compress-music.mjs --bitrate 160k
node scripts/compress-music.mjs --force
node scripts/compress-music.mjs --dir <路径>
```

| 参数 | 行为 |
| --- | --- |
| （不带参数） | ⚠️ **等于压缩音频并改写歌单**：`doAudio = !args.includes("--covers") \|\| args.includes("--all")` 为真，会把 `> 128kbps` 的 mp3 重编码并原地覆盖 |
| `--dry-run` | 只列出待处理文件与预估体积，不写任何文件（也不会改歌单） |
| `--covers` | 只处理封面（`cover/` 下的 png/jpg），PNG 会转成同名 `.jpg` 并删除原 PNG，同时把歌单里的封面路径改成新文件名 |
| `--all` | 音频 + 封面都处理 |
| `--bitrate 160k` | 指定音频目标码率（默认 `128k`） |
| `--force` | 已经低于目标码率的也重新编码（会有二次损失） |
| `--dir <路径>` | 换音乐目录；**此时不会改歌单**（`syncPlaylist` 在 `dirArg` 存在时直接返回） |

脚本会做的三件重要的事：

1. **保留标签与封面**：`-map_metadata 0` 保留标题/艺术家，`-c:v copy` 保留内嵌封面（只取第一张），输出用 ID3v2.3。
2. **回读校验后才替换**：转码后用 `admin/audio-meta.mjs` 回读校验（码率可解析、体积确实变小、封面/标题没丢），任一项不过就**不替换**原文件。
3. **同步歌单 `?v=` 哈希**：处理完把歌单里音频与封面的地址重算成 `?v=xxxxxxxx`（文件没变哈希就不变），并把封面重名（`.png` → `.jpg`）同步进去。

需要 **ffmpeg**：脚本依次尝试 `FFMPEG_PATH` 环境变量 → `PATH` → 常见安装位置（`C:\ffmpeg\bin\ffmpeg.exe`、winget Links、scoop shims、`/usr/bin/ffmpeg`、`/usr/local/bin/ffmpeg`、`/opt/homebrew/bin/ffmpeg`）；找不到会直接报错退出并提示 `winget install Gyan.FFmpeg`。面板里的「一键压缩」走的是同一个脚本，参数由服务端白名单拼接（`--dry-run` / `--covers` / `--all`），**不会**误触发"不带参数"的破坏性行为。

## 10. 部署到 Cloudflare

### 10.1 自动化流程（GitHub Actions）

`.github/workflows/deploy.yml`：`push` 到 `main`、`pull_request`、`workflow_dispatch` 触发；同一分支连续推送只保留最后一次（`concurrency` + `cancel-in-progress`）；`timeout-minutes: 20`。

| 步骤 | 内容 |
| --- | --- |
| Checkout | `actions/checkout@v7` |
| Setup pnpm | `pnpm/action-setup@v4`（`run_install: false`） |
| Setup Node.js | `actions/setup-node@v7`，`node-version: 24`，`cache: pnpm` |
| Install dependencies | `pnpm install --frozen-lockfile` |
| Build site | `pnpm run build` |
| Check Cloudflare credentials | 非 PR 时检查两个 Secret 是否为空，缺了就 `::error::` 失败退出 |
| Deploy to Cloudflare Workers | 非 PR 时用 `cloudflare/wrangler-action@v4`（`apiToken` / `accountId`） |

**必需的仓库 Secrets（名字照 workflow 里写）**：

| Secret | 从哪拿 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 控制台 → My Profile → API Tokens → 用 **Edit Cloudflare Workers** 模板创建 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台 Workers & Pages 页面右侧栏 |

> PR 只做构建校验，不部署；`permissions: contents: read`（只读权限）。

### 10.2 `wrangler.jsonc` 里的部署事实

```jsonc
{
	"name": "my-blog",
	"main": "worker/index.mjs",
	"compatibility_date": "2025-01-01",
	"compatibility_flags": ["nodejs_compat"],
	"assets": {
		"directory": "./dist",
		"binding": "ASSETS",
		"run_worker_first": true,
		"not_found_handling": "404-page"
	},
	"routes": [
		{ "pattern": "zhihaisblog.top", "custom_domain": true },
		{ "pattern": "www.zhihaisblog.top", "custom_domain": true }
	]
}
```

| 字段 | 含义 / 影响 |
| --- | --- |
| `name: "my-blog"` | Worker 名称，也决定 `*.workers.dev` 子域（旧的 `my-blog.mc20070831.workers.dev` 仍可用） |
| `main: "worker/index.mjs"` | Worker 入口脚本 |
| `assets.directory: "./dist"` | 把 `pnpm build` 的产物作为静态资源上传 |
| `assets.binding: "ASSETS"` | 在 Worker 里通过 `env.ASSETS.fetch(...)` 取静态资源 |
| `assets.run_worker_first: true` | **所有请求先经过 Worker**（不是只过 `/assets/music/*`）。裸域 301、旧地址 301、音乐 Range、安全头都在 Worker 里做 |
| `assets.not_found_handling: "404-page"` | 未知路径返回 `dist/404.html`；如果改回默认值，会退回 Cloudflare 的纯文本 404 |
| `routes` | 两个 `custom_domain: true` 的自有域名；域名已托管在 Cloudflare，部署时会自动创建 DNS 记录并签发证书 |

本地手动部署（不走 CI）：

```bash
pnpm build                    # 先出 dist/
pnpm exec wrangler deploy     # 首次会打开浏览器授权登录 Cloudflare
```

首次 `wrangler deploy` 授权后会打印形如 `https://my-blog.<你的子域>.workers.dev` 的地址，那里就带 HTTPS 了。

### 10.3 Worker 负责什么（以及为什么非它不可）

`worker/index.mjs` 的注释把理由写在最前面：Workers 静态资源既不处理 Range 请求，也不支持按域名匹配的跳转，而 `_redirects` / `_headers` 里的规则**又不作用于 Worker 处理的响应**，所以这几件事只能在代码里做：

| 职责 | 实现位置 | 为什么不能交给静态资源 / 配置文件 |
| --- | --- | --- |
| 裸域 `zhihaisblog.top` → **301** `www.zhihaisblog.top`（保留路径与查询串） | `url.hostname === APEX_HOST` 分支 | `_redirects` 不支持按域名匹配 |
| 旧地址 **301**：`/blog` → `/archive/`、`/blog/` → `/archive/`、`/blog/<slug>/` → `/posts/<slug>/` | `legacyRedirect()` | 静态资源不做跳转；`_redirects` 不作用于 Worker 响应 |
| `/assets/music/*` 的 **206 Partial Content**（Range）、`Accept-Ranges`、`Content-Length`、`ETag` 304、`HEAD`、越界 416、非 GET/HEAD 405 | `serveMedia()` + `parseRange()` | Workers 静态资源忽略 `Range`，浏览器就无法边下边播、无法拖动进度条 |
| 给静态资源补**安全响应头**（HSTS / CSP / nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / X-XSS-Protection） | `SECURITY_HEADERS` + `serveAsset()` | `_headers` 不作用于 Worker 响应（`public/_headers` 里也写着"本文件目前只是文档"） |
| **缓存策略**：`/_astro/*` → `max-age=31536000, immutable`；`/pagefind/*` → `max-age=604800`；音频 86400 / 封面 604800 / 其它音乐文件 3600 | `serveAsset()` / `serveMedia()` | 同上，头要自己设 |
| 异常兜底：任何异常先回退 `env.ASSETS.fetch(request)`，再失败才返回 503 纯文本"服务暂时不可用" | `catch` 块 | 保证 Worker 出问题时站点仍能打开 |

### 10.4 域名与 DNS 要点

- **域名托管在 Cloudflare**（Nameserver 已在 Cloudflare），`routes` 里的两个 `custom_domain` 会在部署时自动创建解析记录并签发证书，通常 1–15 分钟生效。
- **HTTPS/HSTS 是代码里下发的**：`worker/index.mjs` 的 `SECURITY_HEADERS` 每个响应都带 `strict-transport-security: max-age=15552000; includeSubDomains`，不需要再去控制台单独开 HSTS。
- **DNSSEC**：在 Cloudflare 控制台开启后，需要到域名注册商处添加 DS 记录；**算法请选 `ECDSA Curve P-256 with SHA-256`**（Cloudflare 现在签发的就是这个），不要选 RSA/SHA-256，否则校验会失败。（这是控制台侧的操作，仓库里没有对应文件。）
- **CAA 记录不要删**：它是"只允许指定 CA 给本域签发证书"的声明；Cloudflare 用它自动签发/续期证书，删掉或被改错会导致证书签发失败、HTTPS 直接不可用。
- 换域名时要**同时改两处**：`src/config/siteConfig.ts` 的 `site_url`（影响 canonical / RSS / 站点地图 / 内外链判定）与 `wrangler.jsonc` 的 `routes`（决定 Worker 绑定哪些域名）；`worker/index.mjs` 里的 `CANONICAL_HOST` / `APEX_HOST` 也要跟着改。

## 11. 常见问题 FAQ

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 本地 `pnpm build`（或 `pnpm dev`）报 `require is not defined`，栈里出现 `picomatch` | 本地 `node_modules` 与 `pnpm-lock.yaml` 不一致，`.pnpm` 里残留了旧版 vite（本次实测报错位置就是 `node_modules/.pnpm/picomatch@4.0.7/.../index.js` + `vite@8.3.4` 的 module-runner） | 双击根目录的 `重建依赖.cmd`：它会自动探测仓库（判定 `package.json` + `wrangler.jsonc` + `src\config`）、删掉 `node_modules`、跑 `pnpm install --frozen-lockfile`，全过程写日志到 `logs/`（已 gitignore）。等价的手工命令是 `rm -rf node_modules && pnpm install --frozen-lockfile` |
| 音乐不能拖动进度条、不能边下边播 | Cloudflare Workers 静态资源忽略 `Range` 请求头，不会返回 206 | 已由 `worker/index.mjs` 的 `serveMedia()` 实现（206 + `Content-Range` + `Accept-Ranges` + ETag 304 + HEAD）；前提是 `assets.run_worker_first: true` 让它接管请求 |
| 加了新功能后被浏览器拦（控制台 CSP 报错） | `worker/index.mjs` 的 `SECURITY_HEADERS` 里 CSP 是白名单制（`default-src 'self'`） | 改 `worker/index.mjs` 的 `SECURITY_HEADERS["content-security-policy"]`，并在注释里写清为什么放行。⚠️ `public/_headers` 在 `run_worker_first: true` 下**已不生效**（它自己也标了"只是文档"），改它没用 |
| 换了域名，RSS/站点地图/分享链接还是旧域名 | `siteConfig.site_url` 是 canonical / RSS / sitemap 的来源 | 同时改 `src/config/siteConfig.ts` 的 `site_url` 与 `wrangler.jsonc` 的 `routes`；Worker 的 `CANONICAL_HOST`/`APEX_HOST` 也要改 |
| 访问一个不存在的路径，返回的是纯文本 404 而不是站点 404 页 | `not_found_handling` 决定未知路径的兜底 | `wrangler.jsonc` 里已设为 `"404-page"`（用 `dist/404.html`）；如果被改回默认值就会复现 |
| 换了歌单/封面，页面还是旧的 | 缓存：音频 `max-age=86400`、封面 `max-age=604800`（`serveMedia`），且 `?v=` 内容哈希没变 | 用面板「音乐」页的操作同步，或跑 `node scripts/compress-music.mjs --all`（会重算 `?v=`）；确认 `music-playlist.json` 里的 `?v=` 确实变了 |
| 想新增一个导航菜单项，面板里找不到入口 | 面板只做**隐藏/改名/排序**（写 `nav-overrides.json`），不新增 | 手工编辑 `src/config/navBarConfig.ts`，在 `getDynamicNavBarConfig()` 里 `links.push({...})`，每项都要写显式 `id`（否则面板读不到它） |
| 文章必须是 Markdown 吗 | Astro 内容集合 `posts` 的 loader 是 `glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" })`，只认 `.md` / `.mdx` | 是。要写 Word/txt 就用面板「文章」页的「从 Word / txt 导入」（`.docx`/`.txt`/`.md`，见第 6.3 节） |
| 面板报「认证失败（403）」或「令牌无效，请重新启动管理后台」 | 令牌是**每次启动随机生成**的，旧链接/旧书签里的令牌已失效 | 用启动时打印的带 `?token=` 的地址重新打开；或重启面板（`node admin/server.mjs`）拿新地址 |
| `pnpm install` 被拦住、要求用 pnpm | `package.json` 的 `preinstall` 是 `npx only-allow pnpm` | 改用 pnpm（`corepack enable pnpm` 或 `npm i -g pnpm`）；不要用 npm/yarn 装依赖 |
| 面板「一键压缩」里的"先试算"会不会误压音频 | 不会：面板固定拼 `--dry-run`，而 `compress-music.mjs` **不带参数**才等于"压缩音频 + 改写歌单" | 命令行自己跑时，务必先加 `--dry-run` |
| 音频/封面很大，部署包也变大 | 单曲建议 ≤ 10 MB（Cloudflare 单个静态资源上限 25 MiB） | 用 `pnpm compress-music`（或面板「音乐」页的压缩按钮）压到 128kbps，封面转 JPEG 并限制 600px |

## 12. 安全

### 12.1 站点侧已启用的措施

全部由 `worker/index.mjs` 的 `SECURITY_HEADERS` 对**每个响应**下发（`public/_headers` 里有同名配置，但在 `run_worker_first: true` 下不生效）：

| 响应头 | 值 / 放行了什么 | 为什么 |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | 强制 HTTPS，防降级与 SSL 剥离（防 DNS 劫持后访问假站点） |
| `Content-Security-Policy` | `default-src 'self'`；`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://giscus.app https://static.cloudflareinsights.com`；`style-src 'self' 'unsafe-inline'`；`img-src 'self' data: blob: https:`；`media-src 'self' blob:`；`font-src 'self' data:`；`connect-src 'self' https:`；`frame-src https://giscus.app`；`worker-src 'self' blob:`；`frame-ancestors 'self'`；`base-uri 'self'`；`object-src 'none'`；`form-action 'self'` | 限制页面能加载的来源，防注入。每一项都有依据：`'unsafe-inline'` 是主题的内联初始化脚本/样式；`'wasm-unsafe-eval'` 是 Pagefind 的 WebAssembly；`img-src blob:` 是 Fancybox 用 `URL.createObjectURL` 处理 SVG；`img-src https:` 是远程壁纸/随机封面 API；`giscus.app` 是评论区；`static.cloudflareinsights.com` 是 Cloudflare 统计；`worker-src blob:` 是樱花 Worker |
| `X-Content-Type-Options` | `nosniff` | 防 MIME 嗅探 |
| `X-Frame-Options` | `SAMEORIGIN` | 防点击劫持（CSP 的 `frame-ancestors 'self'` 是同一件事的现代写法） |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 跨站只发 origin，避免内链泄漏路径 |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | 一律禁用不需要的浏览器能力 |
| `X-XSS-Protection` | `0` | 关掉已废弃的旧 XSS 过滤器（避免它自己引入问题） |

另外：`worker/index.mjs` 的兜底 503 只回一句纯文本"服务暂时不可用，请稍后重试。"，**不回显内部错误细节**。

### 12.2 管理面板的安全模型

| 措施 | 实现 |
| --- | --- |
| 只监听本机 | `server.listen(PORT, "127.0.0.1")`，局域网与公网都连不上 |
| 一次性令牌 | 每次启动 `randomBytes(16).toString("hex")`；页面必须带 `?token=` 才给（不带 Cookie 也进不去） |
| HttpOnly 会话 Cookie | 值 = `HMAC-SHA256(本次令牌, "admin-session")`，`HttpOnly; SameSite=Strict; Path=/`；脚本读不到，重启即失效 |
| 恒定时间比较 | 令牌与 Cookie 都用 `crypto.timingSafeEqual`（先比长度再比内容） |
| 页面不带令牌 | 登录后 `history.replaceState` 抹掉地址栏里的 `?token=`，不留在历史里 |
| 路径白名单 | `safeResolve()`（先 `path.resolve` 再带 `path.sep` 前缀比较，挡住 `../` 与同名前缀目录）+ `resolveInside(relative, allowedPrefixes)`；可写的只有 `src/config/*` 白名单文件、`src/content/posts/` 与几个媒体目录 |
| 上传类型白名单 | `UPLOAD_EXT`：文章图片/封面/头像只收 `png/jpe?g/webp/avif/gif`，音乐只收 `mp3/m4a/aac/flac/wav/ogg/opus`，歌词只收 `.lrc`（注释原话：避免把 `.html`/`.svg` 这类可带脚本的文件传进站点目录）。**站点头像再额外做一层文件头「魔数」校验**（`admin/avatar.mjs`）：把 txt / PHP 改名成 `.png` 也传不进去，落盘扩展名以真实格式为准 |
| 请求体上限 | `readBody()` 超过 **64 MB** 直接拒绝；导入文档另有 25 MB 上限；换头像另有 25 MB 上限 |
| 写前快照 | 任何写入前把原文件复制到 `admin-backups/`（已 gitignore，默认保留最新 40 份，保留份数可在面板「体检 / 备份」页改为任意正整数）；恢复前还会再给"当前版本"打一份快照 |
| 设置写入校验 | 只允许 `admin/settings.mjs` 的 `SETTINGS_DEFS` 白名单字段 + 类型/范围/枚举校验 + 括号结构体检 + 回读校验，不一致立即回滚 |
| 不支持危险改写 | `nav.mjs` 只读写 `nav-overrides.json`，明确**不改写 TS 源码**（注释：改坏一个字符整个构建就挂） |
| 命令参数白名单 | 压缩音乐只允许 `--dry-run` / `--covers` / `--all` 三种，由服务端拼接；`/api/run` 只允许 `build` / `dev` / `check` |

### 12.3 不要提交密钥

- Cloudflare 的 API Token 与 Account ID **只放 GitHub 仓库 Secrets**（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`），不要写进任何提交的文件。
- `src/config/siteConfig.ts` 的 `vndb.apiToken` 处有明确警告：**不要把真实令牌提交到公开仓库**（当前为空串）。
- 面板体检里的「疑似密钥」检查项会扫 `ghp_` / `sk-` / 私钥 / Cloudflare Token 等模式；发布前也会自动跑一遍，出现 error 会拦住 push。
- `.gitignore` 已排除 `.env` / `.env.production` / `dist/` / `node_modules/` / `logs/` / `admin-backups/` / `public/vndb-covers/`。

## 13. 署名与许可

本站基于 [CuteLeaf/Firefly](https://github.com/CuteLeaf/Firefly)（MIT，作者 [CuteLeaf](https://github.com/CuteLeaf)）二次开发；Firefly 又源自 [saicaca/fuwari](https://github.com/saicaca/fuwari)（MIT，作者 [saicaca](https://github.com/saicaca)）。

| 内容 | 版权 / 许可 |
| --- | --- |
| 主题与构建代码（Firefly） | © CuteLeaf，MIT，见 [LICENSE](./LICENSE) |
| 上游主题（Fuwari） | © saicaca，MIT |
| 本站文章、图片与个性化配置 | © 2026 栀海，保留所有权利 |
| Live2D 模型、字体、音乐、图标等素材 | 版权归各自原作者，各依其原许可协议 |

- 上游原始 README 完整保留在 [UPSTREAM-README.md](./UPSTREAM-README.md)；另有英文版说明 [README.en.md](./README.en.md)。
- 完整署名清单（主题框架、功能模块、服务、素材、原创内容）见 [CREDITS.md](./CREDITS.md)，站点上的对应页面是 `/announcement/`（公告页，首访弹窗也展示它）。
- 页脚的 "Powered by Astro & Firefly" 是主题作者要求的署名，`src/config/FooterConfig.html` 注释里写明**不要删除**。
- 感谢 Astro、Pagefind、Giscus、Expressive Code、Tailwind CSS、Svelte、KaTeX、Swup、Iconify、l2d-widget、sharp 等开源项目与它们的作者们。
- 如果某个项目遗漏了署名，欢迎提 [issue](https://github.com/Zhi2007/firefly-blog/issues) 指出来。

---

最后更新：仓库提交 `888144c`（2026-10-11，`feat(admin): 文章页支持从 Word(.docx) / txt / md 导入并自动转 Markdown`）。
