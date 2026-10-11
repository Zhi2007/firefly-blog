import type { FeatureTourConfig } from "../types/featureTourConfig";
// 导览数据单独放在 JSON 里，方便以后用管理面板（admin/）增删改，不用手改这份 TS
// （与 announcements.json / friends.json / music-playlist.json 的做法一致）
import featureTourData from "./feature-tour.json";

// 主页中间栏「功能导览」部件配置
//
// 改内容只改 src/config/feature-tour.json：
//   enable    —— 总开关，false 时首页完全不渲染这个部件
//   autoplay  —— 自动轮播，默认关闭（常驻定时器与本站「低 GPU 占用」的方向冲突）
//   swipe     —— 是否允许触摸左右滑动翻页
//   pages[]   —— 每页的 group（可选分组标签）/ title / items[]，每条含 name / desc / 可选 href
export const featureTourConfig: FeatureTourConfig =
	featureTourData as FeatureTourConfig;
