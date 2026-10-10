export type SakuraConfig = {
	enable: boolean; // 是否启用樱花特效
	sakuraNum: number; // 樱花数量，默认21
	limitTimes: number; // 樱花越界限制次数，-1为无限循环
	size: {
		min: number; // 樱花最小尺寸倍数
		max: number; // 樱花最大尺寸倍数
	};
	opacity: {
		min: number; // 樱花最小不透明度
		max: number; // 樱花最大不透明度
	};
	speed: {
		horizontal: {
			min: number; // 水平移动速度最小值
			max: number; // 水平移动速度最大值
		};
		vertical: {
			min: number; // 垂直移动速度最小值
			max: number; // 垂直移动速度最大值
		};
		rotation: number; // 旋转速度
		fadeSpeed: number; // 消失速度，不应大于最小不透明度
	};
	zIndex: number; // 层级，确保樱花在合适的层级显示
};

// 页脚时间进度（今日 / 本月 / 本年的已过百分比，按访客本地时区计算）
export type TimeProgressConfig = {
	enable: boolean; // 是否启用
	title?: string; // 侧边栏组件标题
	labels: {
		day: string; // 今日那一行的文字
		month: string; // 本月那一行的文字
		year: string; // 本年那一行的文字
	};
	showRemaining: boolean; // true：今天显示「距明天还有 时:分:秒」，本月/本年显示「还剩 N 天」
};

// 切换浏览器标签页时的标题轮播
export type TabTitleConfig = {
	enable: boolean; // 是否启用
	titles: string[]; // 轮播文案，为空数组则不启用
	intervalMs: number; // 轮播间隔（毫秒）
};
