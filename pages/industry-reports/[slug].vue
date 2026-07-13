<template>
  <div class="report-detail-page">
    <NuxtLink class="back-link" to="/industry-reports">← 返回行业报告库</NuxtLink>

    <section v-if="pending" class="report-shell state">加载中...</section>
    <section v-else-if="!report" class="report-shell state">报告不存在</section>
    <article v-else class="report-shell">
      <header class="report-header">
        <div class="report-meta-top">
          <span>{{ report.date || '未标日期' }}</span>
          <span>{{ report.industry }}</span>
          <span>{{ report.wordCount.toLocaleString('zh-CN') }} 字</span>
        </div>
        <h1>{{ report.title }}</h1>
        <p>{{ report.summary }}</p>
        <div class="report-tags">
          <span v-for="tag in report.tags" :key="tag">{{ tag }}</span>
        </div>
      </header>

      <div class="report-content" v-html="report.html"></div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '~/stores/ui'

interface IndustryReportDetail {
  slug: string
  title: string
  industry: string
  date: string
  summary: string
  tags: string[]
  wordCount: number
  html: string
}

const route = useRoute()
const uiStore = useUiStore()
uiStore.setActiveNav('industry-reports')

const { data, pending } = await useFetch<{ success: boolean; report?: IndustryReportDetail }>(
  `/api/reports/industry/${route.params.slug}`,
)
const report = computed(() => data.value?.report || null)
</script>

<style scoped>
.report-detail-page {
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

.report-shell {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.report-shell.state {
  padding: 36px;
  text-align: center;
  color: var(--text-secondary);
}

.report-header {
  padding: 30px 34px 24px;
  border-bottom: 1px solid var(--border-color);
  background:
    linear-gradient(135deg, rgba(184, 135, 45, 0.13), transparent 46%),
    var(--bg-card);
}

.report-meta-top {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 12px;
}

.report-meta-top span {
  border: 1px solid rgba(69, 107, 143, 0.20);
  background: rgba(69, 107, 143, 0.08);
  border-radius: 999px;
  padding: 3px 9px;
}

.report-header h1 {
  color: var(--text-primary);
  font-size: 30px;
  line-height: 1.24;
  margin: 0;
}

.report-header p {
  color: var(--text-secondary);
  max-width: 760px;
  margin: 12px 0 0;
  line-height: 1.75;
}

.report-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.report-tags span {
  color: var(--color-down);
  background: rgba(45, 139, 111, 0.10);
  border: 1px solid rgba(45, 139, 111, 0.20);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
}

.report-content {
  padding: 28px 34px 38px;
  color: var(--text-primary);
  line-height: 1.82;
  font-size: 15px;
}

.report-content :deep(h1),
.report-content :deep(h2),
.report-content :deep(h3),
.report-content :deep(h4) {
  color: var(--text-primary);
  line-height: 1.35;
  scroll-margin-top: 72px;
}

.report-content :deep(h1) {
  display: none;
}

.report-content :deep(h2) {
  font-size: 22px;
  margin: 34px 0 14px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color);
}

.report-content :deep(h3) {
  font-size: 18px;
  margin: 26px 0 12px;
}

.report-content :deep(h4) {
  font-size: 16px;
  margin: 22px 0 10px;
}

.report-content :deep(p) {
  margin: 12px 0;
}

.report-content :deep(blockquote) {
  margin: 16px 0;
  padding: 12px 14px;
  border-left: 3px solid var(--color-accent);
  background: rgba(69, 107, 143, 0.08);
  color: var(--text-secondary);
}

.report-content :deep(ul),
.report-content :deep(ol) {
  margin: 12px 0 12px 22px;
}

.report-content :deep(li) {
  margin: 6px 0;
}

.report-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 18px 0;
  display: block;
  overflow-x: auto;
}

.report-content :deep(th),
.report-content :deep(td) {
  border: 1px solid var(--border-color);
  padding: 9px 10px;
  vertical-align: top;
  min-width: 90px;
}

.report-content :deep(th) {
  color: var(--text-primary);
  background: var(--bg-input);
  font-weight: 700;
}

.report-content :deep(td) {
  color: var(--text-secondary);
}

.report-content :deep(code) {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.report-content :deep(pre) {
  overflow-x: auto;
  background: #2B241C;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin: 16px 0;
}

.report-content :deep(pre code) {
  border: 0;
  padding: 0;
  background: transparent;
}

.report-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border-color);
  margin: 28px 0;
}

@media (max-width: 768px) {
  .report-detail-page {
    max-width: none;
  }

  .report-header,
  .report-content {
    padding-left: 18px;
    padding-right: 18px;
  }

  .report-header h1 {
    font-size: 24px;
  }
}
</style>
