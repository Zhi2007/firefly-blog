# 公告

你好，欢迎来到**栀海的博客**。上面是按时间排列的公告列表，其中带「已固定」标记的那条是**固定公告** —— 它会一直作为首次访问的弹窗内容，之后新发的公告只进这个列表，不会把它顶掉。

## 关于本站的构成

这个博客是从 [Firefly](https://github.com/CuteLeaf/Firefly) 主题重建而来 —— Firefly 是 [CuteLeaf](https://github.com/CuteLeaf) 基于 [saicaca](https://github.com/saicaca) 的 [Fuwari](https://github.com/saicaca/fuwari) 二次开发的主题。全站静态生成后托管在 Cloudflare Workers 的静态资源上，没有服务器，也没有数据库。

在此基础上，栀海做了这些改造：

- 修复 katex 的 CJS 入口问题，并把 Vite 固定在 8.3.4（否则加载构建配置会报 `require is not defined`）
- 新增 Cloudflare Web Analytics 统计组件（原版只支持 GA / Clarity / Umami / 51la）
- 自制页脚「今日 / 本月 / 本年」时间进度、切换标签页时的标题轮播、首访公告弹窗
- 公告升级为「列表 + 固定公告」结构（首访弹窗固定展示 pinned 的那条）
- 加了旧链接重定向（`/blog/*` → `/posts/*`）
- 站点信息、导航、页面开关、Giscus 评论、本地音乐播放器、Live2D 看板娘等个性化配置

## 栀海的链接

- GitHub：<https://github.com/Zhi2007>
- 哔哩哔哩：<https://space.bilibili.com/502912899>
- 本站源码：<https://github.com/Zhi2007/firefly-blog>
- 侵权删除申请 / 问题反馈：<https://github.com/Zhi2007/firefly-blog/issues>
- 留言板：[点这里](/guestbook/)
- RSS 订阅：[/rss.xml](/rss.xml)

## 开源致谢

本站站在下面这些开源项目之上运行，向每一位作者致谢（清单见页面底部）：Astro、Firefly（作者 [CuteLeaf](https://github.com/CuteLeaf)）、Fuwari（作者 [saicaca](https://github.com/saicaca)）、Tailwind CSS、Svelte、Swup、Pagefind、Giscus、Expressive Code、KaTeX、Mermaid、l2d-widget（作者 [hacxy](https://github.com/hacxy)）、Iconify、sharp、Cloudflare。

更多细节（含许可协议与素材说明）见仓库里的 [CREDITS.md](https://github.com/Zhi2007/firefly-blog/blob/main/CREDITS.md)。

## 更新记录

- **2026-10-10**：站点迁移到 Firefly 主题；新增首访公告弹窗（含免责声明与侵权处理）、时间进度、标签页标题轮播、Cloudflare 统计；文章地址由 `/blog/<slug>/` 改为 `/posts/<slug>/`（旧链接自动 301 跳转）
