// 工具箱（/tools/）配置类型：一个页面 = 若干分类，每个分类下若干工具
export type ToolItem = {
	id: string;
	name: string;
	url: string;
	/** 源码地址（可选，有就显示「源码」按钮） */
	sourceUrl?: string;
	/** 一句话定位，显示在名称下方 */
	tagline: string;
	/** 2~4 句介绍，说明它是什么、怎么用、适合谁 */
	description: string;
	/** 小徽章：开源 / 免费 / 可离线 / 需自部署 …… */
	badges?: string[];
	/** 亮点列表，3 条左右最好读 */
	features?: string[];
	/** 标签，用于快速判断用途 */
	tags?: string[];
	/** 使用提示 / 许可证提醒（可选） */
	note?: string;
};

export type ToolCategory = {
	id: string;
	name: string;
	/** 分类图标（Iconify 名称，如 material-symbols:lock） */
	icon?: string;
	/** 分类说明，一句话即可 */
	description?: string;
	tools: ToolItem[];
};

export type ToolsPageConfig = {
	title?: string;
	description?: string;
};
