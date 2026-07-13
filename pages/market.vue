<template>
  <div class="market-page">
    <!-- ═══ 市场位置判断 ═══ -->
    <section v-if="posSuccess" class="section">
      <h2 class="section-title">市场位置判断</h2>
      <p class="section-sub">全A加权 E/P − 10年期国债 = 股债利差</p>

      <div class="pos-cards">
        <div class="pos-card"><div class="pos-label">盈利收益率 E/P</div><div class="pos-value">{{ posCurrent.ep }}%</div><div class="pos-sub">中位 {{ posMedian?.ep || '--' }}%</div></div>
        <div class="pos-card"><div class="pos-label">10年国债利率</div><div class="pos-value">{{ posCurrent.bond10y }}%</div><div class="pos-sub">中位 {{ posMedian?.bond10y || '--' }}%</div></div>
        <div class="pos-card"><div class="pos-label">股债利差</div><div class="pos-value" :class="{ 'color-up': posCurrent.spread > 3, 'color-down': posCurrent.spread < 1.5 }">{{ posCurrent.spread > 0 ? '+' : '' }}{{ posCurrent.spread }}%</div><div class="pos-sub">中位 {{ posMedian?.spread || '--' }}%</div></div>
        <div class="pos-card pos-zone-card" :class="`zone-${posZone}`"><div class="pos-label">市场阶段</div><div class="pos-zone-badge">{{ posZoneLabel }}</div><div class="pos-sub">近 3 年第 {{ posCurrent.percentile }} 分位</div></div>
      </div>
      <div class="pos-refs">
        <span class="ref-item ref-opp">机会区: &gt; {{ posThresholds.opportunity }}%</span>
        <span class="ref-item ref-ovr">高估区: &lt; {{ posThresholds.overvalued }}%</span>
        <span class="ref-item">3年最高: {{ posThresholds.max }}%</span>
        <span class="ref-item">3年最低: {{ posThresholds.min }}%</span>
      </div>
      <div v-if="posBuilding" class="building-hint">⏳ 历史数据后台构建中，预计1-2分钟完成</div>
      <SpreadChart v-if="posHistory.length >= 2" :history="posHistory" :thresholds="posThresholds" />
    </section>

    <section v-else class="section"><div class="loading">市场位置加载中...</div></section>

    <!-- ═══ 主要指数 ═══ -->
    <section class="section">
      <IndexCards
        :indices="indices"
        :selectedIdx="selectedIdx"
        :klineData="klineData"
        @select="handleIndexSelect"
        @close="selectedIdx = null; klineData = []"
      />
    </section>

    <!-- ═══ AI 总结 ═══ -->
    <section class="section">
      <AiSummary :data="aiData" @refresh="fetchAiSummary(true)" />
    </section>

    <!-- ═══ 论坛舆情 ═══ -->
    <section class="section">
      <ForumSentiment :data="forumData" />
    </section>

    <!-- ═══ 热门板块 ═══ -->
    <section class="section">
      <HotRanking :industries="hotIndustries" :concepts="hotConcepts" />
    </section>

    <!-- ═══ 市场情绪 ═══ -->
    <section class="section">
      <FearGreedGauge :data="fgData" />
    </section>

    <!-- ═══ 今日主线 ═══ -->
    <section class="section">
      <MainThemeCard :industryTheme="mainIndustry" :conceptTheme="mainConcept" />
    </section>

    <!-- ═══ 板块热度变迁 ═══ -->
    <section class="section">
      <ThemeTimeline :dates="tlDates" :themes="tlThemes" :hotItems="tlHotItems" />
    </section>

    <div style="height:60px" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SpreadChart from '@/components/market/SpreadChart.vue'
import IndexCards from '@/components/market/IndexCards.vue'
import HotRanking from '@/components/market/HotRanking.vue'
import MainThemeCard from '@/components/market/MainThemeCard.vue'
import FearGreedGauge from '@/components/market/FearGreedGauge.vue'
import ThemeTimeline from '@/components/market/ThemeTimeline.vue'
import AiSummary from '@/components/market/AiSummary.vue'
import ForumSentiment from '@/components/market/ForumSentiment.vue'

// ─── 市场位置 ───
const posSuccess = ref(false); const posBuilding = ref(false)
const posCurrent = ref({ date: '', ep: 0, bond10y: 0, spread: 0, pe: 0, percentile: 50 })
const posMedian = ref<Record<string,any>|null>(null)
const posZone = ref('neutral'); const posZoneLabel = ref('')
const posHistory = ref<any[]>([]); const posThresholds = ref({ opportunity: 3, overvalued: 1.5, max: 5, min: 0 })
let posPoll: any = null

async function fetchPosition() {
  try {
    const r = await fetch('/api/market/position')
    const j = await r.json()
    if (!j.success) return
    posSuccess.value = true; posCurrent.value = j.current; posHistory.value = j.history
    if (j.building) {
      posBuilding.value = true
      if (!posPoll) {
        posPoll = setInterval(async () => {
          try {
            const r2 = await fetch('/api/market/position'); const j2 = await r2.json()
            if (!j2.building && j2.success && j2.history.length > 1) {
              posBuilding.value = false; posCurrent.value = j2.current; posMedian.value = j2.median
              posZone.value = j2.zone; posZoneLabel.value = j2.zoneLabel
              posHistory.value = j2.history; posThresholds.value = j2.thresholds
              clearInterval(posPoll); posPoll = null
            }
          } catch {}
        }, 8000)
        setTimeout(() => { if (posPoll) { clearInterval(posPoll); posPoll = null; posBuilding.value = false } }, 5 * 60 * 1000)
      }
    } else {
      posBuilding.value = false; posMedian.value = j.median; posZone.value = j.zone
      posZoneLabel.value = j.zoneLabel; posThresholds.value = j.thresholds
    }
  } catch {}
}

// ─── 主要指数 ───
const indices = ref<any[]>([])
const selectedIdx = ref<any>(null)
const klineData = ref<any[]>([])
async function fetchIndices() {
  try {
    const r = await fetch('/api/market/indices-panel'); const j = await r.json()
    if (j.indices) indices.value = j.indices
  } catch {}
}
async function handleIndexSelect(idx: any) {
  selectedIdx.value = idx
  try {
    const r = await fetch(`/api/market/index-kline?code=${encodeURIComponent(idx.code)}&days=60`)
    const j = await r.json()
    if (j.kline) klineData.value = j.kline
  } catch {}
}

// ─── 热门板块 ───
const hotIndustries = ref<any[]>([])
const hotConcepts = ref<any[]>([])
async function fetchHot() {
  try {
    const r = await fetch('/api/market/hot-sectors'); const j = await r.json()
    if (j.industries) hotIndustries.value = j.industries
    if (j.concepts) hotConcepts.value = j.concepts
  } catch {}
}

// ─── 主线 ───
const mainIndustry = ref<any[]>([])
const mainConcept = ref<any[]>([])
async function fetchMainTheme() {
  try {
    const r = await fetch('/api/market/main-theme'); const j = await r.json()
    if (j.industryTheme) mainIndustry.value = j.industryTheme
    if (j.conceptTheme) mainConcept.value = j.conceptTheme
  } catch {}
}

// ─── 情绪 ───
const fgData = ref<any>(null)
async function fetchFearGreed() {
  try {
    const r = await fetch('/api/market/fear-greed'); const j = await r.json()
    if (j.success) fgData.value = j
  } catch {}
}

// ─── 热度变迁 ───
const tlDates = ref<string[]>([])
const tlThemes = ref<any[]>([])
const tlHotItems = ref<any[]>([])
async function fetchTimeline() {
  try {
    const r = await fetch('/api/market/theme-timeline'); const j = await r.json()
    if (j.dates) tlDates.value = j.dates
    if (j.themes) tlThemes.value = j.themes
    if (j.hotItems) tlHotItems.value = j.hotItems
  } catch {}
}

// ─── 论坛舆情 ───
const forumData = ref<any>(null)
async function fetchForumSentiment() {
  try {
    const r = await fetch('/api/market/forum-sentiment')
    const j = await r.json()
    if (j.success) forumData.value = j
  } catch {}
}

// ─── AI 总结 ───
const aiData = ref<any>(null)
async function fetchAiSummary(force = false) {
  try {
    const r = await fetch('/api/market/ai-summary' + (force ? '?force=1' : ''))
    const j = await r.json()
    if (j.headline) aiData.value = j
  } catch {}
}

onMounted(() => {
  fetchPosition()
  fetchIndices()
  fetchHot()
  fetchMainTheme()
  fetchFearGreed()
  fetchTimeline()
  fetchForumSentiment()
  fetchAiSummary()
})
</script>

<style scoped>
.market-page { display: flex; flex-direction: column; gap: 0; padding-bottom: 80px; }
.section { padding: 0 16px 28px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
.section-sub { font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; }

/* ── 市场位置卡片 ── */
.pos-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.pos-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px; text-align: center; box-shadow: var(--shadow-card); }
.pos-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.pos-value { font-size: 22px; font-weight: 700; color: var(--text-primary); }
.pos-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.color-up { color: var(--color-down) !important; }
.color-down { color: var(--color-up) !important; }
.pos-zone-card { padding: 16px 12px; }
.pos-zone-badge { display: inline-block; padding: 4px 16px; border-radius: 20px; font-size: 16px; font-weight: 700; }
.zone-opportunity .pos-zone-badge { background: rgba(45,139,111,0.12); color: var(--color-down); }
.zone-neutral .pos-zone-badge { background: rgba(184,135,45,0.14); color: var(--color-warning); }
.zone-overvalued .pos-zone-badge { background: rgba(201,75,61,0.12); color: var(--color-up); }
.pos-refs { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; }
.ref-opp { color: var(--color-down); }
.ref-ovr { color: var(--color-up); }
.building-hint { text-align: center; padding: 12px; font-size: 13px; color: var(--color-warning); background: rgba(184,135,45,0.08); border: 1px solid rgba(184,135,45,0.18); border-radius: 8px; margin-bottom: 12px; }
.loading { padding: 40px; text-align: center; color: var(--text-secondary); font-size: 14px; }

@media (max-width: 768px) { .pos-cards { grid-template-columns: repeat(2, 1fr); } }
</style>
