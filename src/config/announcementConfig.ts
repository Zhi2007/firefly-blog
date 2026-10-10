import type { AnnouncementConfig } from "../types/announcementConfig";

// 公告配置
//
// 结构：items 是公告列表，列表按日期倒序显示；其中 marked `pinned: true` 的那条
// 是「固定公告」——首访弹窗永远展示它，之后新发的公告只会进列表，不会把弹窗顶掉。
//
// 想让访客重新看到一次弹窗：改动固定公告的 version（或改 id）。
export const announcementConfig: AnnouncementConfig = {
	// 侧边栏公告栏标题
	title: "公告",

	// 是否允许用户关闭侧边栏公告
	closable: true,

	// 侧边栏公告底部的按钮
	link: {
		enable: true,
		text: "查看全部公告",
		url: "/announcement/",
		external: false,
	},

	items: [
		// ── 固定公告（首访弹窗展示的就是这一条）──────────────────────────────
		{
			id: "pinned-site-notice",
			pinned: true,
			title: "站点公告 · 免责声明 · 侵权处理",
			published: "2026-10-10",
			// 改了下面内容就把 version 一起改掉，所有访客会重新看到一次弹窗
			version: "2026-10-10",
			type: "info",
			content: [
				"本站已从旧版主题迁移到 Firefly 主题，文章地址由 /blog/<slug>/ 改为 /posts/<slug>/（旧链接会自动 301 跳转）。站点的技术构成与所用开源项目的作者署名，见公告页。",
				"【免责声明】本站是个人博客，全部内容为个人学习笔记、折腾记录与个人观点，不构成任何专业建议，也不保证准确性与时效性。文中引用或转载的第三方内容（文章、图片、音乐、Live2D 模型、字体、代码片段等），版权均归原作者或权利人所有，本站仅用于学习、研究与分享，不作商业用途；如标注有误或遗漏，欢迎指出。站内提供的外部链接仅为方便访问，其内容与本站无关，本站不为其负责。",
				"【侵权联系删除】若本站任何内容侵犯了您的合法权益，请通过下方「侵权删除申请」入口联系我，并提供：① 权利证明（著作权登记、原始发布链接等）；② 涉嫌侵权内容在本站的具体网址。核实后我会在 24–48 小时内删除相关内容或补上正确的署名与来源。",
				"感谢理解与支持，也感谢所有开源项目的作者。",
			].join("\n\n"),
			links: [
				{ text: "查看全部公告与开源致谢", url: "/announcement/" },
				{
					text: "侵权删除申请（GitHub Issues）",
					url: "https://github.com/Zhi2007/firefly-blog/issues",
					external: true,
				},
			],
		},

		// ── 普通公告（只进列表，不会挤掉上面的固定公告）──────────────────────
		{
			id: "2026-10-10-migration-done",
			title: "站点迁移完成",
			published: "2026-10-10",
			type: "success",
			content:
				"博客已从旧版 Astro 主题迁移到 Firefly 主题：新增站内搜索（Pagefind）、Giscus 评论、Live2D 看板娘、本地音乐播放器、页脚时间进度与首访公告；三篇文章已迁移，旧链接自动跳转。",
			links: [{ text: "看看归档", url: "/archive/" }],
		},
		{
			// 示例：以后新发公告照着复制一条即可，弹窗仍然展示固定公告
			id: "2026-10-10-how-to-add",
			title: "如何发布新公告",
			published: "2026-10-10",
			content:
				"在 src/config/announcementConfig.ts 的 items 里复制一条改内容即可；不标记 pinned 的公告只会出现在公告页的列表里，不会影响首访弹窗展示的那条固定公告。",
			links: [
				{
					text: "公告页",
					url: "/announcement/",
				},
			],
		},
	],

	// 首次访问弹窗
	modal: {
		enable: true,
		// 留空则用固定公告自己的标题
		title: "",
		storageKey: "zhi-blog-announcement-version",
		delayMs: 600,
	},
};
