export type AnnouncementConfig = {
	// enable属性已移除，现在通过sidebarLayoutConfig统一控制
	title?: string; // 公告栏标题
	content: string; // 公告栏内容
	icon?: string; // 公告栏图标
	type?: "info" | "warning" | "success" | "error"; // 公告类型
	closable?: boolean; // 是否可关闭
	link?: {
		enable: boolean; // 是否启用链接
		text: string; // 链接文字
		url: string; // 链接地址
		external?: boolean; // 是否外部链接
	};
	// 首次访问弹窗（Firefly 原本只有侧边栏公告组件，这里是本仓库新增）
	modal?: {
		enable: boolean; // 是否启用首访弹窗
		version: string; // 公告版本号：改动它，所有访客都会重新看到一次弹窗
		title?: string; // 弹窗标题，留空用上面的 title
		storageKey?: string; // localStorage 键名
		delayMs?: number; // 打开页面后延迟多少毫秒弹出
	};
};
