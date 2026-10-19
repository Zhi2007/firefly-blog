<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";

interface Props {
	target?: string;
	placeholder?: string;
}

let {
	target = "#post-container .markdown-content",
	placeholder = "在本文中搜索…",
}: Props = $props();

// CSS Custom Highlight API：只给 Range 上色，不改文章 DOM，不会破坏 Shiki/KaTeX 等渲染。
// 旧浏览器没有该 API 时仍可计数、跳转，只是用外框标出当前匹配所在元素。
type HighlightConstructor = new (...ranges: Range[]) => unknown;
type HighlightRegistryLike = {
	set(name: string, value: unknown): void;
	delete(name: string): void;
};
const highlightRegistry =
	typeof CSS !== "undefined"
		? (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights
		: undefined;
const HighlightConstructor = (
	globalThis as unknown as { Highlight?: HighlightConstructor }
).Highlight;
const canHighlight = Boolean(highlightRegistry && HighlightConstructor);

let query = $state("");
let count = $state(0);
let activeIndex = $state(0);
let available = $state(true);
let inputEl: HTMLInputElement | undefined;
let targetEl: HTMLElement | null = null;
let ranges: Range[] = [];
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let navigated = $state(false);
let fallbackElement: HTMLElement | null = null;

function countLabel(): string {
	if (!query.trim()) return "";
	if (count === 0) return "无匹配";
	if (!navigated) return `共 ${count} 处`;
	return `${activeIndex + 1} / ${count}`;
}

function clearHighlight(): void {
	if (highlightRegistry) {
		highlightRegistry.delete("post-search-hit");
		highlightRegistry.delete("post-search-active");
	}
	if (fallbackElement) {
		fallbackElement.classList.remove("post-search-fallback-active");
		fallbackElement = null;
	}
}

function collectRanges(root: HTMLElement, needle: string): Range[] {
	const result: Range[] = [];
	const needleLower = needle.toLocaleLowerCase();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node): number {
			const text = node.nodeValue;
			if (!text?.trim()) return NodeFilter.FILTER_REJECT;
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			// 跳过脚本、样式、KaTeX 的隐藏 MathML、标题锚点、代码复制按钮等非正文文本
			if (
				parent.closest(
					"script, style, noscript, button, .katex-mathml, .header-anchor, [aria-hidden='true'], [hidden], details:not([open])",
				)
			) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	let node = walker.nextNode();
	while (node) {
		const text = node.nodeValue ?? "";
		const lower = text.toLocaleLowerCase();
		let index = lower.indexOf(needleLower);
		while (index !== -1) {
			const range = document.createRange();
			range.setStart(node, index);
			range.setEnd(node, index + needle.length);
			result.push(range);
			// 空查询不会走到这里；这里避免 needle 长度导致死循环
			index = lower.indexOf(needleLower, index + Math.max(1, needle.length));
		}
		node = walker.nextNode();
	}
	return result;
}

function applyHighlight(): void {
	if (!canHighlight || !highlightRegistry || !HighlightConstructor) {
		clearHighlight();
		const element = ranges[activeIndex]?.startContainer.parentElement;
		if (element) {
			element.classList.add("post-search-fallback-active");
			fallbackElement = element;
		}
		return;
	}
	highlightRegistry.delete("post-search-hit");
	highlightRegistry.delete("post-search-active");
	if (!ranges.length) return;
	highlightRegistry.set("post-search-hit", new HighlightConstructor(...ranges));
	const activeRange = ranges[activeIndex];
	if (activeRange) {
		highlightRegistry.set(
			"post-search-active",
			new HighlightConstructor(activeRange),
		);
	}
}

function scrollToActive(): void {
	const range = ranges[activeIndex];
	if (!range) return;
	const rect = range.getBoundingClientRect();
	const offset = Math.min(180, window.innerHeight * 0.25);
	const top = Math.max(0, window.scrollY + rect.top - offset);
	window.scrollTo({ top, behavior: "smooth" });
}

function runSearch(): void {
	const needle = query.trim();
	clearHighlight();
	ranges = [];
	count = 0;
	activeIndex = 0;
	navigated = false;
	if (!needle || !targetEl) return;
	ranges = collectRanges(targetEl, needle);
	count = ranges.length;
	applyHighlight();
}

function scheduleSearch(): void {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(runSearch, 120);
}

function nextMatch(): void {
	if (!ranges.length) return;
	if (!navigated) {
		navigated = true;
		applyHighlight();
		scrollToActive();
		inputEl?.focus({ preventScroll: true });
		return;
	}
	activeIndex = (activeIndex + 1) % ranges.length;
	applyHighlight();
	scrollToActive();
	// 焦点留在输入框：跳转后仍可直接按 Enter / Shift+Enter 继续找
	inputEl?.focus({ preventScroll: true });
}

function previousMatch(): void {
	if (!ranges.length) return;
	navigated = true;
	activeIndex = (activeIndex - 1 + ranges.length) % ranges.length;
	applyHighlight();
	scrollToActive();
	inputEl?.focus({ preventScroll: true });
}

function clearSearch(): void {
	query = "";
	count = 0;
	activeIndex = 0;
	navigated = false;
	clearHighlight();
	if (searchTimer) clearTimeout(searchTimer);
	inputEl?.focus();
}

function onInput(event: Event): void {
	query = (event.currentTarget as HTMLInputElement).value;
	scheduleSearch();
}

function onKeydown(event: KeyboardEvent): void {
	if (event.isComposing) return;
	if (event.key === "Enter") {
		event.preventDefault();
		if (event.shiftKey) previousMatch();
		else nextMatch();
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		clearSearch();
	}
}

onMount(() => {
	targetEl = document.querySelector<HTMLElement>(target);
	if (!targetEl) {
		available = false;
		return;
	}
	return () => {
		if (searchTimer) clearTimeout(searchTimer);
		clearHighlight();
	};
});
</script>

{#if available}
	<div
		class="post-search"
		class:has-query={query.trim().length > 0}
		data-pagefind-ignore
	>
		<div class="post-search-row">
			<Icon icon="material-symbols:search" class="post-search-icon" />
			<input
				bind:this={inputEl}
				class="post-search-input"
				type="text"
				value={query}
				{placeholder}
				autocomplete="off"
				spellcheck={false}
				aria-label="在本文中搜索"
				oninput={onInput}
				onkeydown={onKeydown}
			/>
			<span class="post-search-count" aria-live="polite">{countLabel()}</span>
			<button
				type="button"
				class="post-search-btn"
				title="上一个匹配（Shift+Enter）"
				aria-label="上一个匹配"
				disabled={count === 0}
				onclick={previousMatch}
			>
				↑
			</button>
			<button
				type="button"
				class="post-search-btn"
				title="下一个匹配（Enter）"
				aria-label="下一个匹配"
				disabled={count === 0}
				onclick={nextMatch}
			>
				↓
			</button>
			<button
				type="button"
				class="post-search-btn post-search-clear"
				title="清除搜索（Esc）"
				aria-label="清除搜索"
				disabled={!query}
				onclick={clearSearch}
			>
				✕
			</button>
		</div>
		{#if query.trim() && count > 0}
			<p class="post-search-hint">
				{navigated
					? "Enter 下一个 · Shift+Enter 上一个 · Esc 清除"
					: "Enter 跳到第一个 · Shift+Enter 跳到最后一个 · Esc 清除"}
			</p>
		{:else if query.trim() && count === 0}
			<p class="post-search-hint">没有找到匹配内容，试试更短的关键字。</p>
		{:else}
			<p class="post-search-hint">输入关键字，Enter 跳到第一个匹配。</p>
		{/if}
	</div>
{/if}

<style>
	.post-search {
		margin: 0 0 1.35rem;
		padding: 0.4rem 0.65rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			background-color 0.15s ease;
	}

	.post-search:focus-within,
	.post-search.has-query {
		border-color: color-mix(in srgb, var(--primary) 55%, var(--line-divider));
		background: color-mix(in srgb, var(--btn-regular-bg) 70%, var(--card-bg));
	}

	.post-search:focus-within {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent);
	}

	.post-search-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.post-search-icon {
		flex: none;
		color: var(--primary);
		font-size: 1.05rem;
	}

	.post-search-input {
		flex: 1;
		min-width: 0;
		padding: 0.28rem 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}

	.post-search-input::placeholder {
		color: color-mix(in srgb, currentColor 42%, transparent);
	}

	.post-search-count {
		flex: none;
		min-width: 2.5rem;
		text-align: right;
		font-size: 0.72rem;
		opacity: 0.62;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.post-search-btn {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.65rem;
		height: 1.65rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 0.45rem;
		background: transparent;
		color: inherit;
		font-size: 0.85rem;
		line-height: 1;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			opacity 0.15s ease;
	}

	.post-search-btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.post-search-btn:disabled {
		opacity: 0.32;
		cursor: default;
	}

	.post-search-clear {
		font-size: 0.72rem;
	}

	.post-search-hint {
		margin: 0.2rem 0 0 1.55rem;
		font-size: 0.68rem;
		line-height: 1.5;
		opacity: 0.55;
	}
</style>
