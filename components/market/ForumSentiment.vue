<template>
  <div class="forum-section">
    <h2 class="section-title">📡 论坛舆情雷达</h2>
    <p class="section-sub">
      多源缓存追踪国内外投资讨论热点
      <span v-if="data?.generated_at" class="updated">更新 {{ formatTime(data.generated_at) }}</span>
    </p>

    <div v-if="!data || !data.success" class="empty">
      {{ data?.message || '暂无舆情数据，请先在服务器运行 python3 scripts/forum_crawler.py' }}
    </div>

    <template v-else>
      <!-- ── 概览条 ── -->
      <div class="overview-bar">
        <div class="ov-item">
          <span class="ov-val">{{ data.summary?.total_topics || 0 }}</span>
          <span class="ov-label">话题总量</span>
        </div>
        <div class="ov-item">
          <span class="ov-val">{{ data.summary?.domestic_forums || 0 }}</span>
          <span class="ov-label">国内论坛</span>
        </div>
        <div class="ov-item">
          <span class="ov-val">{{ data.summary?.international_forums || 0 }}</span>
          <span class="ov-label">国际论坛</span>
        </div>
        <div class="ov-item sentiment" :class="sentimentClass">
          <span class="ov-val">{{ data.summary?.dominant_sentiment || '--' }}</span>
          <span class="ov-label">市场情绪</span>
        </div>
      </div>

      <!-- ── 来源标签 ── -->
      <div class="source-tags">
        <span v-for="s in data.summary?.forums_crawled" :key="s" class="src-tag" :class="srcClass(s)">{{ srcLabel(s) }}</span>
        <span v-for="s in failedSources" :key="s.source" class="src-tag failed" :title="s.message">{{ s.label }}未取到</span>
      </div>

      <!-- ── 热门股票 ── -->
      <div class="stocks-panel" v-if="data.hot_stocks?.length">
        <div class="panel-head">
          <h3 class="panel-title">⭐ 热门股票</h3>
          <span class="panel-note">按来源权重、热度、提及次数合成</span>
        </div>
        <div class="stock-list">
          <div v-for="(s, i) in data.hot_stocks.slice(0, 12)" :key="`${s.market}-${s.symbol}`" class="stock-row">
            <span class="stock-rank" :class="{ top3: i < 3 }">{{ i + 1 }}</span>
            <div class="stock-main">
              <div class="stock-name-line">
                <span class="stock-name">{{ s.name }}</span>
                <span class="stock-code">{{ s.symbol }}</span>
                <span class="stock-market">{{ s.market }}</span>
              </div>
              <div class="stock-reason">{{ (s.topics || [])[0] || sourceNames(s.sources) }}</div>
            </div>
            <div class="stock-side">
              <span class="stock-heat">{{ Math.round(s.heat || 0) }}</span>
              <span class="stock-sent" :class="{ pos: s.sentiment === '偏多', neg: s.sentiment === '偏空' }">{{ s.sentiment || '中性' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── 情绪分解 ── -->
      <div class="sentiment-bar" v-if="data.summary?.sentiment_breakdown">
        <div class="sbar-seg sbar-pos" :style="{ flex: data.summary.sentiment_breakdown.positive || 0 }" :title="'乐观: ' + data.summary.sentiment_breakdown.positive">
          🟢 {{ data.summary.sentiment_breakdown.positive }}
        </div>
        <div class="sbar-seg sbar-neu" :style="{ flex: data.summary.sentiment_breakdown.neutral || 0 }" :title="'中性: ' + data.summary.sentiment_breakdown.neutral">
          🟡 {{ data.summary.sentiment_breakdown.neutral }}
        </div>
        <div class="sbar-seg sbar-neg" :style="{ flex: data.summary.sentiment_breakdown.negative || 0 }" :title="'悲观: ' + data.summary.sentiment_breakdown.negative">
          🔴 {{ data.summary.sentiment_breakdown.negative }}
        </div>
      </div>

      <div class="forum-grid">
        <!-- ── 概念热度 ── -->
        <div class="forum-panel">
          <h3 class="panel-title">🔥 概念讨论热度</h3>
          <div v-if="!data.concept_heat?.length" class="empty-sm">暂无数据</div>
          <div v-for="(c, i) in (data.concept_heat || []).slice(0, 10)" :key="c.concept" class="heat-row">
            <span class="heat-rank" :class="{ 'top3': i < 3 }">{{ i + 1 }}</span>
            <span class="heat-name">{{ c.concept }}</span>
            <span class="heat-bar-wrap">
              <span class="heat-bar" :style="{ width: heatPct(c.count) + '%' }"></span>
            </span>
            <span class="heat-count">{{ c.count }}</span>
          </div>
        </div>

        <!-- ── 热词 ── -->
        <div class="forum-panel">
          <h3 class="panel-title">🏷️ 高频热词</h3>
          <div v-if="!data.hot_keywords?.length" class="empty-sm">暂无数据</div>
          <div class="tag-cloud">
            <span v-for="kw in (data.hot_keywords || []).slice(0, 15)" :key="kw.word"
              class="kw-tag" :style="{ fontSize: kwSize(kw.count) + 'px', opacity: kwOpacity(kw.count) }">
              {{ kw.word }}
            </span>
          </div>
        </div>
      </div>

      <!-- ── 热门话题列表 ── -->
      <div class="topics-panel" v-if="data.top_topics?.length">
        <h3 class="panel-title">📰 热门话题</h3>
        <div class="topic-list">
          <div v-for="(t, i) in data.top_topics.slice(0, 12)" :key="i" class="topic-row">
            <div class="topic-main">
              <span class="topic-src" :class="srcClass(t.source)">{{ srcLabel(t.source) }}</span>
              <span class="topic-title">{{ t.title }}</span>
              <span v-if="t.concepts?.length" class="topic-concepts">
                <span v-for="c in t.concepts" :key="c" class="tc-chip">{{ c }}</span>
              </span>
            </div>
            <span class="topic-sent" :class="t.sentiment">
              {{ sentLabel(t.sentiment) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ data: any }>()

const failedSources = computed(() => {
  const status = props.data?.source_status || {}
  return Object.entries(status)
    .filter(([, v]: any) => !v?.ok)
    .map(([source, v]: any) => ({ source, label: v?.label || srcLabel(source), message: v?.message || '' }))
    .slice(0, 4)
})

const sentimentClass = computed(() => {
  const s = props.data?.summary?.dominant_sentiment
  if (!s) return ''
  if (s.includes('乐观') || s.includes('积极')) return 'pos'
  if (s.includes('悲观') || s.includes('消极')) return 'neg'
  return 'neu'
})

function sentLabel(s: string): string {
  const map: Record<string, string> = {
    positive: '📈 看多', negative: '📉 看空',
    slightly_positive: '↗️ 偏多', slightly_negative: '↘️ 偏空',
    neutral: '➖ 中性',
  }
  return map[s] || s
}

const maxHeat = computed(() => {
  const arr = props.data?.concept_heat || []
  return Math.max(1, ...arr.map((c: any) => c.count))
})
function heatPct(count: number): number {
  return Math.round((count / maxHeat.value) * 100)
}

const maxKwCount = computed(() => {
  const arr = props.data?.hot_keywords || []
  return Math.max(1, ...arr.map((k: any) => k.count))
})
function kwSize(count: number): number {
  return 11 + Math.round((count / maxKwCount.value) * 8)
}
function kwOpacity(count: number): number {
  return 0.5 + Math.round((count / maxKwCount.value) * 0.5 * 10) / 10
}

function srcClass(src: string): string {
  if (['cnbc', 'marketwatch', 'reddit_wsb', 'reddit_stocks', 'stocktwits'].includes(src)) return 'intl'
  if (['jin10'].includes(src)) return 'intl-cn'
  if (['cls', 'eastmoney_flow', 'eastmoney_sector', 'eastmoney_concept', 'tushare_dc_hot'].includes(src)) return 'cn'
  return 'cn'
}

function srcLabel(src: string): string {
  const map: Record<string, string> = {
    eastmoney: '东方财富', xueqiu: '雪球', xueqiu_discussion: '雪球讨论',
    eastmoney_flow: '东财资金流', eastmoney_sector: '东财行业', eastmoney_concept: '东财概念',
    tushare_dc_hot: '东财热榜',
    taoguba: '淘股吧', cnbc: 'CNBC', jin10: '金十数据',
    reddit_wsb: 'Reddit WSB', reddit_stocks: 'Reddit Stocks', stocktwits: 'Stocktwits',
    marketwatch: 'MarketWatch',
    cls: '财联社',
  }
  return map[src] || src
}

function sourceNames(sources: string[] = []): string {
  return sources.map(srcLabel).join(' / ')
}

function formatTime(v: string): string {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.forum-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
.section-sub { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
.updated { color: var(--text-muted); margin-left: 8px; }
.empty { font-size: 12px; color: var(--text-secondary); padding: 20px 0; text-align: center; }
.empty-sm { font-size: 12px; color: #6b7280; padding: 12px 0; text-align: center; }

/* ── 概览条 ── */
.overview-bar { display: flex; gap: 12px; margin-bottom: 12px; }
.ov-item { flex: 1; background: var(--bg-card); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px; text-align: center; }
.ov-val { display: block; font-size: 20px; font-weight: 700; color: var(--text-primary); }
.ov-label { font-size: 11px; color: #6b7280; }
.ov-item.pos .ov-val { color: #4CAF50; }
.ov-item.neg .ov-val { color: #F44336; }
.ov-item.neu .ov-val { color: #FFC107; }

/* ── 来源标签 ── */
.source-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.src-tag { font-size: 10px; padding: 3px 8px; border-radius: 10px; font-weight: 600; }
.src-tag.cn { background: rgba(239,68,68,0.12); color: #f87171; }
.src-tag.intl { background: rgba(59,130,246,0.12); color: #60a5fa; }
.src-tag.intl-cn { background: rgba(168,85,247,0.12); color: #c084fc; }
.src-tag.failed { background: rgba(107,114,128,0.12); color: #9ca3af; }

/* ── 热门股票 ── */
.stocks-panel { background: var(--bg-card); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px; margin-bottom: 16px; }
.panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 10px; }
.panel-head .panel-title { margin-bottom: 0; }
.panel-note { font-size: 11px; color: var(--text-muted); }
.stock-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.stock-row { display: grid; grid-template-columns: 24px 1fr auto; gap: 8px; align-items: center; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 8px; min-width: 0; }
.stock-rank { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 5px; font-size: 11px; font-weight: 700; color: #6b7280; background: rgba(255,255,255,0.04); }
.stock-rank.top3 { background: rgba(251,191,36,0.15); color: #fbbf24; }
.stock-main { min-width: 0; }
.stock-name-line { display: flex; align-items: center; gap: 5px; min-width: 0; }
.stock-name { color: var(--text-primary); font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stock-code, .stock-market { color: var(--text-muted); font-size: 10px; flex-shrink: 0; }
.stock-reason { color: var(--text-secondary); font-size: 11px; line-height: 1.4; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stock-side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.stock-heat { color: #fbbf24; font-size: 15px; font-weight: 800; line-height: 1; }
.stock-sent { color: #9ca3af; font-size: 10px; }
.stock-sent.pos { color: #4CAF50; }
.stock-sent.neg { color: #F44336; }

/* ── 情绪条 ── */
.sentiment-bar { display: flex; height: 24px; border-radius: 6px; overflow: hidden; margin-bottom: 16px; }
.sbar-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.3); min-width: 40px; }
.sbar-pos { background: linear-gradient(135deg, #22c55e, #16a34a); }
.sbar-neu { background: linear-gradient(135deg, #eab308, #ca8a04); }
.sbar-neg { background: linear-gradient(135deg, #ef4444, #dc2626); }

/* ── 双栏 ── */
.forum-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.forum-panel { background: var(--bg-card); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px; }
.panel-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px; }

/* ── 概念热度 ── */
.heat-row { display: flex; align-items: center; padding: 3px 0; gap: 8px; }
.heat-rank { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 10px; font-weight: 700; color: #6b7280; background: rgba(255,255,255,0.04); flex-shrink: 0; }
.heat-rank.top3 { background: rgba(251,191,36,0.15); color: #fbbf24; }
.heat-name { width: 60px; font-size: 12px; color: var(--text-primary); flex-shrink: 0; }
.heat-bar-wrap { flex: 1; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
.heat-bar { height: 100%; background: linear-gradient(90deg, #f59e0b, #ef4444); border-radius: 3px; transition: width 0.5s; }
.heat-count { font-size: 11px; color: #6b7280; width: 20px; text-align: right; flex-shrink: 0; }

/* ── 标签云 ── */
.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
.kw-tag { padding: 3px 8px; background: rgba(255,255,255,0.04); border-radius: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }

/* ── 话题列表 ── */
.topics-panel { background: var(--bg-card); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px; }
.topic-list { max-height: 420px; overflow-y: auto; }
.topic-row { display: flex; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03); gap: 8px; }
.topic-row:last-child { border-bottom: none; }
.topic-main { flex: 1; min-width: 0; }
.topic-src { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 8px; font-weight: 600; margin-right: 6px; vertical-align: middle; }
.topic-src.cn { background: rgba(239,68,68,0.12); color: #f87171; }
.topic-src.intl { background: rgba(59,130,246,0.12); color: #60a5fa; }
.topic-src.intl-cn { background: rgba(168,85,247,0.12); color: #c084fc; }
.topic-title { font-size: 12px; color: var(--text-primary); line-height: 1.5; }
.topic-concepts { display: inline-flex; flex-wrap: wrap; gap: 3px; margin-left: 4px; vertical-align: middle; }
.tc-chip { font-size: 9px; padding: 1px 5px; border-radius: 6px; background: rgba(139,92,246,0.1); color: #a78bfa; }
.topic-sent { font-size: 11px; flex-shrink: 0; padding-top: 1px; }
.topic-sent.positive, .topic-sent.slightly_positive { color: #4CAF50; }
.topic-sent.negative, .topic-sent.slightly_negative { color: #F44336; }
.topic-sent.neutral { color: #6b7280; }

/* ── 滚动条 ── */
.topic-list::-webkit-scrollbar { width: 4px; }
.topic-list::-webkit-scrollbar-track { background: transparent; }
.topic-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

@media (max-width: 768px) {
  .forum-grid { grid-template-columns: 1fr; }
  .stock-list { grid-template-columns: 1fr; }
  .overview-bar { flex-wrap: wrap; }
  .ov-item { flex: 1 1 45%; }
  .panel-head { align-items: flex-start; flex-direction: column; gap: 4px; }
}
</style>
