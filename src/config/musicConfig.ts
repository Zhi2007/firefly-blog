import type { MusicPlayerConfig } from "../types/musicConfig";

// 音乐播放器配置
//
// 用本地音乐的三步：
//   1. 把你的 mp3 放进 public/assets/music/（文件名建议用英文，避免 URL 编码麻烦）
//   2. 封面图放 public/assets/music/cover/，歌词文件（可选）放 public/assets/music/lrc/
//   3. 在下面 local.playlist 里按模板加一条，然后用 pnpm dev 或 pnpm build 看效果
//
// 提示：单曲文件建议 ≤ 10 MB（Cloudflare 单个静态资源上限 25 MiB），
//       歌多了会让仓库和部署包变大，介意的话可以改用 mode: "meting" 在线歌单。
export const musicPlayerConfig: MusicPlayerConfig = {
	// 是否在导航栏显示音乐播放器入口
	showInNavbar: true,

	// 是否在侧边栏显示音乐播放器组件
	showInSidebar: true,

	// 使用方式："meting" 使用 Meting API（在线歌单），"local" 使用本地音乐列表
	mode: "local",

	// 默认音量 (0-1)
	volume: 0.7,

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放
	playMode: "list",

	// 是否显启用歌词
	showLyrics: false,

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

	// 本地音乐列表（mode 为 "local" 时使用）
	// 加歌示例（把下面三条前面的 // 去掉并改成你自己的信息即可）：
	// {
	// 	name: "歌曲名",
	// 	artist: "歌手",
	// 	url: "/assets/music/your-song.mp3",
	// 	cover: "/assets/music/cover/your-cover.jpg",
	// 	lrc: "/assets/music/lrc/your-song.lrc",
	// },
	local: {
		playlist: [],
	},
};
