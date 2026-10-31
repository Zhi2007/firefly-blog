# AGENTS.md

> 给所有 AI agent（含新对话）的入口说明。先用 3 分钟读完「动手前必读」和「硬性要求」，再动代码。

## 动手前必读

**改任何文件之前，先读 [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md)**（中文，给 AI agent / 新对话的项目交接文档）。它写清了：

- 三类文件（上游主题 / 本仓库自建 / 内容与配置）各自能不能改；
- `src/config` 全部配置，以及哪些已被管理面板接管；
- Worker 的 6 项职责；
- 完整部署链路（面板发布 → `PUBLISH_SCOPE` → Actions → wrangler → CF 边缘）；
- 12 条「为什么这么设计」的踩坑史。

该文档里的路径、字段与路由数都经过实测核对，无法验证的项一律标注「需确认」。

## 硬性要求

| 禁止 | 原因 |
|---|---|
| `git add -A` / `git add .` / `git commit -a` | 会把在制品一起推上去，GitHub Actions 构建失败、线上部署挂掉（历史上真实发生过） |
| 改 `dist/`、`.astro/`、`node_modules/`、`public/vndb-covers/`、`admin-backups/`、`logs/` | 都是产物或本地状态，改了也白改 |
| 改 `public/vendor/giscus-*.mjs` 的内容却不换文件名 | 文件名带版本号并配了 1 年 `immutable` 缓存，老访客永远拿旧文件 |
| 在 `admin/` 里加依赖 | 面板设计前提是零依赖（只用 `node:` 内置模块），否则「双击 `启动管理面板.cmd` 就能用」会失效 |
| 手改 `src/constants/lqips.json`、`src/constants/icons-data.json` | 前者由 `pnpm lqips` 生成，后者被 Biome 显式忽略 |

## 提交前的门禁

| # | 门禁 | 命令 | 说明 |
|---|---|---|---|
| 1 | 类型检查 | `pnpm type-check`（`tsc --noEmit --isolatedDeclarations`） | 覆盖 `src/` 与 `scripts/` |
| 2 | 静态检查 | `pnpm exec biome ci ./src ./scripts` | 只查不改；`pnpm lint` 会写盘 |
| 3 | 构建 | `astro build` 成功（完整链路 = `pnpm build` 的 8 步） | 页数随文章数变化，**不要把它当固定验收值** |
| 4 | 文档同步 | `pnpm check-docs`（= `node scripts/check-docs-sync.mjs`，零依赖、只读） | **加功能 / 加配置 / 加路由 / 加页签 / 加页面后必须跑**：同步更新 `docs/PROJECT-CONTEXT.md`（附录 E 有「加什么 → 必须同步哪里」清单）以及受影响的面板与 README，否则退出码 1 |

## 文档地图

| 文档 | 读者 | 内容 |
|---|---|---|
| [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) | AI agent | 交接规范：三类文件、配置全量、Worker 职责、部署链路、面板、门禁、踩坑史、附录 |
| [`README.md`](README.md) | 站点作者 / 访客 | 功能一览、快速开始、写文章、配置指南、部署、FAQ |
| [`admin/README.md`](admin/README.md) | 站点作者 | 管理面板各页签用法、接口、校验规则、已知取舍 |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code | 架构速览、命令表、性能约束、构建流水线 |

## 与上游主题的关系

本仓库沿用上游 Firefly 主题，**与现状不符处已就地在行内标注「本仓库修正」**（已修：`--isolatedDeclarations`、8 步构建链路、`Firefly-Docs` 目录、`pnpm lint` 目标、部署平台应为 Cloudflare Workers）；未标注的语句仍按上游原样保留，逐条差异见 `docs/PROJECT-CONTEXT.md` 第 2.5 节。

---

## Repository Guidelines

（以下为上游原文；行内「本仓库修正」是本仓库就地补充的差异说明。）

### Project Structure & Module Organization

Firefly is an Astro 7 site with Svelte islands and TypeScript configuration. Main source code lives in `src/`: routes in `src/pages`, layouts in `src/layouts`, reusable UI in `src/components`, styles in `src/styles`, content in `src/content`, helpers in `src/utils`, and Markdown/HTML plugins in `src/plugins`. Site configuration is split across `src/config` with matching type definitions in `src/types`; prefer imports from `@/config` when available. Static files served directly belong in `public`, source-managed images in `src/assets`, docs in `docs`（本仓库修正：上游写的 `Firefly-Docs/` 目录在本仓库不存在）, and automation in `scripts`.

### Build, Test, and Development Commands

Use `pnpm`; the `preinstall` script enforces it.

- `pnpm dev` or `pnpm start`: run the local Astro dev server.
- `pnpm check`: run Astro diagnostics.
- `pnpm type-check`: run TypeScript with `--noEmit --isolatedDeclarations` （本仓库修正：实际脚本见 package.json）.
- `pnpm format`: format `./src ./scripts` with Biome（本仓库修正：上游写的是 `src`）.
- `pnpm lint`: run Biome checks and safe fixes on `./src ./scripts`（本仓库修正：上游写的是 `src`）.
- `pnpm build`: 8 steps — generate-github-card-data → generate-lqips → generate-vndb-covers → astro build → prune-pio-assets → subset-fonts → minify-inline-scripts → run-pagefind，输出到 `dist`（本仓库修正：上游写的是「generate icons …」，与实际脚本不符，且漏了 3 步）.
- `pnpm preview`: preview the production build locally.
- `pnpm new-post`: scaffold a new content post.

### Coding Style & Naming Conventions

Biome is the formatter and linter. It uses tabs for indentation and double quotes for JavaScript/TypeScript strings. Keep Astro and Svelte components in `PascalCase` (`PostCard.astro`, `Search.svelte`), config modules in `camelCase` ending with `Config.ts`, and utilities in descriptive kebab case such as `date-utils.ts`. Keep `src/types` aligned with `src/config`. Avoid unrelated formatting churn.

### Testing Guidelines

There is no dedicated unit-test framework configured. Before submitting changes, run `pnpm check`, `pnpm type-check`, and `pnpm build` for rendering, content, or generated asset work. For visual or interactive changes, verify with `pnpm dev` or `pnpm preview` and include screenshots in the PR. Name future tests near the feature they cover, using the local file name as the stem.

### Commit & Pull Request Guidelines

Use Conventional Commits, matching the current history: `feat: ...`, `fix: ...`, and `chore: ...`. Keep commits and PRs focused on one concern. PRs should include a concise summary, linked issues when relevant, validation commands run, and screenshots for UI changes. Discuss major features or design changes in an issue or discussion before implementation.

### Security & Configuration Tips

Do not commit secrets, tokens, or service keys in config files. Keep deployment-specific settings in the target platform environment, and review generated files such as `dist`, `src/constants/lqips.json`, and `src/constants/icons.ts` before committing them.
