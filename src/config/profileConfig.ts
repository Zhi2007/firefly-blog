import type { ProfileConfig } from "../types/profileConfig";

export const profileConfig: ProfileConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	// 换成自己的头像：把图片放进 src/assets/images/ 后改这里的文件名即可
	avatar: "assets/images/avatar-zhi.png",

	// 名字（页脚版权、文章作者、OG 卡片等处都会用到）
	name: "栀海",

	// 个人签名
	bio: "记录技术、折腾与随想",

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	// showName: true 时显示图标和名称，false 时只显示图标
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/Zhi2007",
			showName: true,
		},
		{
			name: "哔哩哔哩",
			icon: "fa7-brands:bilibili",
			url: "https://space.bilibili.com/502912899",
			showName: true,
		},
		{
			name: "本站源码",
			icon: "fa7-solid:code-branch",
			url: "https://github.com/Zhi2007/firefly-blog",
			showName: true,
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
			showName: true,
		},
	],
};
