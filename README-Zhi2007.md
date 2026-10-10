# 我的博客

个人博客站点：**Astro 7 + [Firefly](https://github.com/CuteLeaf/Firefly) 主题**，构建产物托管在 **Cloudflare Workers** 静态资源上（自动 HTTPS、全球 CDN、零服务器成本）。

## 快速开始

```sh
pnpm install     # 需要 Node ≥ 22.23 与 pnpm
pnpm dev         # 本地开发：http://localhost:4321
pnpm build       # 完整构建：LQIP → Astro → 字体子集化 → Pagefind 索引
pnpm preview     # 预览构建产物
```

> 必须用 **pnpm**（`package.json` 里的 `preinstall` 会拦住 npm/yarn）。首次安装约几百 MB，首次构建约 1–3 分钟。

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
| 头像、昵称、签名、社交链接 | `profileConfig.ts` |
| 侧边栏组件与顺序 | `sidebarConfig.ts` |
| 评论（Giscus：仓库 / categoryId / 映射方式） | `commentConfig.ts` |
| 统计（Cloudflare Web Analytics、GA、Umami、51la） | `analyticsConfig.ts` |
| 页脚时间进度、切标签页标题、樱花特效 | `effectsConfig.ts` |
| 代码块（Expressive Code） | `expressiveCodeConfig.ts` |
| 字体、代码高亮主题、壁纸 | `fontConfig.ts`、`backgroundWallpaper.ts` |
| 页脚自定义 HTML | `FooterConfig.html` |

## 相对原版 Firefly 的改动

1. **修复 katex CJS 入口**：`astro.config.mjs` 里改为 `katex/dist/katex.mjs`，避免 Vite 8 加载配置时报 `require is not defined`
2. **Vite 固定到 8.3.4**（`package.json`）：这是上一条报错的根因修复
3. **新增 Cloudflare Web Analytics**：`src/components/analytics/CloudflareAnalytics.astro` + `analyticsConfig.cloudflareWebAnalytics.token`（原版只有 GA / Clarity / Umami / 51la）
4. **新增两个自制组件**（原版没有）：
   - `src/components/features/TimeProgress.astro`：页脚显示「今日 / 本月 / 本年」已过百分比（按访客本地时区，每秒刷新）
   - `src/components/features/TabTitleEffect.astro`：切到别的标签页时轮播标题，回来立刻恢复
   - 两者配置都在 `src/config/effectsConfig.ts`
5. **`wrangler.jsonc` 的 `name` 改为 `my-blog`**：沿用原有的 `*.workers.dev` 地址，旧链接与评论不受影响
6. 清空了演示文章 / 动态 / 项目，导航里关掉了用不上的页面（友链、相册、动态、项目、书签、打赏）

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

站点地址：<https://my-blog.mc20070831.workers.dev>

## 致谢

主题来自 [CuteLeaf/Firefly](https://github.com/CuteLeaf/Firefly)（MIT），它基于 [saicaca/fuwari](https://github.com/saicaca/fuwari) 二次开发。
