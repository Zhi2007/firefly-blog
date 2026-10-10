import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题，留空则走i18n默认标题
	title: "公告",

	// 公告内容（侧边栏公告栏，纯文本，不要写 HTML）
	content:
		"本站已改用 Firefly 主题，并在此致谢所有上游开源项目的作者。点击下方按钮查看完整公告与致谢名单。",

	// 是否允许用户关闭公告
	closable: true,

	link: {
		// 启用链接
		enable: true,
		// 链接文本
		text: "查看公告与致谢",
		// 链接 URL（对应顶部导航栏的「公告」栏目）
		url: "/announcement/",
		// 内部链接
		external: false,
	},

	// 首次访问弹窗：每个浏览器第一次打开站点时必定弹出一次
	modal: {
		enable: true,
		// 改了公告内容就把版本号一起改掉，老访客会重新看到弹窗
		version: "2026-10-10",
		title: "欢迎来到栀海的博客",
		storageKey: "zhi-blog-announcement-version",
		delayMs: 600,
	},
};
