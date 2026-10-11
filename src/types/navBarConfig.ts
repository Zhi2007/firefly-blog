export type NavBarLink = {
	name: string;
	url: string;
	external?: boolean;
	icon?: string; // 菜单项图标
	children?: NavBarLink[]; // 支持子菜单
	pageKey?: string;
	/**
	 * 菜单项的稳定标识，供 nav-overrides.json（面板隐藏/改名/排序）引用。
	 * 之所以要显式写：像「文章 / 社交 / 栀海 / 链接」这些父分组的 url 都是 "#"，
	 * 光靠 url 或 pageKey 区分不开；而且改名之后 name 也会变，不能当标识用。
	 * 没写时回退顺序：pageKey → url 路径名 → name，见 navBarConfig.ts 的 navItemId()。
	 */
	id?: string;
};

export enum NavBarSearchMethod {
	PageFind = 0,
}

export type NavBarSearchConfig = {
	method: NavBarSearchMethod;
};

export type NavBarConfig = {
	links: NavBarLink[];
};
