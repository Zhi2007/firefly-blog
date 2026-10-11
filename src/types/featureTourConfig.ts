/**
 * 主页功能导览部件的数据类型。
 *
 * 数据本体放在 `src/config/feature-tour.json`（与管理面板已接管的
 * announcements.json / friends.json / music-playlist.json 同一套做法），
 * 这样面板将来只要读写这个 JSON 就能编辑，不需要改 TS 源码。
 */

/** 导览里的一条功能 */
export type FeatureTourItem = {
	/** 功能名（一行，显示在卡片标题位置） */
	name: string;
	/** 一句话中文简介 */
	desc: string;
	/** 可选的站内/站外链接；有值时整条变成可点的卡片 */
	href?: string;
};

/** 导览的一页（一次翻页展示一组功能） */
export type FeatureTourPage = {
	/** 可选分组标签，例如「阅读」「互动」；为空则不显示标签 */
	group?: string;
	/** 这一页的标题 */
	title: string;
	/** 这一页要展示的功能，建议 3–4 条 */
	items: FeatureTourItem[];
};

/** 自动轮播（默认关闭：常驻定时器与本站低 GPU 占用的方向冲突） */
export type FeatureTourAutoplay = {
	enable: boolean;
	/** 轮播间隔（毫秒），仅 enable 为 true 时生效 */
	intervalMs: number;
};

/** 功能导览整体配置 */
export type FeatureTourConfig = {
	/** 总开关：false 时首页完全不渲染这个部件（产物里不会有它的标记） */
	enable: boolean;
	/** 可选自动轮播，默认关闭 */
	autoplay?: FeatureTourAutoplay;
	/** 是否允许触摸左右滑动翻页，默认 true */
	swipe?: boolean;
	/** 每一页的内容 */
	pages: FeatureTourPage[];
};
