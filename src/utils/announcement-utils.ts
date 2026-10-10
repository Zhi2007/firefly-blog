import type {
	AnnouncementConfig,
	AnnouncementItem,
} from "@/types/announcementConfig";

/**
 * 公告排序：pinned 的永远排最前，其余按发布日期倒序（新的在前）。
 * 注意不要就地修改传入的数组。
 */
export function sortAnnouncements(
	items: AnnouncementItem[],
): AnnouncementItem[] {
	return [...items].sort((a, b) => {
		const pinnedDiff = Number(!!b.pinned) - Number(!!a.pinned);
		if (pinnedDiff !== 0) return pinnedDiff;
		return (b.published || "").localeCompare(a.published || "");
	});
}

/**
 * 取出「固定公告」：优先 pinned 的那条；没有 pinned 时退回最新的一条。
 * 首访弹窗与侧边栏公告栏都用这个结果，所以新发公告不会顶掉固定公告。
 */
export function resolvePinnedAnnouncement(
	items: AnnouncementItem[],
): AnnouncementItem | undefined {
	return sortAnnouncements(items)[0];
}

/**
 * 弹窗"已读"标识：pinned 公告的 id + 版本号。
 * 只要换掉固定公告、或改动它的 version，访客就会重新看到一次弹窗。
 */
export function getModalStorageValue(
	config: AnnouncementConfig,
	item: AnnouncementItem,
): string {
	const prefix = config.modal?.storageKey || "announcement-modal";
	return `${prefix}::${item.id}::${item.version || item.published || "1"}`;
}

/** 把公告正文按空行拆成段落，供组件逐段渲染 */
export function splitParagraphs(content: string): string[] {
	return content
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
}
