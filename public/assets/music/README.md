# 音乐文件夹

把本地音乐放在这里，播放器配置在 `src/config/musicConfig.ts`。

```
public/assets/music/
├─ your-song.mp3          # 音频（mp3 / m4a / wav 都可以）
├─ cover/
│  └─ your-cover.jpg      # 可选的封面图
└─ lrc/
   └─ your-song.lrc       # 可选的歌词文件
```

然后在 `src/config/musicConfig.ts` 的 `local.playlist` 里加一条：

```ts
{
	name: "歌曲名",
	artist: "歌手",
	url: "/assets/music/your-song.mp3",
	cover: "/assets/music/cover/your-cover.jpg",
	lrc: "/assets/music/lrc/your-song.lrc",
},
```

注意事项：

- 文件名建议只用英文、数字和连字符，避免 URL 编码问题；改了文件名记得同步配置。
- 单曲建议 ≤ 10 MB（Cloudflare 单个静态资源上限 25 MiB）；歌多了会让仓库和部署包变大。
- 歌词想直接内嵌也可以：把 `lrc` 写成 `"[00:00.00]歌词内容..."` 这样的字符串。
- 播放器入口在导航栏和侧边栏（`showInNavbar` / `showInSidebar`），改成 `false` 即可隐藏。
- 不想往仓库里放音频文件，可以把 `mode` 改成 `"meting"` 用在线歌单。

> 说明：这些音频会随站点一起公开分发，请只放你有权分享的音乐。
