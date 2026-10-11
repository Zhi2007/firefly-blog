> **⚠️ 改任何文件之前，先读 [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md)**（中文，给 AI agent / 新对话的项目交接文档）。
> 它写清了：三类文件（上游主题 / 本仓库自建 / 内容与配置）各自能不能改、`src/config` 全部配置与哪些已被面板接管、Worker 的 6 项职责、完整部署链路（面板发布 → `PUBLISH_SCOPE` → Actions → wrangler → CF 边缘）、以及 12 条「为什么这么设计」的踩坑史。
> **硬性要求**：不要 `git add -A`、不要改 `dist/`、不要动 `public/vendor/giscus-*.mjs`、不要在 `admin/` 里加依赖；提交前跑三条门禁（`tsc --noEmit --isolatedDeclarations`、`biome ci src`、`astro build` 28 页）。
> 该文档里的路径、字段与路由数都经过实测核对，无法验证的项一律标注「需确认」。
> 下面是本仓库沿用上游主题的原始说明。**与现状不符处已就地在行内标注「本仓库修正」**（已修：`--isolatedDeclarations`、8 步构建链路、`Firefly-Docs` 目录、`pnpm lint` 目标、部署平台应为 Cloudflare Workers）；未标注的语句仍按上游原样保留，逐条差异见 `docs/PROJECT-CONTEXT.md` 第 2.5 节。

# Repository Guidelines

## Project Structure & Module Organization

Firefly is an Astro 7 site with Svelte islands and TypeScript configuration. Main source code lives in `src/`: routes in `src/pages`, layouts in `src/layouts`, reusable UI in `src/components`, styles in `src/styles`, content in `src/content`, helpers in `src/utils`, and Markdown/HTML plugins in `src/plugins`. Site configuration is split across `src/config` with matching type definitions in `src/types`; prefer imports from `@/config` when available. Static files served directly belong in `public`, source-managed images in `src/assets`, docs in `docs`（本仓库修正：上游写的 `Firefly-Docs/` 目录在本仓库不存在）, and automation in `scripts`.

## Build, Test, and Development Commands

Use `pnpm`; the `preinstall` script enforces it.

- `pnpm dev` or `pnpm start`: run the local Astro dev server.
- `pnpm check`: run Astro diagnostics.
- `pnpm type-check`: run TypeScript with `--noEmit --isolatedDeclarations` （本仓库修正：实际脚本见 package.json）.
- `pnpm format`: format `src` with Biome.
- `pnpm lint`: run Biome checks and safe fixes on `src`.
- `pnpm build`: 8 steps — generate-github-card-data → generate-lqips → generate-vndb-covers → astro build → prune-pio-assets → subset-fonts → minify-inline-scripts → run-pagefind，输出到 `dist`（本仓库修正：上游写的是「generate icons …」，与实际脚本不符，且漏了 3 步）.
- `pnpm preview`: preview the production build locally.
- `pnpm new-post`: scaffold a new content post.

## Coding Style & Naming Conventions

Biome is the formatter and linter. It uses tabs for indentation and double quotes for JavaScript/TypeScript strings. Keep Astro and Svelte components in `PascalCase` (`PostCard.astro`, `Search.svelte`), config modules in `camelCase` ending with `Config.ts`, and utilities in descriptive kebab case such as `date-utils.ts`. Keep `src/types` aligned with `src/config`. Avoid unrelated formatting churn.

## Testing Guidelines

There is no dedicated unit-test framework configured. Before submitting changes, run `pnpm check`, `pnpm type-check`, and `pnpm build` for rendering, content, or generated asset work. For visual or interactive changes, verify with `pnpm dev` or `pnpm preview` and include screenshots in the PR. Name future tests near the feature they cover, using the local file name as the stem.

## Commit & Pull Request Guidelines

Use Conventional Commits, matching the current history: `feat: ...`, `fix: ...`, and `chore: ...`. Keep commits and PRs focused on one concern. PRs should include a concise summary, linked issues when relevant, validation commands run, and screenshots for UI changes. Discuss major features or design changes in an issue or discussion before implementation.

## Security & Configuration Tips

Do not commit secrets, tokens, or service keys in config files. Keep deployment-specific settings in the target platform environment, and review generated files such as `dist`, `src/constants/lqips.json`, and `src/constants/icons.ts` before committing them.
