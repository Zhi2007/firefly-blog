import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";
import friendsData from "./friends.json";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链数据本身放在 friends.json 里：管理面板的「友链」页签会直接读写这个 JSON，
// 面板只能改数据、不需要改写 TS 源码，也就不会因为改错语法导致构建失败。
// 想手动加朋友？照 friends.json 里的任意一条复制一份即可（字段顺序无所谓）。
export const friendsConfig: FriendLink[] = friendsData;

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

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
