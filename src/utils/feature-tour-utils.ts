/**
 * 主页「功能导览」部件的纯逻辑（不含 DOM、不含 Svelte），方便单独断言。
 *
 * 组件（`src/components/features/FeatureTour.svelte`）只负责把这些结果贴到界面上；
 * 翻页的边界行为全部在这里决定，所以这一层是唯一需要测试的地方。
 */

/** 翻页方向 */
export type FeatureTourDirection = "next" | "previous";

/** 卡片一次翻页的移动量（像素），取绝对值；也给触摸滑动用同一个阈值 */
export const FEATURE_TOUR_SWIPE_THRESHOLD_PX = 40;

/**
 * 把页码夹进 [0, totalPages - 1]。
 * 非整数（NaN、小数）按 0 处理，避免把 NaN 传进渲染。
 */
export function clampPageIndex(index: number, totalPages: number): number {
	const last = getLastPageIndex(totalPages);
	if (last < 0) return 0;
	if (!Number.isFinite(index)) return 0;
	return Math.min(Math.max(Math.trunc(index), 0), last);
}

/** 最后一页的下标；没有页面时返回 -1 */
export function getLastPageIndex(totalPages: number): number {
	if (!Number.isFinite(totalPages)) return -1;
	const count = Math.trunc(totalPages);
	return count > 0 ? count - 1 : -1;
}

/**
 * 相对当前页翻一页，**循环**（下一页越界回到第 0 页，上一页越界回到最后一页）。
 * 只有一页时永远返回 0。
 */
export function getAdjacentPageIndex(
	currentIndex: number,
	totalPages: number,
	direction: FeatureTourDirection,
): number {
	const last = getLastPageIndex(totalPages);
	if (last < 0) return 0;
	const current = clampPageIndex(currentIndex, totalPages);
	if (last === 0) return 0;
	return direction === "next"
		? current === last
			? 0
			: current + 1
		: current === 0
			? last
			: current - 1;
}

/** 下一页（循环） */
export function getNextPageIndex(
	currentIndex: number,
	totalPages: number,
): number {
	return getAdjacentPageIndex(currentIndex, totalPages, "next");
}

/** 上一页（循环） */
export function getPreviousPageIndex(
	currentIndex: number,
	totalPages: number,
): number {
	return getAdjacentPageIndex(currentIndex, totalPages, "previous");
}

/**
 * 判断一次水平位移是否够格当作翻页手势。
 * - 必须超过阈值；
 * - 水平位移必须明显大于垂直位移，否则会把「纵向滚动手滑了一点」误判成翻页；
 * - 方向为「向左滑 = 下一页」（手势方向为负时返回 next）。
 */
export function resolveSwipeDirection(
	deltaX: number,
	deltaY: number,
	thresholdPx: number = FEATURE_TOUR_SWIPE_THRESHOLD_PX,
): FeatureTourDirection | null {
	if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
	if (Math.abs(deltaX) < thresholdPx) return null;
	if (Math.abs(deltaX) <= Math.abs(deltaY)) return null;
	return deltaX < 0 ? "next" : "previous";
}
