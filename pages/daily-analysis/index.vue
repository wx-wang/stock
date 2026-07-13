<template>
  <div class="daily-page">
    <section class="daily-head">
      <div>
        <p class="daily-kicker">Daily Market Notes</p>
        <h1>每日分析</h1>
        <p class="daily-subtitle">归档每日趋势、舆情和市场结构观察，保留每个交易日的判断快照。</p>
      </div>
      <div class="daily-count">
        <strong>{{ reports.length }}</strong>
        <span>篇分析</span>
      </div>
    </section>

    <section v-if="pending" class="daily-state">加载中...</section>
    <section v-else-if="!reports.length" class="daily-state">暂无每日分析</section>
    <section v-else class="daily-list">
      <NuxtLink
        v-for="report in reports"
        :key="report.slug"
        class="daily-row"
        :to="`/daily-analysis/${report.slug}`"
      >
        <div class="date-block">
          <span>基准日</span>
          <strong>{{ report.date || '未标日期' }}</strong>
        </div>
        <div class="daily-main">
          <div class="daily-title-line">
            <h2>{{ report.title }}</h2>
            <span v-if="report.generatedAt" class="generated">生成 {{ report.generatedAt }}</span>
          </div>
          <p>{{ report.summary }}</p>
          <div class="daily-meta">
            <span v-for="tag in report.tags" :key="tag">{{ tag }}</span>
            <span>{{ report.wordCount.toLocaleString('zh-CN') }} 字</span>
          </div>
        </div>
        <div class="daily-arrow">›</div>
      </NuxtLink>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '~/stores/ui'

interface DailyAnalysisMeta {
  slug: string
  title: string
  date: string
  generatedAt: string
  summary: string
  tags: string[]
  wordCount: number
}

const uiStore = useUiStore()
uiStore.setActiveNav('daily-analysis')

const { data, pending } = await useFetch<{ success: boolean; reports: DailyAnalysisMeta[] }>('/api/reports/daily')
const reports = computed(() => data.value?.reports || [])
</script>

<style scoped>
.daily-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 60px;
}

.daily-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-end;
  padding: 6px 0 14px;
  border-bottom: 1px solid var(--border-color);
}

.daily-kicker {
  color: #fbbf24;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.daily-head h1 {
  font-size: 28px;
  line-height: 1.15;
  margin: 0;
}

.daily-subtitle {
  color: var(--text-secondary);
  margin-top: 8px;
  max-width: 620px;
}

.daily-count {
  min-width: 108px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  text-align: right;
}

.daily-count strong {
  display: block;
  color: var(--text-primary);
  font-size: 28px;
  line-height: 1;
}

.daily-count span {
  color: var(--text-secondary);
  font-size: 12px;
}

.daily-state {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 28px;
  color: var(--text-secondary);
  text-align: center;
}

.daily-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.daily-row {
  display: grid;
  grid-template-columns: 128px 1fr 24px;
  gap: 18px;
  align-items: center;
  color: inherit;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  transition: border-color var(--transition), background var(--transition), transform var(--transition);
}

.daily-row:hover {
  color: inherit;
  border-color: rgba(251, 191, 36, 0.45);
  background: var(--bg-card-hover);
  transform: translateY(-1px);
}

.date-block {
  border-left: 3px solid #fbbf24;
  padding-left: 10px;
}

.date-block span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  margin-bottom: 4px;
}

.date-block strong {
  color: #fbbf24;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.daily-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.daily-main h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 17px;
  line-height: 1.35;
}

.generated {
  color: #fde68a;
  background: rgba(251, 191, 36, 0.10);
  border: 1px solid rgba(251, 191, 36, 0.22);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}

.daily-main p {
  color: var(--text-secondary);
  margin: 8px 0 0;
  line-height: 1.65;
}

.daily-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.daily-meta span {
  color: var(--text-muted);
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}

.daily-arrow {
  color: var(--text-muted);
  font-size: 28px;
  line-height: 1;
}

@media (max-width: 768px) {
  .daily-head {
    align-items: flex-start;
  }

  .daily-head h1 {
    font-size: 24px;
  }

  .daily-count {
    display: none;
  }

  .daily-row {
    grid-template-columns: 1fr 18px;
    gap: 10px;
  }

  .date-block {
    grid-column: 1 / -1;
  }
}
</style>
