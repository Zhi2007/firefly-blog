import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";
import type { NavOverrides } from "../types/navOverrides";
// 面板写的覆盖文件（隐藏 / 改名 / 排序）。tsconfig（astro base）已开 resolveJsonModule，
// 所以这里直接 import；JSON 会被打包器内联，客户端组件引用本模块也不会出问题。
// 注意：这份 JSON 不能写注释（JSON 不支持），字段说明见 src/types/navOverrides.ts。
import navOverridesJson from "./nav-overrides.json";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// NavBar Configuration - Dynamically generate navigation bar links based on order
// ============================================================================
const getDynamicNavBarConfig = (): NavBarConfig => {
	// 基础导航栏链接
	const links: NavBarLink[] = [];

	// 主页
	links.push(LinkPresets.Home);

	// 公告（独立页面，见 src/pages/announcement.astro）
	links.push({
		id: "announcement",
		name: "公告",
		url: "/announcement/",
		icon: "material-symbols:campaign",
	});

	// 文章及其子菜单
	links.push({
		id: "articles",
		name: "文章",
		url: "#",
		icon: "material-symbols:article",
		children: [
			// 归档
			LinkPresets.Archive,

			// 分类
			LinkPresets.Categories,

			// 标签
			LinkPresets.Tags,

			// 系列
			LinkPresets.Series,
		],
	});

	//社交及其子菜单
	links.push({
		id: "social",
		name: "社交",
		url: "#",
		icon: "material-symbols:group",
		children: [
			// 友链
			LinkPresets.Friends,

			// 留言
			LinkPresets.Guestbook,
		],
	});

	// 栀海及其子菜单
	links.push({
		id: "mine",
		name: "栀海",
		url: "#",
		icon: "material-symbols:person",
		children: [
			// 动态
			LinkPresets.Dynamic,

			// 项目
			LinkPresets.Projects,

			// 相册
			LinkPresets.Gallery,

			// 书签导航
			LinkPresets.Booknav,

			// 哔哩哔哩追番
			LinkPresets.Bilibili,

			// 番组计划
			LinkPresets.Bangumi,

			// VNDB
			LinkPresets.VNDB,

			// MyAnimeList
			LinkPresets.MAL,
		],
	});

	// 关于（原先是个含「打赏」的子菜单，打赏入口已移除，改为直接跳转）
	links.push(LinkPresets.About);

	// 自定义导航栏链接
	links.push({
		id: "links",
		name: "链接",
		url: "#",
		icon: "material-symbols:link",
		// 子菜单
		children: [
			{
				id: "links-github",
				name: "栀海的 GitHub",
				url: "https://github.com/Zhi2007",
				external: true,
				icon: "fa7-brands:github",
			},
			{
				id: "links-bilibili",
				name: "栀海的 B 站",
				url: "https://space.bilibili.com/502912899",
				external: true,
				icon: "fa7-brands:bilibili",
			},
			{
				id: "links-source",
				name: "本站源码",
				url: "https://github.com/Zhi2007/firefly-blog",
				external: true,
				icon: "fa7-solid:code-branch",
			},
			{
				// 署名：本站使用的主题
				id: "links-theme",
				name: "主题 Firefly（CuteLeaf）",
				url: "https://github.com/CuteLeaf/Firefly",
				external: true,
				icon: "material-symbols:favorite",
			},
			{
				id: "links-firefly-docs",
				name: "Firefly 文档",
				url: "https://docs-firefly.cuteleaf.cn",
				external: true,
				icon: "material-symbols:docs",
			},
		],
	});

	// 文档链接
	// links.push({
	// 	name: "文档",
	// 	url: "https://docs-firefly.cuteleaf.cn",
	// 	external: true,
	// 	icon: "material-symbols:docs",
	// });

	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

// ============================================================================
// 链接预设 - 可自由自定义导航栏链接的名称、图标和URL
// Link Presets - Allows free customization of the name, icon, and URL of navigation bar links
// ============================================================================
export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		id: "home",
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Archive: {
		id: "archive",
		name: "归档",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	Categories: {
		id: "categories",
		name: "分类",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Tags: {
		id: "tags",
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Series: {
		id: "series",
		name: "系列",
		url: "/series/",
		icon: "material-symbols:layers",
	},
	Friends: {
		id: "friends",
		name: "友链",
		url: "/friends/",
		icon: "material-symbols:link-2-rounded",
		pageKey: "friends",
	},
	Guestbook: {
		id: "guestbook",
		name: "留言",
		url: "/guestbook/",
		icon: "material-symbols:chat",
		pageKey: "guestbook",
	},
	Dynamic: {
		id: "dynamic",
		name: "动态",
		url: "/dynamic/",
		icon: "material-symbols:forum-rounded",
		pageKey: "dynamic",
	},
	Projects: {
		id: "projects",
		name: "项目",
		url: "/projects/",
		icon: "material-symbols:rocket-launch",
		pageKey: "projects",
	},
	Gallery: {
		id: "gallery",
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
	Booknav: {
		id: "booknav",
		name: "书签导航",
		url: "/booknav/",
		icon: "material-symbols:bookmarks",
		pageKey: "booknav",
	},
	Bilibili: {
		id: "bilibili",
		name: "哔哩哔哩",
		url: "/bilibili/",
		icon: "fa7-brands:bilibili",
		pageKey: "bilibili",
	},
	Bangumi: {
		id: "bangumi",
		name: "番组计划",
		url: "/bangumi/",
		icon: "material-symbols:movie",
		pageKey: "bangumi",
	},
	VNDB: {
		id: "vndb",
		name: "VNDB",
		url: "/vndb/",
		icon: "material-symbols:chrome-reader-mode-rounded",
		pageKey: "vndb",
	},
	MAL: {
		id: "mal",
		name: "AnimeList",
		url: "/myanimelist/",
		icon: "material-symbols:menu-book",
		pageKey: "mal",
	},
	Sponsor: {
		id: "sponsor",
		name: "打赏",
		url: "/sponsor/",
		icon: "material-symbols:favorite",
		pageKey: "sponsor",
	},
	About: {
		id: "about",
		name: "关于栀海",
		url: "/about/",
		icon: "material-symbols:person",
	},
};

// ============================================================================
// 外部覆盖：面板写 src/config/nav-overrides.json，主题在这里应用
// 支持三件事：hidden 隐藏 / renamed 改名 / order 排序。
// 空覆盖（三个字段都为空）= 原样返回，和以前的行为完全一致。
// ============================================================================

/**
 * 取菜单项的稳定 id（面板前端也用同一套规则渲染列表）。
 * 顺序：显式 id → pageKey → url 里的路径名 → name 兜底。
 * 当前配置里每个菜单项都写了显式 id，回退分支只是防止漏写时整份配置崩掉。
 */
export function navItemId(link: NavBarLink): string {
	if (link.id) return link.id;
	if (link.pageKey) return link.pageKey;
	const slug = String(link.url ?? "")
		.replace(/[?#].*$/, "")
		.replace(/^\/+|\/+$/g, "")
		.toLowerCase();
	return slug || link.name;
}

/** 把 JSON 里的值收敛成干净的字符串数组：类型不对就当没写，绝不影响现有行为 */
function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

/** 把 JSON 里的值收敛成「id → 新名称」：只接受非空字符串，其余忽略 */
function asRenameMap(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return out;
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw !== "string") continue;
		const name = raw.trim();
		const id = key.trim();
		if (id && name) out[id] = name;
	}
	return out;
}

/** 把导入的 JSON 收敛成合法结构（字段缺失 / 类型不对 → 视为不覆盖） */
export function normalizeNavOverrides(value: unknown): NavOverrides {
	const raw = (value && typeof value === "object" ? value : {}) as Record<
		string,
		unknown
	>;
	return {
		hidden: asStringArray(raw.hidden),
		order: asStringArray(raw.order),
		renamed: asRenameMap(raw.renamed),
	};
}

/**
 * 按 hidden 递归过滤。分组里子项被隐藏光了，整组一起隐藏
 * （主题原有的「空分组不渲染」也是这个效果，这里提前做掉，避免留下 children: []）。
 * 返回值带上 changed：没有任何改动时原样返回原数组引用，
 * 保证"空覆盖 = 什么都没发生"（注意 changed 要从子层一路传上来，
 * 只看本层有没有直接删除会漏掉"只隐藏了部分子项"的情况）。
 */
function filterHidden(
	links: NavBarLink[],
	hidden: Set<string>,
): { links: NavBarLink[]; changed: boolean } {
	let changed = false;
	const kept: NavBarLink[] = [];
	for (const link of links) {
		if (hidden.has(navItemId(link))) {
			changed = true;
			continue;
		}
		if (!link.children) {
			kept.push(link);
			continue;
		}
		const result = filterHidden(link.children, hidden);
		if (!result.changed) {
			kept.push(link);
			continue;
		}
		changed = true;
		if (result.links.length === 0) continue; // 子项全被隐藏 → 父分组也隐藏
		kept.push({ ...link, children: result.links });
	}
	return { links: changed ? kept : links, changed };
}

/**
 * 按 order 重排：order 里出现的 id 按数组顺序靠前，没提到的项保持原有相对顺序排在后面。
 * 每一层菜单都套用同一份 order（不属于该层的 id 自然被忽略），所以子菜单也能一起排。
 * 用「原始下标」做并列时的次序，排序结果与 sort 的实现稳定性无关。
 */
function sortByOrder(links: NavBarLink[], order: string[]): NavBarLink[] {
	const rank = new Map<string, number>();
	order.forEach((id, index) => {
		if (!rank.has(id)) rank.set(id, index); // 重复 id 只认第一次
	});
	return links
		.map((link, index) => {
			const children = link.children
				? sortByOrder(link.children, order)
				: undefined;
			return {
				link: children === link.children ? link : { ...link, children },
				index,
			};
		})
		.sort((a, b) => {
			const rankA = rank.get(navItemId(a.link)) ?? Number.MAX_SAFE_INTEGER;
			const rankB = rank.get(navItemId(b.link)) ?? Number.MAX_SAFE_INTEGER;
			return rankA === rankB ? a.index - b.index : rankA - rankB;
		})
		.map((entry) => entry.link);
}

/** 按 renamed 改名（递归）。只克隆改过名的项，其余项保持原对象引用 */
function renameLinks(
	links: NavBarLink[],
	renamed: Record<string, string>,
): NavBarLink[] {
	return links.map((link) => {
		const name = renamed[navItemId(link)];
		const children = link.children
			? renameLinks(link.children, renamed)
			: undefined;
		if (name === undefined && children === link.children) return link;
		return {
			...link,
			...(name === undefined ? {} : { name }),
			...(children === undefined ? {} : { children }),
		};
	});
}

/**
 * 对导航菜单应用外部覆盖（纯函数：不改动传入的对象）。
 * 处理顺序：先隐藏 → 再排序 → 最后改名（改名不影响 id，所以放最后）。
 * @param config 原始导航配置
 * @param overrides 覆盖内容；可以是 normalizeNavOverrides 的结果，
 *                  也可以是原始 JSON（此时缺字段/类型不对的部分按"不覆盖"处理）
 */
export function applyNavOverrides(
	config: NavBarConfig,
	overrides: Partial<NavOverrides>,
): NavBarConfig {
	const hidden = new Set(overrides.hidden ?? []);
	const order = overrides.order ?? [];
	const renamed = overrides.renamed ?? {};
	// 空覆盖：原样返回，连对象引用都不变
	if (
		hidden.size === 0 &&
		order.length === 0 &&
		Object.keys(renamed).length === 0
	) {
		return config;
	}
	let links = config.links;
	if (hidden.size > 0) links = filterHidden(links, hidden).links;
	if (order.length > 0) links = sortByOrder(links, order);
	if (Object.keys(renamed).length > 0) links = renameLinks(links, renamed);
	return { links };
}

export const navBarConfig: NavBarConfig = applyNavOverrides(
	getDynamicNavBarConfig(),
	normalizeNavOverrides(navOverridesJson),
);
