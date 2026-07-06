<template>
  <div class="market-page">
    <!-- ═══ 股债利差 ═══ -->
    <section v-if="posSuccess" class="section position-section">
      <h2 class="section-title">📊 市场位置判断</h2>
      <p class="section-sub">全A加权 E/P − 10年期国债 = 股债利差</p>

      <!-- 四指标卡片 -->
      <div class="pos-cards">
        <div class="pos-card">
          <div class="pos-label">盈利收益率 E/P</div>
          <div class="pos-value">{{ posCurrent.ep }}%</div>
          <div class="pos-sub">中位 {{ posMedian.ep }}%</div>
        </div>
        <div class="pos-card">
          <div class="pos-label">10年国债利率</div>
          <div class="pos-value">{{ posCurrent.bond10y }}%</div>
          <div class="pos-sub">中位 {{ posMedian.bond10y }}%</div>
        </div>
        <div class="pos-card">
          <div class="pos-label">股债利差</div>
          <div class="pos-value" :class="{ 'color-up': posCurrent.spread > 3, 'color-down': posCurrent.spread < 1.5 }">
            {{ posCurrent.spread > 0 ? '+' : '' }}{{ posCurrent.spread }}%
          </div>
          <div class="pos-sub">中位 {{ posMedian.spread }}%</div>
        </div>
        <div class="pos-card pos-zone-card" :class="`zone-${posZone}`">
          <div class="pos-label">市场阶段</div>
          <div class="pos-zone-badge">{{ posZoneLabel }}</div>
          <div class="pos-sub">近 3 年第 {{ posCurrent.percentile }} 分位</div>
        </div>
      </div>

      <!-- 阈值参考 -->
      <div class="pos-refs">
        <span class="ref-item ref-opp">🟢 机会区阈值: &gt; {{ posThresholds.opportunity }}%</span>
        <span class="ref-item ref-ovr">🔴 高估区阈值: &lt; {{ posThresholds.overvalued }}%</span>
        <span class="ref-item">📈 3年最高: {{ posThresholds.max }}%</span>
        <span class="ref-item">📉 3年最低: {{ posThresholds.min }}%</span>
      </div>

      <!-- 折线图 -->
      <div v-if="posBuilding" class="building-hint">
        ⏳ 历史数据后台构建中，预计 1-2 分钟完成（当前点位已就绪）
      </div>
      <SpreadChart
        v-if="posHistory.length >= 2"
        :history="posHistory"
        :thresholds="posThresholds"
      />
    </section>

    <section v-else-if="posLoading" class="section position-section">
      <div class="loading-shimmer">加载中...</div>
    </section>

    <section v-else-if="posError" class="section position-section">
      <div class="error-msg">{{ posError }}</div>
    </section>

    <!-- ═══ 占位 ═══ -->
    <section class="section placeholder-section">
      <div class="state-message">
        <div class="icon">🌍</div>
        <div class="text" style="font-size:18px;font-weight:600;margin-top:12px;">大盘总结分析</div>
        <div class="text" style="font-size:14px;color:var(--text-secondary);">更多大盘分析模块开发中...</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SpreadChart from '@/components/market/SpreadChart.vue'

interface MonthPoint {
  date: string; ep: number; bond10y: number; spread: number; pe: number
}

interface PositionData {
  success: boolean
  current: MonthPoint & { percentile: number }
  median: MonthPoint
  zone: string
  zoneLabel: string
  history: MonthPoint[]
  thresholds: { opportunity: number; overvalued: number; max: number; min: number }
}

const posLoading = ref(false)
const posSuccess = ref(false)
const posBuilding = ref(false)
const posError = ref('')
const posCurrent = ref<PositionData['current']>({ date: '', ep: 0, bond10y: 0, spread: 0, pe: 0, percentile: 0 })
const posMedian = ref<PositionData['median']>({ date: '', ep: 0, bond10y: 0, spread: 0, pe: 0 })
const posZone = ref('neutral')
const posZoneLabel = ref('')
const posHistory = ref<MonthPoint[]>([])
const posThresholds = ref({ opportunity: 3, overvalued: 1.5, max: 5, min: 0 })

let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchPosition() {
  posLoading.value = true
  try {
    const resp = await fetch('/api/market/position')
    const json = await resp.json() as PositionData & { building?: boolean }
    if (!json.success) {
      posError.value = '数据不足，等待更多交易日数据累积'
      return
    }
    posSuccess.value = true
    posCurrent.value = json.current
    posHistory.value = json.history

    if (json.building) {
      // 后台构建中，轮询等完整数据
      posBuilding.value = true
      posZone.value = 'neutral'
      posZoneLabel.value = '加载中...'
      posMedian.value = null as any
      posThresholds.value = { opportunity: 3, overvalued: 1.5, max: 5, min: 0 }
      if (!pollTimer) {
        pollTimer = setInterval(async () => {
          try {
            const r2 = await fetch('/api/market/position')
            const j2 = await r2.json() as PositionData & { building?: boolean }
            if (!j2.building && j2.success && j2.history.length > 1) {
              posBuilding.value = false
              posCurrent.value = j2.current
              posMedian.value = j2.median
              posZone.value = j2.zone
              posZoneLabel.value = j2.zoneLabel
              posHistory.value = j2.history
              posThresholds.value = j2.thresholds
              if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
            }
          } catch { /* keep polling */ }
        }, 8000)
        setTimeout(() => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; posBuilding.value = false } }, 5 * 60 * 1000) // 5 min timeout
      }
    } else {
      posBuilding.value = false
      posMedian.value = json.median
      posZone.value = json.zone
      posZoneLabel.value = json.zoneLabel
      posThresholds.value = json.thresholds
    }
  } catch (e: any) {
    posError.value = e.message || '网络错误'
  } finally {
    posLoading.value = false
  }
}

onMounted(fetchPosition)
</script>

<style scoped>
.market-page {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 80px;
}

.section { padding: 0 16px; }

.section-title {
  font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;
}
.section-sub {
  font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;
}

/* ── 指标卡片 ── */
.pos-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}
.pos-card {
  background: var(--bg-card, rgba(18,22,30,0.6));
  border: 1px solid var(--border-color, rgba(255,255,255,0.06));
  border-radius: 10px;
  padding: 16px;
  text-align: center;
}
.pos-label {
  font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;
}
.pos-value {
  font-size: 22px; font-weight: 700; color: var(--text-primary);
  tabular-nums: fixed;
}
.pos-sub {
  font-size: 11px; color: #6b7280; margin-top: 4px;
}
.color-up { color: #4CAF50 !important; }
.color-down { color: #F44336 !important; }

.pos-zone-card { padding: 16px 12px; }
.pos-zone-badge {
  display: inline-block;
  padding: 4px 16px;
  border-radius: 20px;
  font-size: 16px; font-weight: 700;
}
.zone-opportunity .pos-zone-badge { background: rgba(76,175,80,0.15); color: #4CAF50; }
.zone-neutral .pos-zone-badge { background: rgba(255,193,7,0.15); color: #FFC107; }
.zone-overvalued .pos-zone-badge { background: rgba(244,67,54,0.15); color: #F44336; }

/* ── 阈值参考 ── */
.pos-refs {
  display: flex; flex-wrap: wrap; gap: 12px;
  font-size: 11px; color: var(--text-secondary);
  margin-bottom: 12px;
}
.ref-opp { color: #4CAF50; }
.ref-ovr { color: #F44336; }

/* ── loading / error ── */
.loading-shimmer {
  padding: 40px; text-align: center; color: var(--text-secondary); font-size: 14px;
}
.error-msg {
  padding: 20px; text-align: center; color: #F44336; font-size: 14px;
}

.building-hint {
  text-align: center;
  padding: 12px 16px;
  font-size: 13px;
  color: #FFB74D;
  background: rgba(255,183,77,0.06);
  border: 1px solid rgba(255,183,77,0.15);
  border-radius: 8px;
  margin-bottom: 12px;
}

/* ── 占位 ── */
.state-message {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 60px 20px; text-align: center;
}
.icon { font-size: 32px; }

@media (max-width: 768px) {
  .pos-cards { grid-template-columns: repeat(2, 1fr); }
}
</style>
