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
	{
		title: "编动小组",
		imgurl: "/friends/bdgroup-lab-com.ico",
		desc: "为多彩的明天献上祝福！",
		siteurl: "https://www.bdgroup-lab.com/",
		tags: ["友链"],
		weight: 24,
		enabled: true,
	},
	{
		title: "非线性列车",
		imgurl: "/friends/h-juij-fun.ico",
		desc: "By. Juij —— 工具与资源整理",
		siteurl: "https://h.juij.fun/",
		tags: ["友链"],
		weight: 23,
		enabled: true,
	},
	{
		title: "噗呲先生",
		imgurl: "https://api.iowen.cn/favicon/www.91biu.work.png",
		desc: "差生工具多",
		siteurl: "https://www.91biu.work/",
		tags: ["友链"],
		weight: 22,
		enabled: true,
	},
	{
		title: "Mefcl",
		imgurl: "/friends/mefcl-com.png",
		desc: "绿色便携软件与资源分享",
		siteurl: "https://www.mefcl.com/",
		tags: ["友链"],
		weight: 21,
		enabled: true,
	},
	{
		title: "FUUN.FUN",
		imgurl: "/friends/fuun-fun.ico",
		desc: "奇趣网站收藏家",
		siteurl: "https://fuun.fun/",
		tags: ["友链"],
		weight: 20,
		enabled: true,
	},
	{
		title: "osu!",
		imgurl: "https://api.iowen.cn/favicon/osu.ppy.sh.png",
		desc: "免费的音乐节奏游戏，上手简单、容易上瘾",
		siteurl: "https://osu.ppy.sh/",
		tags: ["友链"],
		weight: 19,
		enabled: true,
	},
	{
		title: "熊猫数据",
		imgurl: "https://api.iowen.cn/favicon/www.pandadatech.cn.png",
		desc: "（简介待补充 —— 站点开了防爬验证，抓不到介绍）",
		siteurl: "https://www.pandadatech.cn/",
		tags: ["友链"],
		weight: 18,
		enabled: true,
	},
	{
		title: "黑海洋 Wiki",
		imgurl: "/friends/blog-upx8-com.ico",
		desc: "AI 机器人硬件、网络安全攻防、区块链等技术文档",
		siteurl: "https://blog.upx8.com/",
		tags: ["友链"],
		weight: 17,
		enabled: true,
	},
	{
		title: "HMCL",
		imgurl: "/friends/hmcl-huangyuhui-net.ico",
		desc: "开源的 Minecraft 启动器，跨平台、好上手",
		siteurl: "https://hmcl.huangyuhui.net/",
		tags: ["友链"],
		weight: 16,
		enabled: true,
	},
	{
		title: "微PE工具箱",
		imgurl: "/friends/wepe-com-cn.ico",
		desc: "超好用的装机维护工具",
		siteurl: "https://www.wepe.com.cn/",
		tags: ["友链"],
		weight: 15,
		enabled: true,
	},
	{
		title: "FirPE",
		imgurl: "/friends/firpe-cn.png",
		desc: "免费纯净的 PE 维护系统",
		siteurl: "https://firpe.cn/page-247",
		tags: ["友链"],
		weight: 14,
		enabled: true,
	},
	{
		title: "Office Tool Plus",
		imgurl: "/friends/officetool-plus.ico",
		desc: "Office 部署与激活管理工具",
		siteurl: "https://www.officetool.plus/zh-cn/",
		tags: ["友链"],
		weight: 13,
		enabled: true,
	},
	{
		title: "Uotan Wiki",
		imgurl: "/friends/wiki-uotan-cn.ico",
		desc: "刷机百科（柚坛社区）",
		siteurl: "https://wiki.uotan.cn/index.php?title=%E9%A6%96%E9%A1%B5",
		tags: ["友链"],
		weight: 12,
		enabled: true,
	},
	{
		title: "FLiNG Trainer",
		imgurl: "/friends/flingtrainer-com.png",
		desc: "PC 游戏修改器与作弊表",
		siteurl: "https://flingtrainer.com/",
		tags: ["友链"],
		weight: 11,
		enabled: true,
	},
	{
		title: "樱花资源",
		imgurl: "/friends/yhcres-top.png",
		desc: "（简介待补充 —— 站点开了防爬验证，抓不到介绍）",
		siteurl: "https://www.yhcres.top/",
		tags: ["友链"],
		weight: 10,
		enabled: true,
	},
	{
		title: "我告诉你 NEXT",
		imgurl: "/friends/next-itellyou-cn.ico",
		desc: "MSDN 原版系统与软件镜像",
		siteurl: "https://next.itellyou.cn/",
		tags: ["友链"],
		weight: 9,
		enabled: true,
	},
	{
		title: "果核剥壳",
		imgurl: "/friends/ghxi-com.ico",
		desc: "互联网的净土 —— 软件分享",
		siteurl: "https://www.ghxi.com/",
		tags: ["友链"],
		weight: 8,
		enabled: true,
	},
	{
		title: "晨钟网络科技",
		imgurl: "/friends/jamcz-com.png",
		desc: "专注开发小众实用软件",
		siteurl: "https://jamcz.com/",
		tags: ["友链"],
		weight: 7,
		enabled: true,
	},
	{
		title: "iLinks 导航",
		imgurl: "/friends/xydh-fun.png",
		desc: "实用网址导航（Dieheart）",
		siteurl: "https://xydh.fun/dieheart",
		tags: ["友链"],
		weight: 6,
		enabled: true,
	},
	{
		title: "火哥分享",
		imgurl: "/friends/firepx-com.png",
		desc: "谷歌版、定制版应用分享",
		siteurl: "https://www.firepx.com/",
		tags: ["友链"],
		weight: 5,
		enabled: true,
	},
	{
		title: "IPPure",
		imgurl: "/friends/ippure-com.ico",
		desc: "IP 地址信息与纯净度检测",
		siteurl: "https://ippure.com/",
		tags: ["友链"],
		weight: 4,
		enabled: true,
	},
	{
		title: "茉莉然然",
		imgurl: "https://api.iowen.cn/favicon/moliranran.com.png",
		desc: "（简介待补充 —— 抓不到站点介绍）",
		siteurl: "https://moliranran.com:5245/",
		tags: ["友链"],
		weight: 3,
		enabled: true,
	},
	{
		title: "Abracadabra 魔曰",
		imgurl: "/friends/abracadabra-js-org.png",
		desc: "JS 代码保护 / 混淆工具",
		siteurl: "https://abracadabra.js.org/",
		tags: ["友链"],
		weight: 2,
		enabled: true,
	},
	{
		title: "VirusTotal",
		imgurl: "/friends/virustotal-com.png",
		desc: "在线多引擎病毒扫描（Google 旗下）",
		siteurl: "https://www.virustotal.com/gui/",
		tags: ["友链"],
		weight: 1,
		enabled: true,
	},
	// ── 想再加朋友？照下面这段复制一份 ──
	// { title: "站点名", imgurl: "头像直链", desc: "一句话介绍", siteurl: "https://…", tags: ["友链"], weight: 10, enabled: true },
	{
		title: "Firefly 主题文档",
		imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
		desc: "本站所用主题的官方文档（中文）",
		siteurl: "https://docs-firefly.cuteleaf.cn",
		tags: ["文档"],
		weight: 2,
		enabled: true,
	},
	{
		title: "Astro",
		imgurl: "https://avatars.githubusercontent.com/u/44914786?v=4&s=640",
		desc: "本站使用的静态站点框架",
		siteurl: "https://github.com/withastro/astro",
		tags: ["框架"],
		weight: 1,
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
