<template>
  <div class="reports-page">
    <section class="reports-head">
      <div>
        <p class="reports-kicker">Industry Research Library</p>
        <h1>行业报告库</h1>
        <p class="reports-subtitle">沉淀产业地图、行业深度和主题链条研究，按报告生成时间归档。</p>
      </div>
      <div class="reports-count">
        <strong>{{ reports.length }}</strong>
        <span>篇报告</span>
      </div>
    </section>

    <section v-if="pending" class="reports-state">加载中...</section>
    <section v-else-if="!reports.length" class="reports-state">暂无行业报告</section>
    <section v-else class="report-list">
      <NuxtLink
        v-for="report in reports"
        :key="report.slug"
        class="report-row"
        :to="`/industry-reports/${report.slug}`"
      >
        <div class="report-date">{{ report.date || '未标日期' }}</div>
        <div class="report-main">
          <div class="report-title-line">
            <h2>{{ report.title }}</h2>
            <span class="report-industry">{{ report.industry }}</span>
          </div>
          <p>{{ report.summary }}</p>
          <div class="report-meta">
            <span v-for="tag in report.tags" :key="tag">{{ tag }}</span>
            <span>{{ report.wordCount.toLocaleString('zh-CN') }} 字</span>
          </div>
        </div>
        <div class="report-arrow">›</div>
      </NuxtLink>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '~/stores/ui'

interface IndustryReportMeta {
  slug: string
  title: string
  industry: string
  date: string
  summary: string
  tags: string[]
  wordCount: number
}

const uiStore = useUiStore()
uiStore.setActiveNav('industry-reports')

const { data, pending } = await useFetch<{ success: boolean; reports: IndustryReportMeta[] }>('/api/reports/industry')
const reports = computed(() => data.value?.reports || [])
</script>

<style scoped>
.reports-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 60px;
}

.reports-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-end;
  padding: 6px 0 14px;
  border-bottom: 1px solid var(--border-color);
}

.reports-kicker {
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.reports-head h1 {
  font-size: 28px;
  line-height: 1.15;
  margin: 0;
}

.reports-subtitle {
  color: var(--text-secondary);
  margin-top: 8px;
  max-width: 620px;
}

.reports-count {
  min-width: 108px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  text-align: right;
}

.reports-count strong {
  display: block;
  color: var(--text-primary);
  font-size: 28px;
  line-height: 1;
}

.reports-count span {
  color: var(--text-secondary);
  font-size: 12px;
}

.reports-state {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 28px;
  color: var(--text-secondary);
  text-align: center;
}

.report-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.report-row {
  display: grid;
  grid-template-columns: 112px 1fr 24px;
  gap: 18px;
  align-items: center;
  color: inherit;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  transition: border-color var(--transition), background var(--transition), transform var(--transition);
}

.report-row:hover {
  color: inherit;
  border-color: var(--border-light);
  background: var(--bg-card-hover);
  transform: translateY(-1px);
}

.report-date {
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.report-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.report-main h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 17px;
  line-height: 1.35;
}

.report-industry {
  color: var(--color-down);
  background: rgba(45, 139, 111, 0.10);
  border: 1px solid rgba(45, 139, 111, 0.22);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}

.report-main p {
  color: var(--text-secondary);
  margin: 8px 0 0;
  line-height: 1.65;
}

.report-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.report-meta span {
  color: var(--text-muted);
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}

.report-arrow {
  color: var(--text-muted);
  font-size: 28px;
  line-height: 1;
}

@media (max-width: 768px) {
  .reports-head {
    align-items: flex-start;
  }

  .reports-head h1 {
    font-size: 24px;
  }

  .reports-count {
    display: none;
  }

  .report-row {
    grid-template-columns: 1fr 18px;
    gap: 10px;
  }

  .report-date {
    grid-column: 1 / -1;
  }
}
</style>
