# 栀海的博客

个人博客站点：**Astro + [Firefly](https://github.com/CuteLeaf/Firefly) 主题**，构建产物托管在 **Cloudflare Workers** 静态资源上（自动 HTTPS、全球 CDN、零服务器成本）。

- 线上地址：<https://zhihaisblog.top>
- 关于我：<https://zhihaisblog.top/about/>

> **署名**：本仓库基于 [CuteLeaf/Firefly](https://github.com/CuteLeaf/Firefly)（MIT，作者 [CuteLeaf](https://github.com/CuteLeaf)）二次开发；Firefly 又源自 [saicaca/fuwari](https://github.com/saicaca/fuwari)（MIT，作者 [saicaca](https://github.com/saicaca)）。
> 上游原始 README 完整保留在 [UPSTREAM-README.md](./UPSTREAM-README.md)，所有上游项目与素材的署名清单见 [CREDITS.md](./CREDITS.md)，许可证见 [LICENSE](./LICENSE)。

## 快速开始

```sh
pnpm install     # 需要 Node ≥ 22.23 与 pnpm
pnpm dev         # 本地开发：http://localhost:4321
pnpm build       # 完整构建：LQIP → Astro → 字体子集化 → Pagefind 索引
pnpm preview     # 预览构建产物
pnpm admin       # 图形化管理后台（也可双击根目录的「启动管理面板.cmd」）
pnpm compress-music   # 把音乐压到 128kbps（体积约降到 1/3，需要 ffmpeg，可加 --dry-run 先看）
```

> 必须用 **pnpm**（`package.json` 里的 `preinstall` 会拦住 npm/yarn）。首次安装约几百 MB，首次构建约 1–3 分钟。

## 部署形态（Cloudflare Workers）

静态产物托管在 Cloudflare Workers 上，另有一个极小的 Worker 脚本 `worker/index.mjs`：

- `wrangler.jsonc` 的 `assets.directory = ./dist`，`assets.binding = ASSETS`
- `assets.run_worker_first = ["/assets/music/*"]`：**只有音乐目录**先经过 Worker，其余请求仍由静态资源直接响应
- 该 Worker 为音频/封面/歌词实现 `206 Partial Content`（Range）、`Content-Length`、`Accept-Ranges`、ETag 304 与 HEAD
  —— 因为 Workers 静态资源不返回这些头也不处理 Range，浏览器无法边下边播、无法拖动进度条
- 域名绑定在 `routes` 里（`zhihaisblog.top` 与 `www.zhihaisblog.top`，`custom_domain: true`），部署时由 Cloudflare 自动建解析并签发证书
- 安全响应头在 `public/_headers`（HSTS、CSP 观察模式等）；Worker 返回的响应不会应用该文件，所以 `worker/index.mjs` 里重复设置了同样几个头

## 图形化管理后台（推荐）

不想敲命令就用它：写文章、传图片/音乐、改配置、一键发布，全部在浏览器里点。

- **启动**：双击项目根目录的 `启动管理面板.cmd`，或执行 `node admin/server.mjs`
- **发布**：后台里点一下 = `git commit + push`，之后 GitHub Actions 自动构建并部署（约 1 分钟），本地不需要装 pnpm
- **安全**：只监听 `127.0.0.1`，每次启动生成一次性访问令牌，不暴露到公网
- 详细介绍见 [admin/README.md](./admin/README.md)

## 写一篇文章

在 `src/content/posts/` 新建 `.md` 文件：

```yaml
---
title: 文章标题
published: 2026-10-10
description: 一句话摘要
tags: [标签一, 标签二]
category: 分类名
image: ./images/cover.png # 可选封面，图片放 src/content/posts/images/
pinned: false
draft: false
---

正文用 Markdown 写。
```

其它可选字段：`updated`（更新日期）、`password`（加密文章）、`series` / `seriesOrder`（系列）、`comment: false`（该篇关闭评论）、`sourceLink`、`licenseName`。

## 配置在哪

所有配置都在 `src/config/`，改完重新构建即可：

| 想改什么 | 文件 |
| --- | --- |
| 站点标题、副标题、域名、主题色相（`hue`）、导航栏、页面开关 | `siteConfig.ts` |
| 导航菜单项 | `navBarConfig.ts` |
| 头像、昵称（栀海）、签名、社交链接 | `profileConfig.ts` |
| 侧边栏组件与顺序 | `sidebarConfig.ts` |
| 评论（Giscus：仓库 / categoryId / 映射方式） | `commentConfig.ts` |
| 统计（Cloudflare Web Analytics、GA、Umami、51la） | `analyticsConfig.ts` |
| 音乐播放器（本地音乐 / 在线歌单） | `musicConfig.ts` |
| 页脚时间进度、切标签页标题、樱花特效 | `effectsConfig.ts` |
| 看板娘（Live2D / Spine） | `pioConfig.ts` |
| 页脚自定义内容（开源署名） | `FooterConfig.html` |

## 本站相对原版的改动

1. **修复 katex CJS 入口**：`astro.config.mjs` 改用 `katex/dist/katex.mjs`，避免 Vite 8 加载配置时报 `require is not defined`
2. **Vite 固定 8.3.4**（`package.json`）：上一条报错的根因修复
3. **新增 Cloudflare Web Analytics**：`src/components/analytics/CloudflareAnalytics.astro` + `analyticsConfig.cloudflareWebAnalytics`（原版只有 GA / Clarity / Umami / 51la）
4. **新增两个自制组件**：`features/TimeProgress.astro`（页脚今日/本月/本年进度）、`features/TabTitleEffect.astro`（切标签页轮播标题）
5. **旧链接重定向**：`public/_redirects` 把 `/blog/*` 301 到 `/posts/:splat`
6. **个性化**：站点信息、导航与页面开关、Giscus 评论、Live2D 看板娘、本地音乐播放器、主题色相 `hue: 250`
7. **署名**：页脚与 `/about/` 页列出所用开源项目及其作者（见 [CREDITS.md](./CREDITS.md)）

## 署名与许可

| 内容 | 版权 / 许可 |
| --- | --- |
| 主题与构建代码（Firefly） | © CuteLeaf，MIT，见 [LICENSE](./LICENSE) |
| 上游主题（Fuwari） | © saicaca，MIT |
| 本站文章、图片与个性化配置 | © 2026 栀海，保留所有权利 |
| Live2D 模型、字体、音乐、图标等素材 | 版权归各自原作者，各依其原许可协议 |

如果某个项目遗漏了署名，欢迎提 issue 指出来，我会补上。

## 部署

推送到 `main` 后由 GitHub Actions 自动构建并部署（`.github/workflows/deploy.yml`）：

1. 仓库 **Settings → Secrets and variables → Actions → Secrets** 添加：
   - `CLOUDFLARE_API_TOKEN`：Cloudflare 控制台 → My Profile → API Tokens → 用 **Edit Cloudflare Workers** 模板创建
   - `CLOUDFLARE_ACCOUNT_ID`：Workers & Pages 页面右侧栏
2. 之后每次 `git push` 都会自动：`pnpm install` → `pnpm build` → `wrangler deploy`

也可以本地发布：

```sh
pnpm build
pnpm exec wrangler deploy
```

## 致谢

感谢 [CuteLeaf](https://github.com/CuteLeaf) 的 Firefly 主题、[saicaca](https://github.com/saicaca) 的 Fuwari，以及 Astro、Pagefind、Giscus、Expressive Code、Tailwind CSS、Svelte、KaTeX、Swup、Iconify、l2d-widget、sharp 等开源项目与它们的作者们——完整清单见 [CREDITS.md](./CREDITS.md)。
