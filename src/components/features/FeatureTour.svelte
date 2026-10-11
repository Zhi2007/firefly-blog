<script lang="ts">
import type {
	FeatureTourAutoplay,
	FeatureTourPage,
} from "@/types/featureTourConfig";
import {
	FEATURE_TOUR_SWIPE_THRESHOLD_PX,
	getAdjacentPageIndex,
	resolveSwipeDirection,
} from "@/utils/feature-tour-utils";

// 主页中间栏「功能导览」部件
//
// 为什么做成 Svelte island：翻页是纯客户端交互，不需要整页刷新，也不会打断
// Swup 的切页过渡（组件挂在 Swup 容器之外，见 MainGridLayout.astro）。
//
// 性能约定（与 src/config/perfConfig.ts 的「低配模式」方向一致）：
//   · 用 client:visible 挂载，滚到可视区才加载 / 水合；
//   · 没有常驻 requestAnimationFrame，没有无限循环动画；
//   · 自动轮播默认关闭；开启后也会在「页面不可见 / 用户手动翻过页 /
//     系统偏好减少动态效果」时停掉；
//   · 只用颜色与透明度过过渡，不用 backdrop-filter（低配模式会移除毛玻璃）。

interface Props {
	/** 每一页的内容，来自 src/config/feature-tour.json */
	pages?: FeatureTourPage[];
	/** 可选自动轮播；默认关闭 */
	autoplay?: FeatureTourAutoplay;
	/** 是否允许触摸左右滑动翻页，默认 true */
	swipe?: boolean;
	/** 无障碍名称 */
	label?: string;
}

let {
	pages = [],
	autoplay,
	swipe = true,
	label = "本站功能导览",
}: Props = $props();

const tourPages = $derived(pages ?? []);
const totalPages = $derived(tourPages.length);
const lastPageIndex = $derived(totalPages > 0 ? totalPages - 1 : 0);

let currentIndex = $state(0);

function goToIndex(next: number) {
	currentIndex = Math.min(Math.max(next, 0), lastPageIndex);
}

// 页数在运行时变了（例如切页后重新水合）就夹回合法范围：越界时回到第 1 页。
// 用函数改状态而不是在 $effect 里直接赋值 —— 直接在 $effect 里给捕获的变量赋值
// 会被 Biome 的 noConstAssign 误判成「给常量赋值」。
$effect(() => {
	if (currentIndex > lastPageIndex) {
		goToIndex(0);
	}
});

const currentPage = $derived(tourPages[currentIndex]);

function goAdjacent(direction: "next" | "previous") {
	goToIndex(getAdjacentPageIndex(currentIndex, totalPages, direction));
}

// ── 自动轮播（默认关闭）──────────────────────────────────────────────

const autoplayEnabled = $derived(autoplay?.enable === true && totalPages > 1);
const autoplayIntervalMs = $derived(
	Math.max(Number(autoplay?.intervalMs) || 8000, 2000),
);
let autoplayStopped = $state(false);

let autoplayTick = $state(0);

$effect(() => {
	autoplayTick;
	if (!autoplayEnabled || autoplayStopped) return;
	// 用户（或系统）不想要动效时，直接不排定时器
	if (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		return;
	}
	const timer = setTimeout(() => {
		if (document.visibilityState === "visible") autoplayTick++;
	}, autoplayIntervalMs);
	return () => clearTimeout(timer);
});

$effect(() => {
	if (autoplayTick > 0 && autoplayEnabled && !autoplayStopped)
		goAdjacent("next");
});

// 页面切到后台就停掉轮播：不在不可见时消耗 GPU / 电池
$effect(() => {
	if (!autoplayEnabled || autoplayStopped) return;
	const onVisibility = () => {
		if (document.hidden) autoplayStopped = true;
	};
	document.addEventListener("visibilitychange", onVisibility);
	return () => document.removeEventListener("visibilitychange", onVisibility);
});

// ── 键盘 ────────────────────────────────────────────────────────────

function onKeydown(event: KeyboardEvent) {
	if (totalPages <= 1) return;
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	// 别把焦点在输入框里的左右键也吃掉
	const target = event.target as HTMLElement | null;
	if (
		target &&
		(target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.isContentEditable)
	) {
		return;
	}
	event.preventDefault();
	autoplayStopped = true;
	goAdjacent(event.key === "ArrowRight" ? "next" : "previous");
}

// ── 触摸滑动 ────────────────────────────────────────────────────────

let touchStartX = 0;
let touchStartY = 0;
let touching = false;
// 本次手势是否已被判定为「翻页滑动」：判定成功的那一下要吃掉随后浏览器补发的
// click，否则横向拖过条目会顺手把用户带走（明明是想翻页）。
// 用一次性标志而不是「一直禁用」：一次手势只影响它自己补发的那一次 click，
// 下一次真正的点按仍然正常跳转 —— 避免链接出现「点不动」的死区。
let swipeSettled = false;

function onTouchStart(event: TouchEvent) {
	// 新手势开始，先清掉上一轮可能残留的抑制标志
	swipeSettled = false;
	if (!swipe || totalPages <= 1) return;
	const touch = event.touches[0];
	if (!touch) return;
	touchStartX = touch.clientX;
	touchStartY = touch.clientY;
	touching = true;
}

function onTouchEnd(event: TouchEvent) {
	if (!touching) return;
	touching = false;
	const touch = event.changedTouches[0];
	if (!touch) return;
	const direction = resolveSwipeDirection(
		touch.clientX - touchStartX,
		touch.clientY - touchStartY,
		FEATURE_TOUR_SWIPE_THRESHOLD_PX,
	);
	if (!direction) return;
	// 够格的水平滑动 = 翻页，不是点击
	swipeSettled = true;
	autoplayStopped = true;
	goAdjacent(direction);
}

// 滑动刚结束的那次 click 直接吞掉；横向拖动因此永远不会触发跳转
function onItemClick(event: MouseEvent) {
	if (!swipeSettled) return;
	swipeSettled = false;
	event.preventDefault();
}
</script>

{#if totalPages > 0 && currentPage}
  <section
    id="feature-tour"
    class="feature-tour card-base px-4 py-3 mt-1 mb-3 onload-animation focus-ring-inset"
    aria-label={label}
    data-pagefind-ignore
    tabindex="0"
    onkeydown={onKeydown}
    ontouchstart={onTouchStart}
    ontouchend={onTouchEnd}
  >
    <header class="mb-2.5 flex items-center gap-2">
      {#if currentPage.group}
        <span class="feature-tour-group shrink-0 rounded-full px-2 py-0.5 text-xs font-medium">
          {currentPage.group}
        </span>
      {/if}
      <h2 class="truncate text-base font-bold text-neutral-900 dark:text-neutral-100">
        {currentPage.title}
      </h2>
      <span class="ml-auto shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
        {currentIndex + 1} / {totalPages}
      </span>
    </header>

    <ul class="flex flex-col gap-1.5" aria-live="polite">
      {#each currentPage.items as item (item.name)}
        <li>
          {#if item.href}
            <!-- 有 href 才渲染成真链接：键盘可 Tab 聚焦、可读文本就是条目标题+简介，
                 不额外加 aria-label（否则会盖掉可读文本）。无 href 的条目走下面的普通文本分支，
                 绝不渲染成假链接（半可点的卡片比不可点更糟）。 -->
            <a
              href={item.href}
              target={item.href.startsWith("http") ? "_blank" : undefined}
              rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
              class="feature-tour-item group -mx-2 flex items-baseline gap-2.5 rounded-lg px-2 py-1.5"
              onclick={onItemClick}
            >
              <span class="feature-tour-bullet mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"></span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="feature-tour-name block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {item.name}
                </span>
                <span class="block text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {item.desc}
                </span>
              </span>
              <span class="feature-tour-arrow shrink-0 text-xs" aria-hidden="true">→</span>
            </a>
          {:else}
            <div class="flex items-baseline gap-2.5 px-2 py-1.5">
              <span class="feature-tour-bullet mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"></span>
              <div class="min-w-0">
                <span class="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {item.name}
                </span>
                <span class="block text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {item.desc}
                </span>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if totalPages > 1}
      <div class="feature-tour-nav mt-2.5 flex items-center gap-2 pt-2.5">
        <button
          type="button"
          class="feature-tour-btn btn-regular flex h-8 w-8 shrink-0 items-center justify-center rounded-lg active:scale-95"
          aria-label="上一组功能"
          title="上一组功能"
          onclick={() => {
            autoplayStopped = true;
            goAdjacent("previous");
          }}
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div class="flex flex-1 items-center justify-center gap-1.5">
          {#each tourPages as page, pageIndex (page.title)}
            <button
              type="button"
              class="feature-tour-dot h-2 rounded-full"
              class:feature-tour-dot-active={pageIndex === currentIndex}
              aria-label="第 {pageIndex + 1} 组：{page.title}"
              aria-current={pageIndex === currentIndex ? "true" : undefined}
              title={page.title}
              onclick={() => {
                autoplayStopped = true;
                goToIndex(pageIndex);
              }}
            ></button>
          {/each}
        </div>

        <button
          type="button"
          class="feature-tour-btn btn-regular flex h-8 w-8 shrink-0 items-center justify-center rounded-lg active:scale-95"
          aria-label="下一组功能"
          title="下一组功能"
          onclick={() => {
            autoplayStopped = true;
            goAdjacent("next");
          }}
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .feature-tour {
    /* 纵向手势仍然归浏览器（能正常滚动页面），只有明确够格的水平滑动才当翻页 */
    touch-action: pan-y;
  }

  .feature-tour-group {
    background-color: color-mix(in oklch, var(--primary) 12%, transparent);
    color: var(--primary);
  }

  .feature-tour-bullet {
    background-color: var(--primary);
  }

  .feature-tour-item {
    transition: background-color 150ms ease-out;
  }

  .feature-tour-item:hover {
    background-color: var(--btn-plain-bg-hover);
  }

  /* 有 href 的条目给「可点」的可见反馈：标题跟随主题色 + 出现一个指向右侧的箭头。
     箭头只为鼠标/触控板准备，默认透明且 aria-hidden，不进入无障碍树。 */
  .feature-tour-item:hover .feature-tour-name,
  .feature-tour-item:focus-visible .feature-tour-name {
    color: var(--primary);
  }

  .feature-tour-arrow {
    margin-left: auto;
    opacity: 0;
    transform: translateX(-2px);
    transition:
      opacity 150ms ease-out,
      transform 150ms ease-out;
  }

  @media (hover: hover) {
    .feature-tour-item:hover .feature-tour-arrow {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* 键盘焦点必须看得见：用主题色描边 + 偏移，不改变条目尺寸（不触发重排） */
  .feature-tour-item:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .feature-tour-item:focus-visible .feature-tour-arrow {
    opacity: 1;
    transform: translateX(0);
  }

  .feature-tour-nav {
    border-top: 1px solid var(--line-divider);
  }

  .feature-tour-btn {
    color: var(--primary);
    transition: background-color 150ms ease-out;
  }

  .feature-tour-dot {
    width: 0.5rem;
    padding: 0;
    border: none;
    cursor: pointer;
    background-color: var(--btn-regular-bg-active);
    transition:
      width 150ms ease-out,
      background-color 150ms ease-out;
  }

  .feature-tour-dot-active {
    width: 1rem;
    background-color: var(--primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .feature-tour :global(*),
    .feature-tour-dot {
      transition-duration: 0.01ms !important;
    }
  }
</style>
