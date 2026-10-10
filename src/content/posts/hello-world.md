---
title: 博客开张：用 Astro + Firefly + Cloudflare 上线
published: 2026-10-09
description: 这个博客的技术选型和第一篇介绍——Astro 静态生成、Firefly 主题、Cloudflare Workers 托管，一年成本只有域名钱。
tags: [公告, Astro, Cloudflare]
category: 公告
image: ./images/cover-demo.png
pinned: true
---

欢迎来到我的博客。

这个站点用 [Astro](https://astro.build) 做静态生成，托管在 Cloudflare Workers 的静态资源服务上。选它的原因很简单：

- **零成本**：免费额度对一个个人博客来说绰绰有余（每天 10 万次请求，静态资源每天不限请求数）。
- **零运维**：不需要服务器、不需要装 Nginx、证书自动签发和续期。
- **快**：静态文件走 Cloudflare 全球边缘节点，国内访问一般也能接受。
- **写作舒服**：文章就是 Markdown 文件，写完 `git push` 或者一条命令就上线。

## 怎么发一篇新文章

在 `src/content/blog/` 里新建一个 `.md` 文件，开头写上元信息：

```markdown
---
title: 文章标题
description: 一句话摘要，会显示在列表和搜索结果里
pubDate: 2026-10-09
tags: ['随笔']
draft: false
---

正文用 Markdown 写就行。
```

然后本地预览：

```sh
npm run dev      # http://localhost:4321
```

确认没问题后发布：

```sh
npm run deploy   # = astro build + wrangler deploy
```

就这两步。

## 接下来想写什么

- 一些折腾记录（软路由、NAS、各种自建服务）
- 读书笔记
- 一些关于效率工具的想法

如果这个博客能坚持写下去，那它就已经完成使命了。
