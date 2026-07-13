<template>
  <div class="daily-detail-page">
    <NuxtLink class="back-link" to="/daily-analysis">← 返回每日分析</NuxtLink>

    <section v-if="pending" class="daily-shell state">加载中...</section>
    <section v-else-if="!report" class="daily-shell state">分析不存在</section>
    <article v-else class="daily-shell">
      <header class="daily-header">
        <div class="daily-meta-top">
          <span>基准日 {{ report.date || '未标日期' }}</span>
          <span v-if="report.generatedAt">生成 {{ report.generatedAt }}</span>
          <span>{{ report.wordCount.toLocaleString('zh-CN') }} 字</span>
        </div>
        <h1>{{ report.title }}</h1>
        <p>{{ report.summary }}</p>
        <div class="daily-tags">
          <span v-for="tag in report.tags" :key="tag">{{ tag }}</span>
        </div>
      </header>

      <div class="daily-content" v-html="report.html"></div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '~/stores/ui'

interface DailyAnalysisDetail {
  slug: string
  title: string
  date: string
  generatedAt: string
  summary: string
  tags: string[]
  wordCount: number
  html: string
}

const route = useRoute()
const uiStore = useUiStore()
uiStore.setActiveNav('daily-analysis')

const { data, pending } = await useFetch<{ success: boolean; report?: DailyAnalysisDetail }>(
  `/api/reports/daily/${route.params.slug}`,
)
const report = computed(() => data.value?.report || null)
</script>

<style scoped>
.daily-detail-page {
  max-width: 980px;
  margin: 0 auto;
  padding-bottom: 80px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  color: var(--text-secondary);
  margin-bottom: 14px;
  font-size: 13px;
}

.back-link:hover {
  color: var(--color-accent);
}

.daily-shell {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.daily-shell.state {
  padding: 36px;
  text-align: center;
  color: var(--text-secondary);
}

.daily-header {
  padding: 30px 34px 24px;
  border-bottom: 1px solid var(--border-color);
  background:
    linear-gradient(135deg, rgba(251, 191, 36, 0.14), transparent 46%),
    var(--bg-card);
}

.daily-meta-top {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-warning);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 12px;
}

.daily-meta-top span {
  border: 1px solid rgba(184, 135, 45, 0.20);
  background: rgba(184, 135, 45, 0.08);
  border-radius: 999px;
  padding: 3px 9px;
}

.daily-header h1 {
  color: var(--text-primary);
  font-size: 30px;
  line-height: 1.24;
  margin: 0;
}

.daily-header p {
  color: var(--text-secondary);
  max-width: 760px;
  margin: 12px 0 0;
  line-height: 1.75;
}

.daily-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.daily-tags span {
  color: var(--color-warning);
  background: rgba(184, 135, 45, 0.10);
  border: 1px solid rgba(184, 135, 45, 0.20);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
}

.daily-content {
  padding: 28px 34px 38px;
  color: var(--text-primary);
  line-height: 1.82;
  font-size: 15px;
}

.daily-content :deep(h1),
.daily-content :deep(h2),
.daily-content :deep(h3),
.daily-content :deep(h4) {
  color: var(--text-primary);
  line-height: 1.35;
  scroll-margin-top: 72px;
}

.daily-content :deep(h1) {
  display: none;
}

.daily-content :deep(h2) {
  font-size: 22px;
  margin: 34px 0 14px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color);
}

.daily-content :deep(h3) {
  font-size: 18px;
  margin: 26px 0 12px;
}

.daily-content :deep(h4) {
  font-size: 16px;
  margin: 22px 0 10px;
}

.daily-content :deep(p) {
  margin: 12px 0;
}

.daily-content :deep(blockquote) {
  margin: 16px 0;
  padding: 12px 14px;
  border-left: 3px solid var(--color-warning);
  background: rgba(184, 135, 45, 0.08);
  color: var(--text-secondary);
}

.daily-content :deep(ul),
.daily-content :deep(ol) {
  margin: 12px 0 12px 22px;
}

.daily-content :deep(li) {
  margin: 6px 0;
}

.daily-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 18px 0;
  display: block;
  overflow-x: auto;
}

.daily-content :deep(th),
.daily-content :deep(td) {
  border: 1px solid var(--border-color);
  padding: 9px 10px;
  vertical-align: top;
  min-width: 90px;
}

.daily-content :deep(th) {
  color: var(--text-primary);
  background: var(--bg-input);
  font-weight: 700;
}

.daily-content :deep(td) {
  color: var(--text-secondary);
}

.daily-content :deep(code) {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.daily-content :deep(pre) {
  overflow-x: auto;
  background: #2B241C;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin: 16px 0;
}

.daily-content :deep(pre code) {
  border: 0;
  padding: 0;
  background: transparent;
}

.daily-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border-color);
  margin: 28px 0;
}

@media (max-width: 768px) {
  .daily-detail-page {
    max-width: none;
  }

  .daily-header,
  .daily-content {
    padding-left: 18px;
    padding-right: 18px;
  }

  .daily-header h1 {
    font-size: 24px;
  }
}
</style>
