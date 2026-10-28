import type { ToolCategory, ToolsPageConfig } from "../types/toolsConfig";
// 工具数据单独放在 JSON 里：加工具 / 改介绍只动 tools.json，不用碰 TS
import toolsData from "./tools.json";

// 工具箱页面文案（title / description 会用于页面标题与 SEO 描述）
export const toolsPageConfig: ToolsPageConfig = {
	title: "工具箱",
	description:
		"收藏好用的网页工具，按用途分类整理；每个工具都写了简介、亮点和使用提示，方便快速判断要不要用。",
};

// 分类与工具条目
export const toolsCategories: ToolCategory[] = toolsData.categories;
