/**
 * 更新公告草稿生成器 —— **纯逻辑**，零依赖（不 import 任何模块，连 node: 都不用）。
 *
 * 为什么单独抽成一个文件：
 *   1. 面板（admin/server.mjs）只负责「跑 git log + 拼 HTTP 响应」，把「提交怎么解析、
 *      怎么分组、怎么写成面向访客的中文短句」这些会出错的规则集中在这里；
 *   2. 它是纯函数，可以离线反复复跑（把提交对象数组丢进来就行），不需要起面板、不需要联网；
 *   3. 生成的只是**草稿**：调用方必须把它填进表单让人确认后再保存，绝不自动发布。
 *
 * 三条硬规则（改这个文件时不要破坏）：
 *   · **只读**：这里不写文件、不起进程、不联网。git 由调用方去跑。
 *   · **不注入**：提交说明是外部文本，进 Markdown 之前一律过 escapeMarkdownText()。
 *   · **不编造**：机械整理得到的中文一定比人写的差 —— 凡是不够好的地方都要进 warnings，
 *     让人去润色，而不是假装它已经能直接用。
 */

/* ── 常量：与 git log 的输出格式一一对应 ──────────────────────────────────── */

/** 记录分隔符（RS）：git log 的 `%x1e`，用来切分「一条提交」 */
export const RECORD_SEP = "\u001e";
/** 字段分隔符（US）：git log 的 `%x1f`，用来切分提交内的字段（正文可能含换行，所以不能用换行切） */
export const FIELD_SEP = "\u001f";
/** 传给 `git log --pretty=format:` 的格式串：完整 sha / 短 sha / 主题 / 正文 */
export const COMMIT_LOG_FORMAT = `%H${FIELD_SEP}%h${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
/** 不给起始点时，「最近 N 条提交」的默认 N */
export const DEFAULT_RECENT_LIMIT = 20;
/** 单次最多取回多少条提交（防止 `--since` 给了个远古日期时把整段历史读进来） */
export const MAX_FETCH = 200;
/** 用户可填的 limit 上限 */
export const MAX_LIMIT = 200;
/** 用户可填的「最近 N 天」上限 */
export const MAX_DAYS = 3650;
/** GET 查询串里允许出现的键（token 是认证用的，不是生成参数） */
export const QUERY_KEYS = ["since", "limit", "token"];
/** 草稿里分组的固定顺序 */
export const GROUP_ORDER = ["新增", "修复", "优化", "其它维护"];
/** Conventional Commits 类型 → 面向访客的分组 */
export const GROUP_TYPES = { feat: "新增", fix: "修复", perf: "优化" };
/**
 * 完全跳过的类型：它们是「维护噪音」，对访客没有意义。
 * 注意这里**不含** refactor / revert：那两类会进「其它维护」，因为重构有时确实影响行为。
 */
export const IGNORED_TYPES = [
	"chore",
	"docs",
	"style",
	"ci",
	"test",
	"build",
	"release",
	"typo",
];
/** 单条要点的字符上限，超了截断并提示人工精简 */
export const MAX_BULLET_CHARS = 160;
/** 常见 scope → 中文前缀（认不出就用原文） */
export const SCOPE_LABELS = {
	admin: "面板",
	layout: "布局",
	ui: "界面",
	home: "主页",
	post: "文章",
	posts: "文章",
	announcement: "公告",
	announce: "公告",
	config: "配置",
	settings: "设置",
	music: "音乐",
	friends: "友链",
	media: "媒体",
	search: "搜索",
	comment: "评论",
	comments: "评论",
	docs: "文档",
	doc: "文档",
	ci: "CI",
	build: "构建",
	perf: "性能",
	theme: "主题",
	seo: "SEO",
	security: "安全",
	worker: "Worker",
	avatar: "头像",
	nav: "导航",
	navbar: "导航",
	i18n: "多语言",
};

/** 英文动词首词 → 中文（只映射第一个词，剩下的英文原样留着等人润色） */
const LEADING_VERBS = [
	[/^add(?:s|ed|ing)?$/i, "新增"],
	[/^support(?:s|ed|ing)?$/i, "支持"],
	[/^allow(?:s|ed|ing)?$/i, "支持"],
	[/^enable(?:s|d|ing)?$/i, "启用"],
	[/^introduce(?:s|d|ing)?$/i, "新增"],
	[/^implement(?:s|ed|ing)?$/i, "实现"],
	[/^fix(?:es|ed|ing)?$/i, "修复"],
	[/^correct(?:s|ed|ing)?$/i, "修正"],
	[/^repair(?:s|ed|ing)?$/i, "修复"],
	[/^resolve(?:s|d|ing)?$/i, "解决"],
	[/^prevent(?:s|ed|ing)?$/i, "避免"],
	[/^avoid(?:s|ed|ing)?$/i, "避免"],
	[/^remove(?:s|d|ing)?$/i, "移除"],
	[/^delete(?:s|d|ing)?$/i, "删除"],
	[/^drop(?:s|ped|ping)?$/i, "移除"],
	[/^update(?:s|d|ing)?$/i, "更新"],
	[/^upgrade(?:s|d|ing)?$/i, "升级"],
	[/^bump(?:s|ed|ing)?$/i, "升级"],
	[/^improve(?:s|d|ing)?$/i, "优化"],
	[/^optimize(?:s|d|ing)?$/i, "优化"],
	[/^speed\s+up$/i, "加速"],
	[/^refactor(?:s|ed|ing)?$/i, "重构"],
	[/^rename(?:s|d|ing)?$/i, "重命名"],
	[/^move(?:s|d|ing)?$/i, "移动"],
	[/^migrate(?:s|d|ing)?$/i, "迁移"],
	[/^replace(?:s|d|ing)?$/i, "替换"],
	[/^simplify$/i, "简化"],
	[/^simplif(?:ies|ied|ying)$/i, "简化"],
	[/^make$/i, "让"],
	[/^use$/i, "改用"],
	[/^handle$/i, "处理"],
	[/^ensure(?:s|d|ing)?$/i, "确保"],
	[/^change(?:s|d|ing)?$/i, "调整"],
	[/^adjust(?:s|ed|ing)?$/i, "调整"],
];

/* ── 1. 提交解析（纯函数） ────────────────────────────────────────────────── */

/** Conventional Commits：`type(scope)!: subject`，type 必须是字母开头的单词 */
const CONVENTIONAL_RE =
	/^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()]*)\))?(!)?:\s*(.*)$/;
/** 合并提交：git 默认生成的 `Merge branch 'x'` / `Merge pull request #1 from …` */
const MERGE_RE = /^Merge\b/i;
/** 严格的 YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 7~40 位十六进制 = 提交 sha */
const SHA_RE = /^[0-9a-fA-F]{7,40}$/;
/** 1~4 位纯数字 = 「最近 N 天」（放在 sha 之前判断，否则 30 会被当成 sha） */
const DAYS_RE = /^\d{1,4}$/;
/** 含中日韩文字 = 已经是中文，不需要机械整理 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 剔除控制字符（含 git 用的 RS/US 分隔符）。
 * 提交说明是外部文本：主题要变成单行要点，所以默认连换行/制表符一起剔掉；
 * 正文（`%b`）需要保留换行才能识别 `BREAKING CHANGE:`，那一步传 keepNewlines = true。
 * （不用正则可避免 Biome 的 noControlCharactersInRegex，也更好读。）
 */
function stripControlChars(text, keepNewlines = false) {
	let out = "";
	for (const char of String(text ?? "")) {
		const code = char.charCodeAt(0);
		const printable = code > 31 && code !== 127;
		const allowedWhitespace = keepNewlines && (code === 9 || code === 10);
		if (printable || allowedWhitespace) out += char;
	}
	return out;
}

/**
 * 解析一条提交说明（Conventional Commit）。
 * @param {string} subject 提交主题（单行）
 * @returns {{raw: string, conventional: boolean, type: string, scope: string, subject: string, breaking: boolean}}
 */
export function parseConventionalSubject(subject) {
	const raw = stripControlChars(subject).trim();
	const matched = raw.match(CONVENTIONAL_RE);
	if (!matched) {
		return {
			raw,
			conventional: false,
			type: "",
			scope: "",
			subject: raw,
			breaking: false,
		};
	}
	return {
		raw,
		conventional: true,
		type: String(matched[1]).toLowerCase(),
		scope: String(matched[2] ?? "").trim(),
		subject: String(matched[4] ?? "").trim(),
		breaking: matched[3] === "!",
	};
}

/**
 * 是否合并提交（合并提交一律不进草稿：对访客没有信息量）。
 * @param {string} subject
 * @returns {boolean}
 */
export function isMergeSubject(subject) {
	return MERGE_RE.test(stripControlChars(subject).trim());
}

/** 判断 `YYYY-MM-DD` 是不是真实存在的日期（挡掉 2026-02-30） */
function isRealDate(text) {
	const [y, m, d] = text.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return (
		date.getUTCFullYear() === y &&
		date.getUTCMonth() === m - 1 &&
		date.getUTCDate() === d
	);
}

/**
 * 把一条记录（4 个字段 / 或手写的两列文本）补成统一的提交对象。
 * @param {{hash?: string, shortHash?: string, subject?: string, body?: string}} record
 */
function normalizeRecord(record) {
	const hash = String(record?.hash ?? "").trim();
	const subject = stripControlChars(record?.subject).trim();
	const body = stripControlChars(record?.body, true).trim();
	const parsed = parseConventionalSubject(subject);
	const breaking = parsed.breaking || /^BREAKING[ -]CHANGE:/im.test(body);
	return {
		hash,
		shortHash: String(record?.shortHash ?? "").trim() || hash.slice(0, 7),
		subject,
		body,
		raw: parsed.raw,
		type: parsed.type,
		scope: parsed.scope,
		text: parsed.subject,
		conventional: parsed.conventional,
		breaking,
		merge: isMergeSubject(subject),
	};
}

/** 手写文本兜底：每行 `sha 说明`（或只有说明） */
function parsePlainLine(line) {
	const text = String(line ?? "").trim();
	if (!text) return null;
	const matched = text.match(/^([0-9a-fA-F]{7,40})\s+(.*)$/);
	if (matched) {
		return normalizeRecord({
			hash: matched[1],
			shortHash: matched[1].slice(0, 7),
			subject: matched[2],
			body: "",
		});
	}
	return normalizeRecord({ subject: text });
}

/** 一条结构化记录的首页字段必须像个 sha（40 位 hex）：用来识破「提交说明里塞了 RS 伪造记录」 */
function isPlausibleHash(text) {
	return /^[0-9a-fA-F]{7,64}$/.test(String(text ?? "").trim());
}

/**
 * 解析 `git log` 的输出（用 COMMIT_LOG_FORMAT 生成的格式）为提交对象数组。
 * 也兼容「每行一条 `sha 说明`」的简写，方便离线复跑与手工粘贴。
 *
 * 提交说明理论上可以包含任何非 NUL 字节（包括 RS），所以结构化分支额外要求「记录的
 * 首页字段像 sha」——不像 sha 的片段会被并进上一条的正文，而不是伪造成一条新提交。
 * @param {string} text
 * @returns {Array<object>}
 */
export function parseCommitLog(text) {
	const source = String(text ?? "");
	if (source.includes(RECORD_SEP)) {
		const records = [];
		for (const chunk of source.split(RECORD_SEP)) {
			const raw = chunk.replace(/^\r?\n/, "");
			if (!raw.trim()) continue;
			const parts = raw.split(FIELD_SEP);
			if (parts.length >= 2 && isPlausibleHash(parts[0])) {
				records.push(
					normalizeRecord({
						hash: parts[0],
						shortHash: parts[1],
						subject: parts[2] ?? "",
						body: parts.slice(3).join(FIELD_SEP),
					}),
				);
				continue;
			}
			const previous = records[records.length - 1];
			if (previous) {
				previous.body = `${previous.body}\n${parts.join(FIELD_SEP)}`.trim();
			}
		}
		return records;
	}
	return source.split(/\r?\n/).map(parsePlainLine).filter(Boolean);
}

/* ── 2. Markdown 转义与中文整理（纯函数） ─────────────────────────────────── */

/**
 * 把任意外部文本安全地放进 Markdown 行内。
 * `<` / `>` 也一起转义：提交说明里若写了 `<script>`，出来的草稿里必须是字面量而不是标签 ——
 * 草稿最终会进公告正文，而正文会被面板的 Markdown 预览渲染、也会被站点页面渲染。
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdownText(text) {
	return stripControlChars(text).replace(
		/[\\`*_[\]<>#|]/g,
		(char) => `\\${char}`,
	);
}

/** 去掉中文/英文句尾多余的标点，避免出现「修复了…。。」 */
function stripTrailingPunct(text) {
	return text.replace(/[.。;；,，\s]+$/g, "");
}

/**
 * 机械整理一条提交说明：中文原样用，英文只映射首词并留下 warning 让人润色。
 * 明确不是翻译：它不会（也不该假装）产出自然中文。
 * @param {object} commit normalizeRecord 的结果
 * @returns {{text: string, polished: boolean, mapped: boolean}}
 */
export function localizeCommitText(commit) {
	const subject = String(commit?.text ?? "").trim();
	if (!subject)
		return {
			text: "（提交说明为空，请人工补充）",
			polished: false,
			mapped: false,
		};
	if (CJK_RE.test(subject))
		return {
			text: stripTrailingPunct(subject),
			polished: false,
			mapped: false,
		};
	const words = subject.split(/\s+/);
	const head = words[0] ?? "";
	const rest = words.slice(1).join(" ");
	for (const [pattern, label] of LEADING_VERBS) {
		if (pattern.test(head)) {
			const tail = stripTrailingPunct(rest);
			return {
				text: tail ? `${label} ${tail}` : label,
				polished: true,
				mapped: true,
			};
		}
	}
	return { text: stripTrailingPunct(subject), polished: true, mapped: false };
}

/** 长文本截断（超长行不能把公告撑成一面墙） */
function truncate(text, limit) {
	if (text.length <= limit) return { text, truncated: false };
	return { text: `${text.slice(0, limit - 1)}…`, truncated: true };
}

/**
 * 生成一条提交对应的要点文本：`【面板】新增 xxx（破坏性变更）`
 * @param {object} commit
 * @returns {{text: string, truncated: boolean, empty: boolean, needsPolish: boolean, mapped: boolean}}
 */
export function describeCommitBullet(commit) {
	const localized = localizeCommitText(commit);
	const scope = String(commit?.scope ?? "").trim();
	const scopeLabel = scope ? (SCOPE_LABELS[scope.toLowerCase()] ?? scope) : "";
	const prefix = scopeLabel ? `【${escapeMarkdownText(scopeLabel)}】` : "";
	const suffix = commit?.breaking ? "（破坏性变更）" : "";
	const room = Math.max(24, MAX_BULLET_CHARS - prefix.length - suffix.length);
	const clipped = truncate(localized.text, room);
	return {
		text: `${prefix}${escapeMarkdownText(clipped.text)}${suffix}`,
		truncated: clipped.truncated,
		empty: !String(commit?.text ?? "").trim(),
		needsPolish: localized.polished,
		mapped: localized.mapped,
	};
}

/* ── 3. 草稿组装（纯函数） ───────────────────────────────────────────────── */

/** UTC 日期串 YYYY-MM-DD */
export function formatDay(now = Date.now()) {
	const date = new Date(Number(now));
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** 「最近 N 天」对应的起始日期（UTC，含当天） */
export function daysAgoIsoDate(days, now = Date.now()) {
	return formatDay(Number(now) - Number(days) * 24 * 60 * 60 * 1000);
}

/**
 * 建议的公告 id：`update-YYYY-MM-DD[-<短 sha>]`。
 * 必须满足公告 id 的既有约束 `^[A-Za-z0-9._-]+$`（admin/server.mjs 的 sanitizeAnnouncements）。
 * @param {Array<object>} commits
 * @param {number} now
 */
export function suggestDraftId(commits, now = Date.now()) {
	const first = (Array.isArray(commits) ? commits : []).find((commit) =>
		String(commit?.shortHash ?? "").trim(),
	);
	const hash = String(first?.shortHash ?? "")
		.replace(/[^0-9A-Za-z]/g, "")
		.slice(0, 7);
	return `update-${formatDay(now)}${hash ? `-${hash}` : ""}`;
}

/** 把任意输入补成可读的提交对象（字符串按「`sha 说明` 或纯说明」处理） */
function toCommit(input) {
	if (input && typeof input === "object") {
		if ("conventional" in input || "merge" in input) return input;
		return normalizeRecord(input);
	}
	return (
		parsePlainLine(String(input ?? "")) ?? normalizeRecord({ subject: "" })
	);
}

/**
 * 由提交对象数组生成更新公告草稿。
 *
 * 规则（与 admin/README.md「更新公告草稿」一节逐条对应）：
 *   · 合并提交 → 跳过（只计数）；
 *   · IGNORED_TYPES（chore/docs/style/ci/test/build/release/typo）→ 跳过（只计数）；
 *   · feat/fix/perf → 分别进「新增 / 修复 / 优化」；
 *   · 其它（refactor/revert/未知类型/非 Conventional）→ 进「其它维护」，**原样保留**并给 warning；
 *   · 组内保持 git log 的顺序（新 → 旧），组间按 GROUP_ORDER；同组内完全相同的要点去重。
 *
 * @param {Array<object|string>} commits
 * @param {{now?: number, titlePrefix?: string}} [options]
 * @returns {{title: string, body: string, warnings: string[], stats: object}}
 */
export function buildAnnouncementDraft(commits, options = {}) {
	const now = Number.isFinite(Number(options.now))
		? Number(options.now)
		: Date.now();
	const titlePrefix = String(options.titlePrefix ?? "更新");
	const list = Array.isArray(commits) ? commits : [];
	const groups = new Map(GROUP_ORDER.map((name) => [name, []]));
	const seen = new Set();
	const otherTypes = new Set();
	const warnings = [];
	const stats = {
		total: list.length,
		used: 0,
		empty: true,
		skippedMerge: 0,
		skippedNoise: 0,
		deduped: 0,
		truncated: 0,
		emptySubjects: 0,
		englishSubjects: 0,
		unconventional: 0,
		breaking: 0,
		groups: { 新增: 0, 修复: 0, 优化: 0, 其它维护: 0 },
	};

	for (const input of list) {
		const commit = toCommit(input);
		if (commit.merge) {
			stats.skippedMerge += 1;
			continue;
		}
		if (IGNORED_TYPES.includes(commit.type)) {
			stats.skippedNoise += 1;
			continue;
		}
		const group = GROUP_TYPES[commit.type] ?? "其它维护";
		if (group === "其它维护") {
			if (commit.conventional) otherTypes.add(commit.type || "(无类型)");
			else stats.unconventional += 1;
		}
		const bullet = describeCommitBullet(commit);
		if (bullet.empty) stats.emptySubjects += 1;
		if (bullet.needsPolish) stats.englishSubjects += 1;
		if (bullet.truncated) stats.truncated += 1;
		if (commit.breaking) stats.breaking += 1;
		const key = `${group}\u0000${bullet.text}`;
		if (seen.has(key)) {
			stats.deduped += 1;
			continue;
		}
		seen.add(key);
		groups.get(group).push(bullet.text);
		stats.groups[group] += 1;
		stats.used += 1;
	}

	stats.empty = stats.used === 0;

	// ── 标题：一句话概括「这次更新有什么」 ──
	const otherGroup = "其它维护";
	const summary = ["新增", "修复", "优化"]
		.filter((name) => stats.groups[name] > 0)
		.map((name) => `${name} ${stats.groups[name]} 项`);
	if (summary.length === 0 && stats.groups[otherGroup] > 0) {
		summary.push(`${otherGroup} ${stats.groups[otherGroup]} 项`);
	}
	const breakingNote = stats.breaking > 0 ? "（含破坏性变更）" : "";
	const title = stats.empty
		? ""
		: `${titlePrefix}：${summary.join("、")}${breakingNote}`;

	// ── 正文：Markdown 分组列表（每个块之间留一个空行） ──
	let body = "";
	if (!stats.empty) {
		const lines = [`本次更新共 ${stats.used} 项（${formatDay(now)}）：`];
		for (const name of GROUP_ORDER) {
			const items = groups.get(name);
			if (items.length === 0) continue;
			lines.push("", `### ${name}`);
			for (const item of items) lines.push("", `- ${item}`);
		}
		body = lines.join("\n").trimEnd();
	}

	// ── warnings：只放「需要人动手」的事，不写套话 ──
	if (stats.empty) {
		const skipped = [];
		if (stats.skippedMerge > 0)
			skipped.push(`${stats.skippedMerge} 条合并提交`);
		if (stats.skippedNoise > 0)
			skipped.push(`${stats.skippedNoise} 条 chore/docs/style/ci 类提交`);
		warnings.push(
			`在选定的提交区间里没有找到可用的 feat/fix/perf 提交${skipped.length > 0 ? `（已跳过 ${skipped.join("、")}）` : ""}，因此没有生成草稿。可以换一个起始点（更大的天数 / 更早的提交）再试。`,
		);
		return { title, body, warnings, stats };
	}
	if (stats.englishSubjects > 0) {
		warnings.push(
			`有 ${stats.englishSubjects} 条提交说明是英文：只把首词机械映射成了「新增/修复/优化…」，剩下的英文原样保留 —— 请人工润色成自然中文（这一步没有翻译，也不该逐字硬译）。`,
		);
	}
	if (stats.unconventional > 0) {
		warnings.push(
			`有 ${stats.unconventional} 条提交不符合 Conventional Commits（没有「type:」前缀），已原样放进「其它维护」，请人工判断要不要写进公告。`,
		);
	}
	if (otherTypes.size > 0) {
		warnings.push(
			`这些提交类型不在「新增/修复/优化」里：${[...otherTypes].sort().join("、")} —— 已放进「其它维护」，请人工确认是否有面向访客的价值（没有就删掉那一行）。`,
		);
	}
	if (stats.emptySubjects > 0) {
		warnings.push(
			`有 ${stats.emptySubjects} 条提交的说明是空的，已写成「（提交说明为空）」，请人工补充。`,
		);
	}
	if (stats.truncated > 0) {
		warnings.push(
			`有 ${stats.truncated} 条提交说明过长，已截断到 ${MAX_BULLET_CHARS} 字以内，请人工精简。`,
		);
	}
	if (stats.breaking > 0) {
		warnings.push(
			`有 ${stats.breaking} 条破坏性变更（「!」或「BREAKING CHANGE:」）：标题已标注，要点也带了「（破坏性变更）」，请确认是否需要额外说明影响范围。`,
		);
	}
	if (stats.deduped > 0) {
		warnings.push(
			`有 ${stats.deduped} 条重复的要点已合并（同一条提交说明只保留一行）。`,
		);
	}
	warnings.push(
		"站点上的公告正文是按空行分段的纯文本（不解析 Markdown）：像「### 新增」这样的分组标题和行首的「-」会原样显示。要更干净，可以删掉标题行、只留列表。",
	);
	warnings.push(
		"草稿默认不勾选「固定为弹窗公告」：它会出现在公告列表里；想让所有回访访客都看到弹窗，请手动勾选（固定公告只能有一条，会顶掉现有的那条）。",
	);
	return { title, body, warnings, stats };
}

/* ── 4. 查询参数校验（纯函数，供 GET /api/announcement-draft 使用） ───────── */

/**
 * 校验 /api/announcement-draft 的查询参数。
 * `since` 三种写法：提交 sha（7-40 位十六进制）/ `YYYY-MM-DD` / 最近天数（1-4 位数字，1-3650）。
 * @param {Record<string, string|undefined|null>} params 例如 Object.fromEntries(url.searchParams)
 * @returns {{ok: true, since: null|{kind: string, value: string|number, label: string}, limit: number}
 *          | {ok: false, error: string}}
 */
export function parseDraftQuery(params = {}) {
	const source = params && typeof params === "object" ? params : {};
	const unknown = Object.keys(source).filter(
		(key) =>
			!QUERY_KEYS.includes(key) && String(source[key] ?? "").trim() !== "",
	);
	if (unknown.length > 0) {
		return {
			ok: false,
			error: `不支持的查询参数：${unknown.join("、")}（可用：since、limit）`,
		};
	}

	let limit = DEFAULT_RECENT_LIMIT;
	const rawLimit = String(source.limit ?? "").trim();
	if (rawLimit) {
		if (!/^\d{1,3}$/.test(rawLimit)) {
			return {
				ok: false,
				error: `limit 必须是 1-${MAX_LIMIT} 之间的整数：${rawLimit}`,
			};
		}
		limit = Number(rawLimit);
		if (limit < 1 || limit > MAX_LIMIT) {
			return {
				ok: false,
				error: `limit 必须在 1-${MAX_LIMIT} 之间：${rawLimit}`,
			};
		}
	}

	const sinceRaw = String(source.since ?? "").trim();
	if (!sinceRaw) return { ok: true, since: null, limit };

	if (DATE_RE.test(sinceRaw)) {
		if (!isRealDate(sinceRaw)) {
			return { ok: false, error: `since 的日期不存在：${sinceRaw}` };
		}
		return {
			ok: true,
			since: {
				kind: "date",
				value: sinceRaw,
				label: `自 ${sinceRaw} 起（含当天）`,
			},
			limit,
		};
	}
	if (DAYS_RE.test(sinceRaw)) {
		const days = Number(sinceRaw);
		if (days < 1 || days > MAX_DAYS) {
			return {
				ok: false,
				error: `since 天数必须在 1-${MAX_DAYS} 之间：${sinceRaw}`,
			};
		}
		return {
			ok: true,
			since: { kind: "days", value: days, label: `最近 ${days} 天` },
			limit,
		};
	}
	if (SHA_RE.test(sinceRaw)) {
		return {
			ok: true,
			since: {
				kind: "sha",
				value: sinceRaw.toLowerCase(),
				label: `自提交 ${sinceRaw.slice(0, 7)} 之后（不含该提交）`,
			},
			limit,
		};
	}
	return {
		ok: false,
		error: `since 只能是「提交 sha（7-40 位十六进制）」「YYYY-MM-DD 日期」或「最近天数（1-${MAX_DAYS}）」，收到：${sinceRaw}`,
	};
}

/**
 * 给「自动判断起点」用的兜底规则描述（server.mjs 决定区间后写进 range.label）。
 * @param {{mode: string, limit: number, since?: string|null}} input
 */
export function describeRangeLabel(input) {
	const mode = String(input?.mode ?? "");
	if (mode === "announcement-commit") {
		return `自上次公告提交 ${String(input.since ?? "").slice(0, 7)} 之后（不含该提交）`;
	}
	if (mode === "announcement-date") {
		return `自上次公告发布日期 ${input.since} 起（含当天）`;
	}
	if (mode === "recent") {
		return `最近 ${input.limit} 条提交`;
	}
	return String(input?.label ?? "");
}
