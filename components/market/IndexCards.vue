<template>
  <div class="index-cards-section">
    <h2 class="section-title">主要指数</h2>
    <div class="cards-grid">
      <div
        v-for="idx in indices"
        :key="idx.code"
        class="index-card"
        :class="{ 'is-up': idx.pctChg > 0, 'is-down': idx.pctChg < 0 }"
        @click="$emit('select', idx)"
      >
        <div class="idx-name">{{ idx.name }}</div>
        <div class="idx-price">{{ fmt(idx.close) }}</div>
        <div class="idx-change">
          <span class="chg-pct">{{ idx.pctChg > 0 ? '+' : '' }}{{ idx.pctChg.toFixed(2) }}%</span>
        </div>
        <div class="idx-amount">{{ fmtAmt(idx.amount) }}</div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="selectedIdx" class="kline-overlay" @click.self="$emit('close')">
        <div class="kline-modal">
          <div class="kline-header">
            <span>{{ selectedIdx.name }} — 近60日K线</span>
            <button class="kline-close" @click="$emit('close')">✕</button>
          </div>
          <div ref="chartRef" class="kline-chart"></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'

interface IndexData { code: string; name: string; close: number; pctChg: number; amount: number }

const props = defineProps<{ indices: IndexData[]; selectedIdx: IndexData | null; klineData: any[] }>()
defineEmits<{ select: [idx: IndexData]; close: [] }>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: any = null

function fmt(n: number) { return n ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--' }
function fmtAmt(n: number) { return n > 1e12 ? `${(n/1e12).toFixed(2)}万亿` : n > 1e8 ? `${(n/1e8).toFixed(0)}亿` : '--' }

async function drawKline() {
  if (!chartRef.value || !props.klineData?.length) return
  await nextTick()
  if (chart) chart.dispose()
  try {
    const echarts = await import('echarts').then(m => m.default || m)
    chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
    const raw = props.klineData as any[]

    const dates = raw.map((r: any) => String(r.trade_date).slice(4, 6) + '/' + String(r.trade_date).slice(6, 8))
    const closes = raw.map((r: any) => [Number(r.open), Number(r.close), Number(r.low), Number(r.high)])

    // MA5 / MA10 / MA20
    function ma(arr: number[], n: number) {
      return arr.map((_, i) => {
        if (i < n - 1) return null
        let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j]
        return +(s / n).toFixed(2)
      })
    }
    const closeArr = raw.map((r: any) => Number(r.close))
    const ma5 = ma(closeArr, 5), ma10 = ma(closeArr, 10), ma20 = ma(closeArr, 20)

    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { top: 16, right: 16, bottom: 28, left: 56 },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10, color: '#9D917E' } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#9D917E' }, splitLine: { lineStyle: { color: 'rgba(216,205,187,0.55)' } } },
      series: [
        {
          type: 'candlestick',
          data: closes,
          itemStyle: { color: '#ef4444', color0: '#22c55e', borderColor: '#ef4444', borderColor0: '#22c55e' },
        },
        { type: 'line', data: ma5, symbol: 'none', lineStyle: { color: '#B8872D', width: 1, opacity: 0.85 }, name: 'MA5' },
        { type: 'line', data: ma10, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1, opacity: 0.8 }, name: 'MA10' },
        { type: 'line', data: ma20, symbol: 'none', lineStyle: { color: '#a855f7', width: 1, opacity: 0.8 }, name: 'MA20' },
      ],
    }, true)
  } catch (e: any) { console.error('[IndexCards] kline err:', e.message) }
}

watch(() => props.selectedIdx, () => { nextTick(() => setTimeout(drawKline, 100)) })
onUnmounted(() => { chart?.dispose(); chart = null })
</script>

<style scoped>
.index-cards-section { margin-bottom: 24px; }
.section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.cards-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.index-card {
  background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px;
  padding: 14px 10px; text-align: center; cursor: pointer; transition: border-color .15s, transform .15s, box-shadow .15s;
  box-shadow: var(--shadow-card);
}
.index-card:hover { border-color: var(--border-light); transform: translateY(-1px); box-shadow: var(--shadow-hover); }
.idx-name { font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.idx-price { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.idx-change { margin: 4px 0 2px; font-size: 13px; }
.is-up .chg-pct { color: var(--color-up); }
.is-down .chg-pct { color: var(--color-down); }
.idx-amount { font-size: 10px; color: var(--text-muted); }

.kline-overlay { position: fixed; inset: 0; background: rgba(43,36,28,0.42); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.kline-modal { width: min(900px, 95vw); max-height: 90vh; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: var(--shadow-hover); }
.kline-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--text-primary); font-weight: 600; }
.kline-close { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.kline-chart { width: 100%; height: 460px; }

@media (max-width: 768px) { .cards-grid { grid-template-columns: repeat(3, 1fr); } .kline-chart { height: 300px; } }
@media (max-width: 480px) { .cards-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
