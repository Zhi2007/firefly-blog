/**
 * 导航栏外部覆盖的类型定义
 *
 * 为什么要有这层：导航菜单原先只能靠改 src/config/navBarConfig.ts 来调整，
 * 让管理面板直接改 TS 源码风险太大（改坏一个字符整个构建就挂）。
 * 现在面板只写 src/config/nav-overrides.json，主题在导出 navBarConfig 之前把这份
 * 覆盖应用到菜单数组上，TS 源码保持不动；字段缺失或文件为空时等于"什么都没发生"。
 */
export type NavOverrides = {
	/** 需要隐藏的菜单项 id；分组和子项都支持，分组里子项被隐藏光了整组也会隐藏 */
	hidden: string[];
	/**
	 * 菜单项显示顺序：列在这里的 id 按数组顺序排在前面，
	 * 没提到的项保持原有相对顺序追加在后面；每一层菜单都套用同一份 order
	 * （不属于该层的 id 会被自然忽略）。未知 id 不会报错，也不会影响其它项。
	 */
	order: string[];
	/** 菜单项 id → 新名称；只改显示名，url / icon / 子菜单都不动 */
	renamed: Record<string, string>;
};
