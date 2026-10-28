import type { MusicPlayerConfig } from "../types/musicConfig";
// 歌单单独放在 JSON 里，方便用管理面板（admin/）上传歌曲并增删改，不用手改这份 TS
import playlist from "./music-playlist.json";

// 音乐播放器配置
//
// 加歌推荐用管理面板的「音乐」页：上传 mp3（可带封面、歌词）即可，会自动写进
// src/config/music-playlist.json。手动加歌也行：把文件放进 public/assets/music/，
// 然后在那个 JSON 里加一条。
//
// 提示：单曲文件建议 ≤ 10 MB（Cloudflare 单个静态资源上限 25 MiB）。
export const musicPlayerConfig: MusicPlayerConfig = {
	// 是否在导航栏显示音乐播放器入口
	showInNavbar: true,

	// 是否在侧边栏显示音乐播放器组件（已改为左下角悬浮播放器，见下方 floating）
	showInSidebar: false,

	// 悬浮播放器：固定在页面左下角，随页面滚动始终可见；右上角圆钮可收起成一个小圆钮
	floating: {
		enable: true,
		position: "bottom-left",
	},

	// 使用方式："meting" 使用 Meting API（在线歌单），"local" 使用本地音乐列表
	mode: "local",

	// 默认音量 (0-1)
	volume: 0.7,

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放；默认随机（每次打开随机挑一首）
	playMode: "random",

	// 是否显启用歌词
	showLyrics: true,

	// Meting API 配置（mode 为 "meting" 时使用）
	meting: {
		// Meting API 地址
		api: "https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r",
		// 音乐平台：netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐, xiami=虾米音乐, baidu=百度音乐
		server: "netease",
		// 类型：song=单曲, playlist=歌单, album=专辑, search=搜索, artist=艺术家
		type: "playlist",
		// 歌单/专辑/单曲 ID 或搜索关键词
		id: "10046455237",
		// 认证 token（可选）
		auth: "",
		// 备用 API 配置（当主 API 失败时使用）
		fallbackApis: [
			"https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
			"https://api.moeyao.cn/meting/?server=:server&type=:type&id=:id",
		],
	},

	// 本地歌单：数据在 src/config/music-playlist.json
	local: {
		playlist,
	},
};
