---
title: 把博客部署到 Cloudflare（含绑定自有域名）
published: 2026-10-08
description: 从本地构建到绑定自定义域名、开启缓存和 HTTPS 的完整步骤，以及常见报错的处理办法。
tags: [Cloudflare, 部署, 折腾]
category: 折腾
---

这篇文章记录把本博客部署到 Cloudflare 的完整流程。全程免费，只有域名需要花钱（也可以先用免费的 `*.workers.dev` 子域）。

## 一、本地构建并首次部署

```sh
npm install          # 只做一次
npm run deploy       # astro build + wrangler deploy
```

第一次运行 `wrangler deploy` 会打开浏览器要求授权登录 Cloudflare 账号。登录完成后回到终端，会看到：

```
Uploaded my-blog (x.xx sec)
Deployed my-blog triggers (x.xx sec)
  https://my-blog.<你的子域>.workers.dev
```

这个 `*.workers.dev` 地址就是你的博客，已经自动带 HTTPS。

> Worker 名称在 `wrangler.jsonc` 的 `name` 字段，它决定了 `workers.dev` 子域名，必须是全局唯一的。如果提示被占用，改个名字再部署即可。

## 二、绑定自己的域名

1. 在 Cloudflare 控制台 **Workers & Pages → 你的 Worker → Settings → Domains & Routes**，点 **Add → Custom Domain**，填 `blog.example.com`。
2. 如果域名还没接入 Cloudflare：先在控制台 **Add site** 添加域名，然后到域名注册商处把 NS 改成 Cloudflare 给的两个名称服务器。
3. 添加成功后 Cloudflare 会自动签发证书，通常 1～15 分钟生效。
4. 顺手把 `astro.config.mjs` 里的 `site` 和 `src/consts.ts` 里的 `url` 改成新域名，这样 RSS 和站点地图里的链接才是对的。

## 三、值得打开的开关

- **SSL/TLS → Edge Certificates**：Always Use HTTPS、Automatic HTTPS Rewrites、HSTS。
- **Speed**：Brotli、HTTP/3、Early Hints。
- **Caching → Cache Rules**：静态资源（`/_astro/*`）可以设长缓存，`Cache-Control` 交给 Astro 生成的指纹文件名处理即可。
- **Analytics**：开启 Web Analytics，免费且不需要在页面里塞第三方脚本。

## 四、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `Error 1027` | Workers 免费额度当天用尽（10 万次/天，UTC 零点重置）；静态资源站点一般很难碰到 |
| 访问域名 522 / 521 | 这是源站类错误，纯静态部署在 CF 上不会出现；出现说明路径配置有问题，检查 `wrangler.jsonc` 的 `assets.directory` |
| 子域被占用 | 改 `wrangler.jsonc` 里的 `name` |
| 页面样式丢失 | 检查 `npm run build` 是否成功、`dist/` 是否生成 |
| 国内访问慢 | 免费版没有中国大陆节点，通常走香港/日本；这是免费方案的固有代价 |

## 五、之后的更新流程

```sh
npm run dev        # 本地写、本地看
npm run deploy     # 满意了就上线
```

如果想更省事，可以把仓库连到 Cloudflare 的 Git 集成（Workers Builds），以后 `git push` 就自动构建部署。
