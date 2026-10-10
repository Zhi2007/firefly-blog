import type {
	SakuraConfig,
	TabTitleConfig,
	TimeProgressConfig,
} from "../types/effectsConfig";

// 特效配置 - 集中管理所有动画特效

export const sakuraConfig: SakuraConfig = {
	// 是否启用樱花特效
	enable: false,

	// 樱花数量
	sakuraNum: 21,

	// 樱花越界限制次数，-1为无限循环
	limitTimes: -1,

	// 樱花尺寸
	size: {
		// 樱花最小尺寸倍数
		min: 0.5,
		// 樱花最大尺寸倍数
		max: 1.1,
	},

	// 樱花不透明度
	opacity: {
		// 樱花最小不透明度
		min: 0.3,
		// 樱花最大不透明度
		max: 0.9,
	},

	// 樱花移动速度
	speed: {
		// 水平移动
		horizontal: {
			// 水平移动速度最小值
			min: -1.7,
			// 水平移动速度最大值
			max: -1.2,
		},
		// 垂直移动
		vertical: {
			// 垂直移动速度最小值
			min: 1.5,
			// 垂直移动速度最大值
			max: 2.2,
		},
		// 旋转速度
		rotation: 0.03,
		// 消失速度，不应大于最小不透明度
		fadeSpeed: 0.03,
	},

	// 层级，确保樱花在合适的层级显示
	zIndex: 100,
};

// 侧边栏时间进度组件（今日 / 本月 / 本年已过百分比，按访客本地时区实时计算）
// 组件位置见 sidebarConfig.ts 的 leftComponents
export const timeProgressConfig: TimeProgressConfig = {
	enable: true,
	title: "时间进度",
	labels: {
		day: "今日进度",
		month: "本月进度",
		year: "本年进度",
	},
	// true：显示「距离下一天（X时X分）/ 下一月（X 天 Y 小时）/ 下一年（X 天）还剩」
	showRemaining: true,
};

// 切换浏览器标签页时轮播标题文案
export const tabTitleConfig: TabTitleConfig = {
	enable: true,
	titles: ["喂，别走啊 👀", "快回来看看嘛", "页面还在，人没了？"],
	intervalMs: 2500,
};
