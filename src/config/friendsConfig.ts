import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "友情链接",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "与优秀的朋友们一起成长",

	// 是否显示底部自定义内容（friends.mdx 中的内容）
	showCustomContent: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否开启随机排序配置，如果开启，就会忽略权重，构建时进行一次随机排序
	randomizeSort: false,
};

// 友链配置
export const friendsConfig: FriendLink[] = [
	// ── 想加新朋友？把下面这段注释复制一份出来、改成对方的信息即可 ──────────────
	// {
	// 	title: "对方的站点名",
	// 	imgurl: "对方头像图片直链（建议用 https）",
	// 	desc: "一句话介绍 —— 会显示在卡片上",   // ← 这就是"简单介绍"
	// 	siteurl: "https://对方的网站",
	// 	tags: ["Blog"],
	// 	weight: 10, // 权重，数字越大排越前
	// 	enabled: true, // 是否显示
	// },
	{
		title: "Firefly 主题文档",
		imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
		desc: "本站所用主题的官方文档（中文），折腾博客时很有用",
		siteurl: "https://docs-firefly.cuteleaf.cn",
		tags: ["文档"],
		weight: 9,
		enabled: true,
	},
	{
		title: "Astro",
		imgurl: "https://avatars.githubusercontent.com/u/44914786?v=4&s=640",
		desc: "本站使用的静态站点框架，内容驱动型网站的首选",
		siteurl: "https://github.com/withastro/astro",
		tags: ["框架"],
		weight: 8,
		enabled: true,
	},
];

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
