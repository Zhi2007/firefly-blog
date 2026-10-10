---
title: 这个博客的 Markdown 速查表
published: 2026-10-01
description: 标题、列表、引用、代码块、表格、图片在正文里的写法示例，写文章时直接抄。
tags: [Markdown, 写作]
category: 写作
---

正文支持常见的 Markdown 语法，下面是可以直接复制改写的示例。

## 标题与段落

`##` 是二级标题，`###` 是三级标题。段落之间空一行即可。

## 列表

无序列表：

- 第一项
- 第二项
  - 嵌套一项

有序列表：

1. 第一步
2. 第二步

## 引用

> 引用块适合放摘录或强调。
> 可以写多行。

## 代码

行内代码用反引号，比如 `npm run deploy`。

代码块可以标语言，构建时会自动做语法高亮：

```js
export function greet(name) {
  return `Hello, ${name}!`;
}
```

```sh
npm run build
npx wrangler deploy
```

## 表格

| 功能 | 命令 |
| --- | --- |
| 本地预览 | `npm run dev` |
| 构建 | `npm run build` |
| 构建并部署 | `npm run deploy` |

## 链接与图片

链接：`[Cloudflare](https://www.cloudflare.com/)` → [Cloudflare](https://www.cloudflare.com/)

图片：把文件放进 `public/`，然后用 `![说明](/图片名.png)` 引用；文章专属图片也可以放在 `src/content/blog/` 旁边用相对路径引用。

## 分隔线

---

以上这些基本够用。真需要复杂排版时，Astro 还支持在页面里写组件，Markdown 和组件可以混用。
