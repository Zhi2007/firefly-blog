import type {
	AnnouncementConfig,
	AnnouncementItem,
} from "../types/announcementConfig";
// 公告数据单独放在 JSON 里，方便用管理面板（admin/）增删改，不用手改这份 TS
import announcementItems from "./announcements.json";

// 公告配置
//
// 结构：announcements.json 是公告列表，列表按日期倒序显示；其中标了 `pinned: true` 的那条
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

	// 公告列表：数据在 src/config/announcements.json
	// （JSON 里的 type 字段是宽泛的 string，这里收敛成声明里的联合类型）
	items: announcementItems as unknown as AnnouncementItem[],

	// 首次访问弹窗
	modal: {
		enable: true,
		// 留空则用固定公告自己的标题
		title: "",
		storageKey: "zhi-blog-announcement-version",
		delayMs: 600,
	},
};
