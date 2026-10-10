// 公告相关类型
// 本站对 Firefly 原版公告的扩展：原版只有单条公告文本（侧边栏组件用），
// 这里升级为「公告列表 + pinned 固定公告」，固定公告用于首访弹窗，不会被新公告挤掉。

export type AnnouncementLink = {
	text: string; // 链接文字
	url: string; // 链接地址
	external?: boolean; // 是否外部链接（新窗口打开）
};

export type AnnouncementItem = {
	id: string; // 唯一标识（同时用于弹窗的"已读"记录，改动它访客会重新看到弹窗）
	title: string; // 公告标题
	published: string; // 发布日期 YYYY-MM-DD
	content: string; // 正文，纯文本，用两个换行分段
	type?: "info" | "warning" | "success" | "error"; // 公告类型（决定配色）
	pinned?: boolean; // 固定为弹窗公告：新发的公告不会挤掉它（同一时间只应有一条 pinned）
	version?: string; // 版本号：改了公告内容就改它，访客会重新看到一次弹窗
	links?: AnnouncementLink[]; // 公告底部的按钮
};

export type AnnouncementConfig = {
	// 侧边栏公告栏的标题，留空则走 i18n 默认「公告」
	title?: string;
	// 是否允许用户关闭侧边栏公告
	closable?: boolean;
	// 侧边栏公告底部的链接
	link?: {
		enable: boolean;
		text: string;
		url: string;
		external?: boolean;
	};
	// 所有公告：列表按日期倒序展示，pinned 的那条永远排最前
	items: AnnouncementItem[];
	// 首次访问弹窗（Firefly 原版没有，本仓库新增）
	modal?: {
		enable: boolean; // 是否启用首访弹窗
		title?: string; // 覆盖弹窗标题，留空则用固定公告自己的标题
		storageKey?: string; // localStorage 键名前缀
		delayMs?: number; // 打开页面后延迟多少毫秒弹出
	};
};
