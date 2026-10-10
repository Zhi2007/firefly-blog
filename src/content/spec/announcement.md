# 公告

你好，欢迎来到**栀海的博客**。这里放本站的站点公告，以及本站所用开源项目的作者署名。

## 关于本站的构成

这个博客是从 [Firefly](https://github.com/CuteLeaf/Firefly) 主题重建而来 —— Firefly 是 [CuteLeaf](https://github.com/CuteLeaf) 基于 [saicaca](https://github.com/saicaca) 的 [Fuwari](https://github.com/saicaca/fuwari) 二次开发的主题。全站静态生成后托管在 Cloudflare Workers 的静态资源上，没有服务器，也没有数据库。

在此基础上我做了这些改造：

- 修复 katex 的 CJS 入口问题，并把 Vite 固定在 8.3.4（否则加载构建配置会报 `require is not defined`）
- 新增 Cloudflare Web Analytics 统计组件（原版只支持 GA / Clarity / Umami / 51la）
- 自制页脚「今日 / 本月 / 本年」时间进度，以及切换标签页时的标题轮播
- 加了旧链接重定向（`/blog/*` → `/posts/*`）、首访公告弹窗（就是刚才那个）
- 站点信息、导航、页面开关、Giscus 评论、本地音乐播放器、Live2D 看板娘等个性化配置

## 我的链接

- GitHub：<https://github.com/Zhi2007>
- 本站源码：<https://github.com/Zhi2007/firefly-blog>
- 问题反馈 / 留言：<https://github.com/Zhi2007/firefly-blog/issues> 或本站的[留言板](/guestbook/)
- RSS 订阅：[/rss.xml](/rss.xml)

## 开源致谢

本站站在下面这些开源项目之上运行，向每一位作者致谢：

<!-- 致谢清单由 src/components/common/ProjectCredits.astro 渲染（与首访公告弹窗共用同一份数据） -->

更多细节（含许可协议与素材说明）见仓库里的 [CREDITS.md](https://github.com/Zhi2007/firefly-blog/blob/main/CREDITS.md)。

## 更新记录

- **2026-10-10**：站点迁移到 Firefly 主题；新增首访公告、时间进度、标签页标题轮播、Cloudflare 统计；文章地址由 `/blog/<slug>/` 改为 `/posts/<slug>/`（旧链接自动 301 跳转）
